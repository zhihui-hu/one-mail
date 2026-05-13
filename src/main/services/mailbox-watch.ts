import { BrowserWindow, powerMonitor } from 'electron'
import { listAccounts, markAccountAuthError } from '../db/repositories/account.repository'
import { syncAccountNow, type AccountSyncResult } from '../db/repositories/sync.repository'
import { authenticateImapSession } from '../mail/imap-auth'
import { isImapAuthErrorMessage } from '../mail/imap-errors'
import { syncAccountNewInboxMessages } from '../mail/imap-sync'
import {
  ImapIdleSession,
  type IdleMailboxStatus,
  type IdleWatchMailbox
} from '../mail/imap-idle-session'
import { notifyNewMail } from './notification-center'

type WatchTask = {
  accountId: number
  signature: string
  stopped: boolean
  session?: ImapIdleSession
  retryCount: number
  watchMailboxes: IdleWatchMailbox[]
  lastStatuses: Map<string, IdleMailboxStatus>
}

type MailboxChangedEvent = {
  accountId: number
  reason: 'idle' | 'poll' | 'manual'
  changedAt: string
}

const FALLBACK_POLL_MS = 5 * 60 * 1000
const IDLE_REFRESH_MS = FALLBACK_POLL_MS
const START_STAGGER_MS = 1500
const MIN_RETRY_MS = 5000
const MAX_RETRY_MS = 5 * 60 * 1000
const MAX_PARALLEL_SYNC = 3

const tasks = new Map<number, WatchTask>()
const runningSyncs = new Map<number, Promise<AccountSyncResult>>()
const syncQueue: Array<() => void> = []
let initialized = false

export function startMailboxWatchers(): void {
  if (initialized) return
  initialized = true
  refreshMailboxWatchers()

  powerMonitor.on('resume', () => {
    restartMailboxWatchers()
  })
}

export function refreshMailboxWatchers(): void {
  const accounts = listAccounts().filter(
    (account) => account.syncEnabled && account.credentialState === 'stored'
  )
  const activeAccounts = new Map(accounts.map((account) => [account.accountId, account]))

  for (const [accountId, task] of tasks) {
    const account = activeAccounts.get(accountId)
    if (!account || task.signature !== getWatchSignature(account)) {
      stopMailboxWatcher(accountId)
    }
  }

  accounts.forEach((account, index) => {
    if (tasks.has(account.accountId)) return
    const task: WatchTask = {
      accountId: account.accountId,
      signature: getWatchSignature(account),
      stopped: false,
      retryCount: 0,
      watchMailboxes: [{ path: 'INBOX', role: 'inbox' }],
      lastStatuses: new Map()
    }
    tasks.set(account.accountId, task)

    setTimeout(() => {
      void runMailboxWatcher(task)
    }, index * START_STAGGER_MS)
  })
}

export function stopMailboxWatchers(): void {
  for (const accountId of tasks.keys()) {
    stopMailboxWatcher(accountId)
  }
}

function restartMailboxWatchers(): void {
  for (const accountId of tasks.keys()) {
    stopMailboxWatcher(accountId)
  }
  refreshMailboxWatchers()
}

function stopMailboxWatcher(accountId: number): void {
  const task = tasks.get(accountId)
  if (!task) return

  task.stopped = true
  void task.session?.logout().catch(() => undefined)
  tasks.delete(accountId)
}

async function runMailboxWatcher(task: WatchTask): Promise<void> {
  while (!task.stopped) {
    try {
      const account = listAccounts().find((item) => item.accountId === task.accountId)
      if (!account || !account.syncEnabled || account.credentialState !== 'stored') {
        stopMailboxWatcher(task.accountId)
        return
      }

      const session = await ImapIdleSession.connect(account)
      task.session = session
      task.retryCount = 0

      await authenticateImapSession(account, session)
      await session.identifyClient()
      const capabilities = await session.capabilities().catch(() => new Set<string>())
      task.watchMailboxes = await listWatchMailboxes(session)
      task.lastStatuses = await readMailboxStatuses(session, task.watchMailboxes, task.lastStatuses)

      if (capabilities.has('IDLE')) {
        await session.selectInbox()
        await runIdleLoop(task, session)
      } else {
        await runPollingLoop(task, session)
      }
    } catch (error) {
      if (!task.stopped) {
        const message = error instanceof Error ? error.message : '邮箱监听失败。'
        console.warn(`[mailbox-watch] account ${task.accountId}: ${message}`)
        if (isImapAuthErrorMessage(message)) {
          markAccountAuthError(task.accountId, message)
          stopMailboxWatcher(task.accountId)
          return
        }
        await wait(getRetryDelay(task))
      }
    } finally {
      await task.session?.logout().catch(() => undefined)
      task.session = undefined
    }
  }
}

async function runIdleLoop(task: WatchTask, session: ImapIdleSession): Promise<void> {
  while (!task.stopped) {
    const idleResult = await session.idle(IDLE_REFRESH_MS)
    if (task.stopped) return

    if (idleResult.changed) {
      await syncChangedMailbox(task.accountId, 'idle', idleResult.reason)
      task.lastStatuses = await readMailboxStatuses(session, task.watchMailboxes, task.lastStatuses)
    } else if (await hasStatusChanged(task, session)) {
      await syncChangedMailbox(task.accountId, 'poll')
    }
  }
}

async function runPollingLoop(task: WatchTask, session: ImapIdleSession): Promise<void> {
  while (!task.stopped) {
    await wait(FALLBACK_POLL_MS)
    if (task.stopped) return

    await session.noop().catch(() => undefined)
    if (await hasStatusChanged(task, session)) {
      await syncChangedMailbox(task.accountId, 'poll')
    }
  }
}

async function hasStatusChanged(task: WatchTask, session: ImapIdleSession): Promise<boolean> {
  const nextStatuses = await readMailboxStatuses(session, task.watchMailboxes, task.lastStatuses)
  const previousStatuses = task.lastStatuses
  task.lastStatuses = nextStatuses

  for (const [path, nextStatus] of nextStatuses) {
    const previousStatus = previousStatuses.get(path)
    if (!previousStatus) continue
    if (isMailboxStatusChanged(previousStatus, nextStatus)) return true
  }

  return false
}

function isMailboxStatusChanged(
  previousStatus: IdleMailboxStatus,
  nextStatus: IdleMailboxStatus
): boolean {
  if (!previousStatus) return false
  if (
    nextStatus.uidNext !== undefined &&
    previousStatus.uidNext !== undefined &&
    nextStatus.uidNext !== previousStatus.uidNext
  ) {
    return true
  }

  if (
    nextStatus.unreadCount !== undefined &&
    previousStatus.unreadCount !== undefined &&
    nextStatus.unreadCount !== previousStatus.unreadCount
  ) {
    return true
  }

  return (
    nextStatus.totalCount !== undefined &&
    previousStatus.totalCount !== undefined &&
    nextStatus.totalCount !== previousStatus.totalCount
  )
}

async function listWatchMailboxes(session: ImapIdleSession): Promise<IdleWatchMailbox[]> {
  const mailboxes = await session.listWatchMailboxes().catch(() => [])
  const hasInbox = mailboxes.some((mailbox) => mailbox.role === 'inbox')
  if (hasInbox) return mailboxes

  return [{ path: 'INBOX', role: 'inbox' }, ...mailboxes]
}

async function readMailboxStatuses(
  session: ImapIdleSession,
  mailboxes: IdleWatchMailbox[],
  previousStatuses: Map<string, IdleMailboxStatus>
): Promise<Map<string, IdleMailboxStatus>> {
  const nextStatuses = new Map(previousStatuses)

  for (const mailbox of mailboxes) {
    const status = await session.statusMailbox(mailbox.path).catch(() => undefined)
    if (status) nextStatuses.set(mailbox.path, status)
  }

  return nextStatuses
}

async function syncChangedMailbox(
  accountId: number,
  reason: MailboxChangedEvent['reason'],
  idleReason?: 'exists' | 'expunge' | 'fetch' | 'recent' | 'timeout' | 'closed'
): Promise<void> {
  const result =
    reason === 'idle' && (idleReason === 'exists' || idleReason === 'recent')
      ? await runLimitedAccountSync(accountId, syncNewInboxMessagesNow)
      : await runLimitedSync(accountId)
  notifyNewMail({
    accountId,
    reason,
    messageCount: result.insertedCount
  })
  notifyMailboxChanged({
    accountId,
    reason,
    changedAt: new Date().toISOString()
  })
}

async function runLimitedSync(accountId: number): Promise<AccountSyncResult> {
  return runLimitedAccountSync(accountId, syncAccountNow)
}

async function syncNewInboxMessagesNow(accountId: number): Promise<AccountSyncResult> {
  const stats = await syncAccountNewInboxMessages(accountId)
  return { accountId, ...stats }
}

async function runLimitedAccountSync(
  accountId: number,
  syncAccount: (accountId: number) => Promise<AccountSyncResult>
): Promise<AccountSyncResult> {
  const existingSync = runningSyncs.get(accountId)
  if (existingSync) {
    return existingSync
  }

  if (runningSyncs.size >= MAX_PARALLEL_SYNC) {
    await new Promise<void>((resolve) => {
      syncQueue.push(resolve)
    })
    const queuedExistingSync = runningSyncs.get(accountId)
    if (queuedExistingSync) return queuedExistingSync
  }

  const syncPromise = syncAccount(accountId)
  runningSyncs.set(accountId, syncPromise)
  try {
    await syncPromise
  } finally {
    if (runningSyncs.get(accountId) === syncPromise) {
      runningSyncs.delete(accountId)
    }
    syncQueue.shift()?.()
  }

  return syncPromise
}

function getWatchSignature(account: ReturnType<typeof listAccounts>[number]): string {
  return [
    account.accountId,
    account.email,
    account.authType,
    account.imapHost,
    account.imapPort,
    account.imapSecurity,
    account.syncEnabled,
    account.credentialState
  ].join('|')
}

function notifyMailboxChanged(event: MailboxChangedEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('sync/mailboxChanged', event)
    }
  }
}

function getRetryDelay(task: WatchTask): number {
  const delay = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** task.retryCount)
  task.retryCount += 1
  return delay + Math.floor(Math.random() * MIN_RETRY_MS)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
