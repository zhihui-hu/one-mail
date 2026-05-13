import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getDatabase, getDatabaseKey, type SqliteRow } from '../db/connection'

export type OAuthTokenPayload = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  tokenType: string
  expiresAt?: string
}

type EncryptedOAuthPayload = {
  version: 1
  alg: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

type OAuthTokenRow = SqliteRow & {
  provider_key: string
  token_payload: string
  expires_at: string | null
  scopes_json: string
}

export function saveOAuthToken(
  accountId: number,
  providerKey: string,
  payload: OAuthTokenPayload,
  scopes: string[]
): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO onemail_oauth_tokens (
        account_id,
        provider_key,
        token_payload,
        expires_at,
        scopes_json,
        updated_at
      )
      VALUES (
        :accountId,
        :providerKey,
        :tokenPayload,
        :expiresAt,
        :scopesJson,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
      ON CONFLICT(account_id) DO UPDATE SET
        provider_key = excluded.provider_key,
        token_payload = excluded.token_payload,
        expires_at = excluded.expires_at,
        scopes_json = excluded.scopes_json,
        updated_at = excluded.updated_at
      `
    )
    .run({
      accountId,
      providerKey,
      tokenPayload: encryptOAuthPayload(payload),
      expiresAt: payload.expiresAt ?? null,
      scopesJson: JSON.stringify(scopes)
    })

  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_accounts
      SET credential_state = 'stored',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    )
    .run({ accountId })
}

export function readOAuthToken(accountId: number): OAuthTokenPayload {
  const row = getDatabase()
    .prepare<OAuthTokenRow>(
      `
      SELECT provider_key, token_payload, expires_at, scopes_json
      FROM onemail_oauth_tokens
      WHERE account_id = :accountId
      `
    )
    .get({ accountId })

  if (!row?.token_payload) {
    throw new Error('OAuth 凭据不存在，请重新使用 Microsoft 登录。')
  }

  return decryptOAuthPayload(row.token_payload)
}

function encryptOAuthPayload(payload: OAuthTokenPayload): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getOAuthKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const encrypted: EncryptedOAuthPayload = {
    version: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return Buffer.from(JSON.stringify(encrypted), 'utf8').toString('base64')
}

function decryptOAuthPayload(value: string): OAuthTokenPayload {
  let payload: EncryptedOAuthPayload

  try {
    payload = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as EncryptedOAuthPayload
  } catch {
    throw new Error('OAuth 凭据格式无效，请重新登录。')
  }

  if (payload.version !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('OAuth 凭据加密格式不支持，请重新登录。')
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getOAuthKey(),
      Buffer.from(payload.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')

    return JSON.parse(decrypted) as OAuthTokenPayload
  } catch {
    throw new Error('OAuth 凭据解密失败，请重新使用 Microsoft 登录。')
  }
}

function getOAuthKey(): Buffer {
  return createHash('sha256').update(`${getDatabaseKey()}:oauth`).digest()
}
