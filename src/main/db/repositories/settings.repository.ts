import { getDatabase } from '../connection'
import type { AppSettings, SettingsUpdateInput } from '../../ipc/types'

const defaultSettings: AppSettings = {
  syncIntervalMinutes: 15,
  syncWindowDays: 90,
  externalImagesBlocked: true,
  locale: 'en-US'
}

const settingsDefinition = {
  syncIntervalMinutes: { key: 'sync_interval_minutes', type: 'number' },
  syncWindowDays: { key: 'sync_window_days', type: 'number' },
  externalImagesBlocked: { key: 'external_images_blocked', type: 'boolean' },
  locale: { key: 'locale', type: 'string' }
} as const

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
    settingsDefinition.externalImagesBlocked.key,
    next.externalImagesBlocked ? '1' : '0',
    settingsDefinition.externalImagesBlocked.type
  )
  writeSetting(settingsDefinition.locale.key, next.locale, settingsDefinition.locale.type)

  return getSettings()
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

function readNumber(row: SettingRow | undefined, fallback: number): number {
  if (!row) return fallback
  const value = Number(row.setting_value)
  return Number.isFinite(value) ? value : fallback
}

function readBoolean(row: SettingRow | undefined, fallback: boolean): boolean {
  if (!row) return fallback
  return row.setting_value === '1' || row.setting_value === 'true'
}
