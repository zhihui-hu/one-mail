import { ipcMain } from 'electron'
import { getDatabase, toNumber } from '../db/connection'
import { getSyncStatus, syncAccountNow } from '../db/repositories/sync.repository'
import type { AccountMailboxSyncMode } from '../mail/imap-sync'
import { notifyNewMail } from '../services/notification-center'

export function registerSyncIpc(): void {
  ipcMain.handle('sync/startAll', async (_event, mode?: AccountMailboxSyncMode) => {
    const syncMode = normalizeSyncMode(mode)
    const rows = getDatabase()
      .prepare<{
        account_id: number
      }>('SELECT account_id FROM onemail_mail_accounts WHERE sync_enabled = 1')
      .all()
    const results = await Promise.allSettled(
      rows.map((row) => syncAccountWithNotification(toNumber(row.account_id), 'manual', syncMode))
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length === rows.length && failures.length > 0) {
      throw failures[0].reason
    }
    return getSyncStatus()
  })
  ipcMain.handle(
    'sync/startAccount',
    async (_event, accountId: number, mode?: AccountMailboxSyncMode) => {
      await syncAccountWithNotification(accountId, 'manual', normalizeSyncMode(mode))
      return getSyncStatus()
    }
  )
  ipcMain.handle('sync/status', () => getSyncStatus())
}

async function syncAccountWithNotification(
  accountId: number,
  reason: 'manual',
  mode: AccountMailboxSyncMode
): Promise<void> {
  const result = await syncAccountNow(accountId, mode)
  notifyNewMail({
    accountId,
    reason,
    messageCount: result.insertedCount
  })
}

function normalizeSyncMode(mode: unknown): AccountMailboxSyncMode {
  return mode === 'initial' ? 'initial' : 'refresh'
}
