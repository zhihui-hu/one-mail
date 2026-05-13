import {
  getDatabase,
  toBoolean,
  toNullableParam,
  toNumber,
  toOptionalString,
  type SqliteRow
} from '../connection'
import type { AccountCreateInput, AccountUpdateInput, MailAccount } from '../../ipc/types'

type AccountRow = SqliteRow & {
  account_id: number
  provider_key: string
  email: string
  display_name: string | null
  account_label: string | null
  auth_type: MailAccount['authType']
  imap_host: string
  imap_port: number
  imap_security: MailAccount['imapSecurity']
  sync_enabled: number
  credential_state: MailAccount['credentialState']
  status: MailAccount['status']
  last_sync_at: string | null
  last_error: string | null
}

export function listAccounts(): MailAccount[] {
  const rows = getDatabase()
    .prepare<AccountRow>(
      `
      SELECT
        account_id,
        provider_key,
        email,
        display_name,
        account_label,
        auth_type,
        imap_host,
        imap_port,
        imap_security,
        sync_enabled,
        CASE
          WHEN encrypted_password IS NOT NULL THEN 'stored'
          WHEN auth_type = 'oauth2' AND EXISTS (
            SELECT 1 FROM onemail_oauth_tokens t WHERE t.account_id = onemail_mail_accounts.account_id
          ) THEN 'stored'
          ELSE credential_state
        END AS credential_state,
        status,
        last_sync_at,
        last_error
      FROM onemail_mail_accounts
      ORDER BY sort_order ASC, account_id ASC
      `
    )
    .all()

  return rows.map(mapAccountRow)
}

export function getAccount(accountId: number): MailAccount | null {
  const row = getDatabase()
    .prepare<AccountRow>(
      `
      SELECT
        account_id,
        provider_key,
        email,
        display_name,
        account_label,
        auth_type,
        imap_host,
        imap_port,
        imap_security,
        sync_enabled,
        CASE
          WHEN encrypted_password IS NOT NULL THEN 'stored'
          WHEN auth_type = 'oauth2' AND EXISTS (
            SELECT 1 FROM onemail_oauth_tokens t WHERE t.account_id = onemail_mail_accounts.account_id
          ) THEN 'stored'
          ELSE credential_state
        END AS credential_state,
        status,
        last_sync_at,
        last_error
      FROM onemail_mail_accounts
      WHERE account_id = :accountId
      `
    )
    .get({ accountId })

  return row ? mapAccountRow(row) : null
}

export function createAccount(input: AccountCreateInput): MailAccount {
  if (!input.email?.trim()) {
    throw new Error('邮箱地址不能为空。')
  }

  const normalizedEmail = input.email.trim().toLowerCase()
  const accountLabel = input.accountLabel?.trim() || normalizedEmail
  const db = getDatabase()

  db.prepare(
    `
    INSERT OR IGNORE INTO onemail_provider_presets (
      provider_key,
      display_name,
      domains_json,
      auth_type,
      imap_host,
      imap_port,
      imap_security,
      is_builtin,
      is_active
    )
    VALUES (
      :providerKey,
      :displayName,
      '[]',
      :authType,
      :imapHost,
      :imapPort,
      :imapSecurity,
      0,
      1
    )
    `
  ).run({
    providerKey: input.providerKey,
    displayName: input.providerKey,
    authType: input.authType,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecurity: input.imapSecurity
  })

  const result = db
    .prepare(
      `
      INSERT INTO onemail_mail_accounts (
        provider_key,
        email,
        normalized_email,
        display_name,
        account_label,
        avatar_text,
        auth_type,
        imap_host,
        imap_port,
        imap_security,
        credential_state,
        status
      )
      VALUES (
        :providerKey,
        :email,
        :normalizedEmail,
        :displayName,
        :accountLabel,
        :avatarText,
        :authType,
        :imapHost,
        :imapPort,
        :imapSecurity,
        'pending',
        'active'
      )
      `
    )
    .run({
      providerKey: input.providerKey,
      email: input.email,
      normalizedEmail,
      displayName: null,
      accountLabel,
      avatarText: normalizedEmail.slice(0, 1).toUpperCase(),
      authType: input.authType,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapSecurity: input.imapSecurity
    })

  const account = getAccount(Number(result.lastInsertRowid))
  if (!account) {
    throw new Error('Account insert did not return a row.')
  }

  return account
}

export function updateAccount(input: AccountUpdateInput): MailAccount {
  const current = getAccount(input.accountId)
  if (!current) {
    throw new Error(`Account not found: ${input.accountId}`)
  }

  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_accounts
      SET
        provider_key = :providerKey,
        display_name = :displayName,
        account_label = :accountLabel,
        auth_type = :authType,
        imap_host = :imapHost,
        imap_port = :imapPort,
        imap_security = :imapSecurity,
        sync_enabled = :syncEnabled,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    )
    .run({
      accountId: input.accountId,
      providerKey: input.providerKey ?? current.providerKey,
      displayName: toNullableParam(input.displayName ?? current.displayName),
      accountLabel:
        input.accountLabel === undefined
          ? (current.accountLabel ?? current.email)
          : input.accountLabel.trim() || current.email,
      authType: input.authType ?? current.authType,
      imapHost: input.imapHost ?? current.imapHost,
      imapPort: input.imapPort ?? current.imapPort,
      imapSecurity: input.imapSecurity ?? current.imapSecurity,
      syncEnabled: (input.syncEnabled ?? current.syncEnabled) ? 1 : 0
    })

  const updated = getAccount(input.accountId)
  if (!updated) {
    throw new Error(`Account not found after update: ${input.accountId}`)
  }

  return updated
}

export function disableAccount(accountId: number): MailAccount {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_accounts
      SET
        sync_enabled = 0,
        status = 'disabled',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    )
    .run({ accountId })

  const updated = getAccount(accountId)
  if (!updated) {
    throw new Error(`Account not found: ${accountId}`)
  }

  return updated
}

export function markAccountAuthError(accountId: number, message: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_accounts
      SET
        status = 'auth_error',
        credential_state = 'invalid',
        last_error = :message,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    )
    .run({ accountId, message })
}

export function removeAccount(accountId: number): boolean {
  const result = getDatabase()
    .prepare('DELETE FROM onemail_mail_accounts WHERE account_id = :accountId')
    .run({ accountId })

  return result.changes > 0
}

function mapAccountRow(row: AccountRow): MailAccount {
  return {
    accountId: toNumber(row.account_id),
    providerKey: row.provider_key,
    email: row.email,
    displayName: toOptionalString(row.display_name),
    accountLabel: toOptionalString(row.account_label),
    authType: row.auth_type,
    imapHost: row.imap_host,
    imapPort: toNumber(row.imap_port),
    imapSecurity: row.imap_security,
    syncEnabled: toBoolean(row.sync_enabled),
    credentialState: row.credential_state,
    status: row.status,
    lastSyncAt: toOptionalString(row.last_sync_at),
    lastError: toOptionalString(row.last_error)
  }
}
