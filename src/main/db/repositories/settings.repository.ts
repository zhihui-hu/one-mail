import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getDatabase, getDatabaseKey } from '../connection'
import { getOpenAtLogin, setOpenAtLogin } from '../../services/login-item'
import type { AppSettings, BackupSyncSettings, SettingsUpdateInput } from '../../ipc/types'

const defaultSettings: AppSettings = {
  syncIntervalMinutes: 15,
  syncWindowDays: 90,
  openAtLogin: false,
  externalImagesBlocked: true,
  locale: 'zh-CN'
}

const settingsDefinition = {
  syncIntervalMinutes: { key: 'sync_interval_minutes', type: 'number' },
  syncWindowDays: { key: 'sync_window_days', type: 'number' },
  openAtLogin: { key: 'open_at_login', type: 'boolean' },
  externalImagesBlocked: { key: 'external_images_blocked', type: 'boolean' },
  locale: { key: 'locale', type: 'string' },
  lastAttachmentDownloadDir: { key: 'last_attachment_download_dir', type: 'string' },
  backupSyncSettings: { key: 'backup_sync_settings', type: 'json' }
} as const

type EncryptedSettingsPayload = {
  version: 1
  alg: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

type SettingRow = {
  setting_key: string
  setting_value: string
  value_type: string
}

export function getSettings(): AppSettings {
  ensureDefaultSettings()

  const rows = getDatabase()
    .prepare<SettingRow>(
      `
      SELECT setting_key, setting_value, value_type
      FROM onemail_app_settings
      `
    )
    .all()

  const byKey = new Map(rows.map((row) => [row.setting_key, row]))

  return {
    syncIntervalMinutes: readNumber(byKey.get(settingsDefinition.syncIntervalMinutes.key), 15),
    syncWindowDays: readNumber(byKey.get(settingsDefinition.syncWindowDays.key), 90),
    openAtLogin: getOpenAtLogin(),
    externalImagesBlocked: readBoolean(
      byKey.get(settingsDefinition.externalImagesBlocked.key),
      true
    ),
    locale: byKey.get(settingsDefinition.locale.key)?.setting_value ?? defaultSettings.locale
  }
}

export function updateSettings(input: SettingsUpdateInput): AppSettings {
  const current = getSettings()
  const next: AppSettings = { ...current, ...input }

  if (input.openAtLogin !== undefined) {
    setOpenAtLogin(next.openAtLogin)
  }

  writeSetting(
    settingsDefinition.syncIntervalMinutes.key,
    String(next.syncIntervalMinutes),
    settingsDefinition.syncIntervalMinutes.type
  )
  writeSetting(
    settingsDefinition.syncWindowDays.key,
    String(next.syncWindowDays),
    settingsDefinition.syncWindowDays.type
  )
  writeSetting(
    settingsDefinition.openAtLogin.key,
    next.openAtLogin ? '1' : '0',
    settingsDefinition.openAtLogin.type
  )
  writeSetting(
    settingsDefinition.externalImagesBlocked.key,
    next.externalImagesBlocked ? '1' : '0',
    settingsDefinition.externalImagesBlocked.type
  )
  writeSetting(settingsDefinition.locale.key, next.locale, settingsDefinition.locale.type)

  return getSettings()
}

export function getBackupSyncSettings(): BackupSyncSettings {
  return redactBackupSyncSettings(readBackupSyncSettings())
}

export function getBackupSyncSettingsForMain(): BackupSyncSettings {
  return readBackupSyncSettings()
}

export function updateBackupSyncSettings(input: BackupSyncSettings): BackupSyncSettings {
  const nextSettings = normalizeBackupSyncSettings(input, readBackupSyncSettings())

  writeSetting(
    settingsDefinition.backupSyncSettings.key,
    encryptBackupSyncSettings(nextSettings),
    settingsDefinition.backupSyncSettings.type
  )

  return redactBackupSyncSettings(nextSettings)
}

export function resolveBackupSyncSettingsForMain(input: BackupSyncSettings): BackupSyncSettings {
  return normalizeBackupSyncSettings(input, readBackupSyncSettings())
}

export function getLastAttachmentDownloadDir(): string | undefined {
  const row = readSetting(settingsDefinition.lastAttachmentDownloadDir.key)
  const directory = row?.setting_value.trim()
  return directory ? directory : undefined
}

export function setLastAttachmentDownloadDir(directory: string): void {
  const value = directory.trim()
  if (!value) return

  writeSetting(
    settingsDefinition.lastAttachmentDownloadDir.key,
    value,
    settingsDefinition.lastAttachmentDownloadDir.type
  )
}

function ensureDefaultSettings(): void {
  updateMissingSetting(
    settingsDefinition.syncIntervalMinutes.key,
    String(defaultSettings.syncIntervalMinutes),
    settingsDefinition.syncIntervalMinutes.type
  )
  updateMissingSetting(
    settingsDefinition.syncWindowDays.key,
    String(defaultSettings.syncWindowDays),
    settingsDefinition.syncWindowDays.type
  )
  updateMissingSetting(
    settingsDefinition.externalImagesBlocked.key,
    defaultSettings.externalImagesBlocked ? '1' : '0',
    settingsDefinition.externalImagesBlocked.type
  )
  updateMissingSetting(
    settingsDefinition.openAtLogin.key,
    defaultSettings.openAtLogin ? '1' : '0',
    settingsDefinition.openAtLogin.type
  )
  updateMissingSetting(
    settingsDefinition.locale.key,
    defaultSettings.locale,
    settingsDefinition.locale.type
  )
}

function updateMissingSetting(key: string, value: string, valueType: string): void {
  getDatabase()
    .prepare(
      `
      INSERT OR IGNORE INTO onemail_app_settings (setting_key, setting_value, value_type)
      VALUES (:key, :value, :valueType)
      `
    )
    .run({ key, value, valueType })
}

function readSetting(key: string): SettingRow | undefined {
  return getDatabase()
    .prepare<SettingRow>(
      `
      SELECT setting_key, setting_value, value_type
      FROM onemail_app_settings
      WHERE setting_key = :key
      `
    )
    .get({ key })
}

function writeSetting(key: string, value: string, valueType: string): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO onemail_app_settings (setting_key, setting_value, value_type, updated_at)
      VALUES (:key, :value, :valueType, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        value_type = excluded.value_type,
        updated_at = excluded.updated_at
      `
    )
    .run({ key, value, valueType })
}

function readBackupSyncSettings(): BackupSyncSettings {
  const row = readSetting(settingsDefinition.backupSyncSettings.key)
  if (!row?.setting_value) return { provider: 'none' }

  try {
    const settings = JSON.parse(decryptBackupSyncSettings(row.setting_value)) as BackupSyncSettings
    return normalizeStoredBackupSyncSettings(settings)
  } catch {
    return { provider: 'none' }
  }
}

function normalizeStoredBackupSyncSettings(settings: BackupSyncSettings): BackupSyncSettings {
  if (settings.provider === 'webdav') {
    return {
      provider: 'webdav',
      remoteUrl: settings.remoteUrl,
      username: settings.username,
      password: settings.password
    }
  }

  if (settings.provider === 's3') {
    return {
      provider: 's3',
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      key: settings.key,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey
    }
  }

  return { provider: 'none' }
}

function normalizeBackupSyncSettings(
  input: BackupSyncSettings,
  current: BackupSyncSettings
): BackupSyncSettings {
  if (input.provider === 'webdav') {
    const remoteUrl = input.remoteUrl.trim()
    validateHttpUrl(remoteUrl, 'WebDAV URL')

    return {
      provider: 'webdav',
      remoteUrl,
      username: optionalTrim(input.username),
      password: normalizeSecret(
        input.password,
        current.provider === 'webdav' ? current.password : undefined
      )
    }
  }

  if (input.provider === 's3') {
    const endpoint = optionalTrim(input.endpoint)?.replace(/\/+$/, '')
    if (endpoint) validateHttpUrl(endpoint, 'S3 Endpoint')

    const secretAccessKey = normalizeSecret(
      input.secretAccessKey,
      current.provider === 's3' ? current.secretAccessKey : undefined
    )

    if (!secretAccessKey) {
      throw new Error('请输入 S3 Secret Access Key。')
    }

    return {
      provider: 's3',
      endpoint,
      region: optionalTrim(input.region) ?? 'us-east-1',
      bucket: requireTrimmed(input.bucket, '请输入 S3 Bucket。'),
      key: requireTrimmed(input.key, '请输入 S3 对象路径。'),
      accessKeyId: requireTrimmed(input.accessKeyId, '请输入 S3 Access Key ID。'),
      secretAccessKey
    }
  }

  return { provider: 'none' }
}

function redactBackupSyncSettings(settings: BackupSyncSettings): BackupSyncSettings {
  if (settings.provider === 'webdav') {
    return {
      provider: 'webdav',
      remoteUrl: settings.remoteUrl,
      username: settings.username,
      passwordConfigured: Boolean(settings.password)
    }
  }

  if (settings.provider === 's3') {
    return {
      provider: 's3',
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      key: settings.key,
      accessKeyId: settings.accessKeyId,
      secretAccessKeyConfigured: Boolean(settings.secretAccessKey)
    }
  }

  return { provider: 'none' }
}

function optionalTrim(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireTrimmed(value: string | undefined, message: string): string {
  const trimmed = optionalTrim(value)
  if (!trimmed) throw new Error(message)
  return trimmed
}

function normalizeSecret(
  nextValue: string | undefined,
  currentValue: string | undefined
): string | undefined {
  const nextSecret = optionalTrim(nextValue)
  return nextSecret ?? currentValue
}

function validateHttpUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} 格式无效。`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} 只支持 http 或 https。`)
  }
}

function encryptBackupSyncSettings(settings: BackupSyncSettings): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getSettingsEncryptionKey(), iv)
  const plaintext = JSON.stringify(settings)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const payload: EncryptedSettingsPayload = {
    version: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decryptBackupSyncSettings(value: string): string {
  const payload = JSON.parse(
    Buffer.from(value, 'base64').toString('utf8')
  ) as EncryptedSettingsPayload
  if (payload.version !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('远端同步配置加密格式不支持。')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getSettingsEncryptionKey(),
    Buffer.from(payload.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function getSettingsEncryptionKey(): Buffer {
  return createHash('sha256').update(getDatabaseKey()).digest()
}

function readNumber(row: SettingRow | undefined, fallback: number): number {
  if (!row) return fallback
  const value = Number(row.setting_value)
  return Number.isFinite(value) ? value : fallback
}

function readBoolean(row: SettingRow | undefined, fallback: boolean): boolean {
  if (!row) return fallback
  return row.setting_value === '1' || row.setting_value === 'true'
}
