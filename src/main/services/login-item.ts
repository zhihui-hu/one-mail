import { app } from 'electron'

export function getOpenAtLogin(): boolean {
  if (process.platform === 'linux') return false
  return app.getLoginItemSettings().openAtLogin
}

export function setOpenAtLogin(openAtLogin: boolean): void {
  if (process.platform === 'linux') return
  app.setLoginItemSettings({ openAtLogin })
}
