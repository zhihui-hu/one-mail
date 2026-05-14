import { getDatabase, toNumber, toOptionalString } from '../connection'
import type { SyncStatus } from '../../ipc/types'
import { syncAccountMailbox, type AccountMailboxSyncMode } from '../../mail/imap-sync'
import { isImapAuthErrorMessage, isImapNetworkErrorMessage } from '../../mail/imap-errors'

type SyncRunRow = {
  account_id: number | null
  started_at: string
}

export type AccountSyncResult = {
  accountId: number
  scannedCount: number
  insertedCount: number
  updatedCount: number
}

const activeAccountSyncs = new Map<number, Promise<AccountSyncResult>>()

export function syncAccountNow(
  accountId: number,
  mode: AccountMailboxSyncMode = 'refresh',
  startedAt = new Date().toISOString()
): Promise<AccountSyncResult> {
  const existingSync = activeAccountSyncs.get(accountId)
  if (existingSync) return existingSync

  const syncPromise = syncSingleAccount(accountId, mode, startedAt).finally(() => {
    if (activeAccountSyncs.get(accountId) === syncPromise) {
      activeAccountSyncs.delete(accountId)
    }
  })
  activeAccountSyncs.set(accountId, syncPromise)

  return syncPromise
}

export function getSyncStatus(): SyncStatus {
  markStaleRunningSyncsFailed()
  const rows = getDatabase()
    .prepare<SyncRunRow>(
      `
      SELECT account_id, started_at
      FROM onemail_sync_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      `
    )
    .all()

  const accountIds = rows
    .map((row) => (row.account_id === null ? undefined : toNumber(row.account_id)))
    .filter((accountId): accountId is number => accountId !== undefined)

  return {
    running: rows.length > 0,
    accountIds,
    lastStartedAt: toOptionalString(rows[0]?.started_at)
  }
}

function markStaleRunningSyncsFailed(): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'failed',
          error_count = CASE WHEN error_count = 0 THEN 1 ELSE error_count END,
          error_message = COALESCE(error_message, '同步被新的同步任务重置。'),
          finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE status = 'running'
        AND datetime(started_at) < datetime('now', '-5 minutes')
      `
    )
    .run()
}

async function syncSingleAccount(
  accountId: number,
  mode: AccountMailboxSyncMode,
  startedAt: string
): Promise<AccountSyncResult> {
  const db = getDatabase()
  const result = db
    .prepare(
      `
      INSERT INTO onemail_sync_runs (account_id, sync_kind, status, started_at)
      VALUES (:accountId, 'message_headers', 'running', :startedAt)
      `
    )
    .run({ accountId, startedAt })
  const syncRunId = Number(result.lastInsertRowid)

  db.prepare(
    `
    UPDATE onemail_mail_accounts
    SET status = 'syncing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE account_id = :accountId
    `
  ).run({ accountId })

  try {
    const stats = await syncAccountMailbox(accountId, mode)
    db.prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'success',
          scanned_count = :scannedCount,
          inserted_count = :insertedCount,
          updated_count = :updatedCount,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE sync_run_id = :syncRunId
      `
    ).run({
      syncRunId,
      scannedCount: stats.scannedCount,
      insertedCount: stats.insertedCount,
      updatedCount: stats.updatedCount
    })
    return { accountId, ...stats }
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步账号失败。'
    const accountStatus = isImapAuthErrorMessage(message)
      ? 'auth_error'
      : isImapNetworkErrorMessage(message)
        ? 'network_error'
        : 'sync_error'
    const credentialState = accountStatus === 'auth_error' ? 'invalid' : undefined
    db.prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'failed',
          error_count = 1,
          error_message = :message,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE sync_run_id = :syncRunId
      `
    ).run({ syncRunId, message })
    db.prepare(
      `
      UPDATE onemail_mail_accounts
      SET status = :accountStatus,
          credential_state = COALESCE(:credentialState, credential_state),
          last_error = :message,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
    `
    ).run({ accountId, accountStatus, credentialState: credentialState ?? null, message })
    throw error
  }
}
