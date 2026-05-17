import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => tmpdir())
  }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../connection'
import { createOutboxRecord, updateOutboxRecord } from './outbox.repository'

describe('outbox repository attachments', () => {
  beforeEach(() => {
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-outbox-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('persists forwarded attachment source ids without requiring a local file path', () => {
    const { accountId, messageId, attachmentId } = seedMessageWithAttachment()

    const outbox = createOutboxRecord({
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      subject: 'Fwd: report',
      bodyText: 'Forwarding this.',
      attachments: [
        {
          sourceMessageId: messageId,
          sourceAttachmentId: attachmentId,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048
        }
      ]
    })

    expect(outbox.attachments).toEqual([
      {
        sourceMessageId: messageId,
        sourceAttachmentId: attachmentId,
        filePath: undefined,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('replaces forwarded attachments when updating an outbox draft', () => {
    const { accountId, messageId, attachmentId } = seedMessageWithAttachment()
    const outbox = createOutboxRecord({
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      attachments: [
        {
          sourceMessageId: messageId,
          sourceAttachmentId: attachmentId,
          filename: 'report.pdf',
          sizeBytes: 2048
        }
      ]
    })

    const updated = updateOutboxRecord(outbox.outboxId, {
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      attachments: []
    })

    expect(updated.attachments).toEqual([])
  })
})

function seedMessageWithAttachment(): {
  accountId: number
  folderId: number
  messageId: number
  attachmentId: number
} {
  const db = getDatabase()

  db.prepare(
    `
    INSERT INTO onemail_provider_presets (
      provider_key,
      display_name,
      domains_json,
      auth_type
    )
    VALUES ('test', 'Test Mail', '["example.com"]', 'password')
    `
  ).run()

  const accountResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_accounts (
        provider_key,
        email,
        normalized_email,
        account_label,
        auth_type,
        imap_host,
        imap_port,
        imap_security
      )
      VALUES (
        'test',
        'sender@example.com',
        'sender@example.com',
        'Sender',
        'password',
        'imap.example.com',
        993,
        'ssl_tls'
      )
      `
    )
    .run()
  const accountId = Number(accountResult.lastInsertRowid)

  const folderResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_folders (
        account_id,
        path,
        name,
        role
      )
      VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')
      `
    )
    .run({ accountId })
  const folderId = Number(folderResult.lastInsertRowid)

  const messageResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_messages (
        account_id,
        folder_id,
        uid,
        rfc822_message_id,
        subject,
        from_email,
        has_attachments
      )
      VALUES (
        :accountId,
        :folderId,
        1,
        '<source@example.com>',
        'Report',
        'author@example.com',
        1
      )
      `
    )
    .run({ accountId, folderId })
  const messageId = Number(messageResult.lastInsertRowid)

  const attachmentResult = db
    .prepare(
      `
      INSERT INTO onemail_message_attachments (
        message_id,
        filename,
        mime_type,
        content_disposition,
        size_bytes
      )
      VALUES (:messageId, 'report.pdf', 'application/pdf', 'attachment', 2048)
      `
    )
    .run({ messageId })

  return {
    accountId,
    folderId,
    messageId,
    attachmentId: Number(attachmentResult.lastInsertRowid)
  }
}
