import { ipcMain } from 'electron'
import { checkForAppUpdates } from '../services/auto-update'
import type { AppUpdateCheckResult } from './types'

export function registerUpdateIpc(): void {
  ipcMain.handle('updates/check', async (): Promise<AppUpdateCheckResult> => {
    return checkForAppUpdates()
  })
}
