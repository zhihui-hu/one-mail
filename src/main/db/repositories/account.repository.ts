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
  smtp_host: string | null
  smtp_port: number | null
  smtp_security: MailAccount['smtpSecurity'] | null
  smtp_auth_type: MailAccount['smtpAuthType'] | null
  smtp_enabled: number
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
        smtp_host,
        smtp_port,
        smtp_security,
        smtp_auth_type,
        smtp_enabled,
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
        smtp_host,
        smtp_port,
        smtp_security,
        smtp_auth_type,
        smtp_enabled,
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
  const smtpSettings = resolveSmtpSettings(input, normalizedEmail)
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
      smtp_host,
      smtp_port,
      smtp_security,
      smtp_auth_type,
      smtp_requires_auth,
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
      :smtpHost,
      :smtpPort,
      :smtpSecurity,
      :smtpAuthType,
      1,
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
    imapSecurity: input.imapSecurity,
    smtpHost: toNullableParam(smtpSettings.smtpHost),
    smtpPort: toNullableParam(smtpSettings.smtpPort),
    smtpSecurity: toNullableParam(smtpSettings.smtpSecurity),
    smtpAuthType: toNullableParam(smtpSettings.smtpAuthType)
  })

  db.prepare(
    `
    UPDATE onemail_provider_presets
    SET
      smtp_host = :smtpHost,
      smtp_port = :smtpPort,
      smtp_security = :smtpSecurity,
      smtp_auth_type = :smtpAuthType,
      smtp_requires_auth = 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE provider_key = :providerKey
    `
  ).run({
    providerKey: input.providerKey,
    smtpHost: toNullableParam(smtpSettings.smtpHost),
    smtpPort: toNullableParam(smtpSettings.smtpPort),
    smtpSecurity: toNullableParam(smtpSettings.smtpSecurity),
    smtpAuthType: toNullableParam(smtpSettings.smtpAuthType)
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
        smtp_host,
        smtp_port,
        smtp_security,
        smtp_auth_type,
        smtp_enabled,
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
        :smtpHost,
        :smtpPort,
        :smtpSecurity,
        :smtpAuthType,
        :smtpEnabled,
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
      imapSecurity: input.imapSecurity,
      smtpHost: toNullableParam(smtpSettings.smtpHost),
      smtpPort: toNullableParam(smtpSettings.smtpPort),
      smtpSecurity: toNullableParam(smtpSettings.smtpSecurity),
      smtpAuthType: toNullableParam(smtpSettings.smtpAuthType),
      smtpEnabled: smtpSettings.smtpEnabled ? 1 : 0
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
        smtp_host = :smtpHost,
        smtp_port = :smtpPort,
        smtp_security = :smtpSecurity,
        smtp_auth_type = :smtpAuthType,
        smtp_enabled = :smtpEnabled,
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
      smtpHost: toNullableParam(input.smtpHost ?? current.smtpHost),
      smtpPort: toNullableParam(input.smtpPort ?? current.smtpPort),
      smtpSecurity: toNullableParam(input.smtpSecurity ?? current.smtpSecurity),
      smtpAuthType: toNullableParam(input.smtpAuthType ?? current.smtpAuthType),
      smtpEnabled: (input.smtpEnabled ?? current.smtpEnabled) ? 1 : 0,
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
    smtpHost: toOptionalString(row.smtp_host),
    smtpPort: row.smtp_port === null ? undefined : toNumber(row.smtp_port),
    smtpSecurity: row.smtp_security ?? undefined,
    smtpAuthType: row.smtp_auth_type ?? undefined,
    smtpEnabled: toBoolean(row.smtp_enabled),
    syncEnabled: toBoolean(row.sync_enabled),
    credentialState: row.credential_state,
    status: row.status,
    lastSyncAt: toOptionalString(row.last_sync_at),
    lastError: toOptionalString(row.last_error)
  }
}

type SmtpSettings = {
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: MailAccount['smtpSecurity']
  smtpAuthType?: MailAccount['smtpAuthType']
  smtpEnabled: boolean
}

function resolveSmtpSettings(input: AccountCreateInput, normalizedEmail: string): SmtpSettings {
  const preset = getProviderSmtpPreset(input.providerKey, normalizedEmail, input.authType)

  return {
    smtpHost: input.smtpHost ?? preset.smtpHost,
    smtpPort: input.smtpPort ?? preset.smtpPort,
    smtpSecurity: input.smtpSecurity ?? preset.smtpSecurity,
    smtpAuthType: input.smtpAuthType ?? preset.smtpAuthType ?? input.authType,
    smtpEnabled: input.smtpEnabled ?? preset.smtpEnabled
  }
}

function getProviderSmtpPreset(
  providerKey: string,
  normalizedEmail: string,
  authType: MailAccount['authType']
): SmtpSettings {
  const normalizedProviderKey = providerKey.toLowerCase()
  const domain = normalizedEmail.split('@').at(1) ?? ''

  if (normalizedProviderKey.includes('gmail') || domain === 'gmail.com') {
    return {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecurity: 'ssl_tls',
      smtpAuthType: authType,
      smtpEnabled: true
    }
  }

  if (normalizedProviderKey.includes('163') || domain === '163.com') {
    return {
      smtpHost: 'smtp.163.com',
      smtpPort: 465,
      smtpSecurity: 'ssl_tls',
      smtpAuthType: authType,
      smtpEnabled: true
    }
  }

  if (normalizedProviderKey.includes('qq') || domain === 'qq.com') {
    return {
      smtpHost: 'smtp.qq.com',
      smtpPort: 465,
      smtpSecurity: 'ssl_tls',
      smtpAuthType: authType,
      smtpEnabled: true
    }
  }

  if (
    normalizedProviderKey.includes('outlook') ||
    normalizedProviderKey.includes('microsoft') ||
    domain === 'outlook.com' ||
    domain === 'hotmail.com' ||
    domain === 'live.com'
  ) {
    return {
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      smtpAuthType: 'oauth2',
      smtpEnabled: false
    }
  }

  return {
    smtpHost: undefined,
    smtpPort: undefined,
    smtpSecurity: undefined,
    smtpAuthType: authType,
    smtpEnabled: true
  }
}
