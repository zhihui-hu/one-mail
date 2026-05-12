import { ipcMain } from 'electron'
import { getSettings, updateSettings } from '../db/repositories/settings.repository'
import { exportDatabaseSqlBackup, importDatabaseSqlBackup } from '../services/database-backup'
import { refreshMailboxWatchers } from '../services/mailbox-watch'
import type { SettingsUpdateInput } from './types'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings/get', () => getSettings())
  ipcMain.handle('settings/update', (_event, input: SettingsUpdateInput) => updateSettings(input))
  ipcMain.handle('settings/exportSql', () => exportDatabaseSqlBackup())
  ipcMain.handle('settings/importSql', async () => {
    const result = await importDatabaseSqlBackup()
    if (result.imported) refreshMailboxWatchers()
    return result
  })
}
