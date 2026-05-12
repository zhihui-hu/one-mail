import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getDatabase, getDatabaseKey, type SqliteRow } from '../db/connection'
import type { AccountCreateInput } from '../ipc/types'

type PasswordRow = SqliteRow & {
  encrypted_password: string | null
}

type PasswordPayload = {
  version: 1
  alg: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

export function saveAccountPassword(accountId: number, input: AccountCreateInput): void {
  if (!input.password) {
    throw new Error('请输入邮箱授权码或密码。')
  }

  const encryptedPassword = encryptPassword(input.password)

  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_accounts
      SET
        encrypted_password = :encryptedPassword,
        credential_state = 'stored',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    )
    .run({ accountId, encryptedPassword })
}

export function readAccountPassword(accountId: number): string {
  const row = getDatabase()
    .prepare<PasswordRow>(
      `
      SELECT encrypted_password
      FROM onemail_mail_accounts
      WHERE account_id = :accountId
      `
    )
    .get({ accountId })

  if (!row?.encrypted_password) {
    throw new Error('账号凭据不存在，请编辑账号并重新保存密码。')
  }

  return decryptPassword(row.encrypted_password)
}

function encryptPassword(password: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getPasswordKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  const payload: PasswordPayload = {
    version: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decryptPassword(value: string): string {
  let payload: PasswordPayload

  try {
    payload = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as PasswordPayload
  } catch {
    throw new Error('账号凭据格式无效，请编辑账号并重新保存密码。')
  }

  if (payload.version !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('账号凭据加密格式不支持，请编辑账号并重新保存密码。')
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getPasswordKey(),
      Buffer.from(payload.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('账号凭据解密失败，请确认数据库密钥未被修改，或编辑账号并重新保存密码。')
  }
}

function getPasswordKey(): Buffer {
  return createHash('sha256').update(getDatabaseKey()).digest()
}
