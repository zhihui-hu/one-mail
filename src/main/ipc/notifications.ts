import { ipcMain } from 'electron'
import { getNotificationStatus } from '../services/notification-center'

export function registerNotificationIpc(): void {
  ipcMain.handle('notifications/status', () => getNotificationStatus())
}
