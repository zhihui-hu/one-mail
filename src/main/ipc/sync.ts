import { ipcMain } from 'electron'
import { getDatabase, toNumber } from '../db/connection'
import { getSyncStatus, syncAccountNow } from '../db/repositories/sync.repository'
import { notifyNewMail } from '../services/notification-center'

export function registerSyncIpc(): void {
  ipcMain.handle('sync/startAll', async () => {
    const rows = getDatabase()
      .prepare<{
        account_id: number
      }>('SELECT account_id FROM onemail_mail_accounts WHERE sync_enabled = 1')
      .all()
    const results = await Promise.allSettled(
      rows.map((row) => syncAccountWithNotification(toNumber(row.account_id), 'manual'))
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length === rows.length && failures.length > 0) {
      throw failures[0].reason
    }
    return getSyncStatus()
  })
  ipcMain.handle('sync/startAccount', async (_event, accountId: number) => {
    await syncAccountWithNotification(accountId, 'manual')
    return getSyncStatus()
  })
  ipcMain.handle('sync/status', () => getSyncStatus())
}

async function syncAccountWithNotification(accountId: number, reason: 'manual'): Promise<void> {
  const result = await syncAccountNow(accountId)
  notifyNewMail({
    accountId,
    reason,
    messageCount: result.insertedCount
  })
}
