import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    getPath: vi.fn(() => tmpdir()),
    setLoginItemSettings: vi.fn()
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
import { getBackupSyncSettings, updateBackupSyncSettings } from './settings.repository'

describe('settings repository backup sync', () => {
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onemail-settings-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
      testDir = ''
    }
  })

  it('stores encrypted backup sync settings using a schema-compatible value type', () => {
    const saved = updateBackupSyncSettings({
      provider: 'webdav',
      remoteUrl: 'https://dav.example.com/onemail-backup.sql',
      username: 'user',
      password: 'secret'
    })

    expect(saved).toEqual({
      provider: 'webdav',
      remoteUrl: 'https://dav.example.com/onemail-backup.sql',
      username: 'user',
      passwordConfigured: true
    })
    expect(getBackupSyncSettings()).toEqual(saved)

    const row = getDatabase()
      .prepare<{
        value_type: string
      }>("SELECT value_type FROM onemail_app_settings WHERE setting_key = 'backup_sync_settings'")
      .get()
    expect(row?.value_type).toBe('json')
  })
})
