import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { getDatabasePath } from '../db/connection'
import type { AppTheme, SystemInfo } from './types'

const TITLE_BAR_SYMBOL_COLORS: Record<AppTheme, string> = {
  light: '#171717',
  dark: '#fafafa'
}

export function registerSystemIpc(): void {
  ipcMain.handle('system/info', (): SystemInfo => {
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      databasePath: getDatabasePath(),
      userDataPath: app.getPath('userData')
    }
  })

  ipcMain.handle('system/setTitleBarTheme', (event, theme: unknown): boolean => {
    if (process.platform !== 'win32' || (theme !== 'light' && theme !== 'dark')) return false

    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    window.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: TITLE_BAR_SYMBOL_COLORS[theme],
      height: 40
    })
    return true
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

  ipcMain.handle('system/openExternal', async (_event, targetUrl: string): Promise<boolean> => {
    const url = new URL(targetUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false

    await shell.openExternal(url.toString())
    return true
  })
}
