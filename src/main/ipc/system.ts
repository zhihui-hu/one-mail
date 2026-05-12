import { app, ipcMain, shell } from 'electron'
import { getDatabasePath } from '../db/connection'
import type { SystemInfo } from './types'

export function registerSystemIpc(): void {
  ipcMain.handle('system/info', (): SystemInfo => {
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      databasePath: getDatabasePath(),
      userDataPath: app.getPath('userData')
    }
  })

  ipcMain.handle('system/revealDatabase', async (): Promise<boolean> => {
    const databasePath = getDatabasePath()
    shell.showItemInFolder(databasePath)
    return true
  })

  ipcMain.handle('system/revealPath', (_event, targetPath: string): boolean => {
    if (!targetPath.trim()) return false

    shell.showItemInFolder(targetPath)
    return true
  })
}
