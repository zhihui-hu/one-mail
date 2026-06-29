import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => tmpdir())
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  getDatabaseKey,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import { createAccount, listAccounts } from '../db/repositories/account.repository'
import { createDatabaseSqlBackup, importDatabaseSqlBackupContent } from './database-backup'
import { readAccountPassword, saveAccountPassword } from './credential-store'

describe('database SQL backup', () => {
  afterEach(() => {
    closeDatabase()
  })

  it('restores a SQL backup into the current database and keeps encrypted credentials readable', () => {
    const sourceKey = createTestDatabaseKey(-30, '1111111111111111')
    const targetKey = createTestDatabaseKey(-20, '2222222222222222')

    configureDatabase('source', sourceKey)
    const sourceAccount = seedAccount('source@example.com', 'source-password')
    seedInboxMessage(sourceAccount.accountId, 'Please ATTACH the invoice')
    const backup = createDatabaseSqlBackup()

    expect(backup.key).toBe(sourceKey)
    expect(backup.sql).toContain('source@example.com')
    closeDatabase()

    configureDatabase('target', targetKey)
    seedAccount('target@example.com', 'target-password')
    expect(listAccounts().map((account) => account.email)).toEqual(['target@example.com'])

    const result = importDatabaseSqlBackupContent(backup.sql, 'renamed-backup.sql')

    expect(result.imported).toBe(true)
    expect(result.accountCount).toBe(1)
    expect(result.messageCount).toBe(1)
    expect(getDatabaseKey()).toBe(sourceKey)

    const restoredAccounts = listAccounts()
    expect(restoredAccounts.map((account) => account.email)).toEqual(['source@example.com'])
    expect(readAccountPassword(restoredAccounts[0].accountId)).toBe('source-password')
  })

  it('rejects an executable database attachment statement', () => {
    const sourceKey = createTestDatabaseKey(-30, '3333333333333333')
    configureDatabase('unsafe-source', sourceKey)
    seedAccount('source@example.com', 'source-password')
    const backup = createDatabaseSqlBackup()
    const unsafeSql = backup.sql.replace(
      'BEGIN TRANSACTION;',
      "BEGIN TRANSACTION;\nATTACH DATABASE 'external.sqlite' AS external;"
    )

    expect(() => importDatabaseSqlBackupContent(unsafeSql, backup.fileName)).toThrow(
      '备份 SQL 包含不允许的数据库附加语句。'
    )
  })
})

function configureDatabase(label: string, key: string): void {
  const dir = mkdtempSync(join(tmpdir(), `onemail-backup-${label}-`))
  electronMock.app.getPath.mockReturnValue(dir)
  setDatabaseKey(key)
  const databasePath = join(dir, 'onemail.sqlite')
  setDatabasePath(databasePath)
  initializeDatabase(databasePath)
}

function seedAccount(email: string, password: string): ReturnType<typeof createAccount> {
  const account = createAccount({
    providerKey: 'test',
    email,
    password,
    authType: 'password',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  })

  saveAccountPassword(account.accountId, {
    providerKey: 'test',
    email,
    password,
    authType: 'password',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  })

  return account
}

function seedInboxMessage(accountId: number, subject: string): void {
  const db = getDatabase()
  const folderResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_folders (account_id, path, name, role)
      VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')
      `
    )
    .run({ accountId })
  const folderId = Number(folderResult.lastInsertRowid)

  db.prepare(
    `
    INSERT INTO onemail_mail_messages (
      account_id,
      folder_id,
      uid,
      rfc822_message_id,
      subject,
      from_email
    )
    VALUES (
      :accountId,
      :folderId,
      1,
      '<source@example.com>',
      :subject,
      'sender@example.com'
    )
    `
  ).run({ accountId, folderId, subject })
}

function createTestDatabaseKey(offsetSeconds: number, suffix: string): string {
  const timestamp = String(Math.floor(Date.now() / 1000) + offsetSeconds).padStart(10, '0')
  return `k${timestamp}${suffix}`
}
