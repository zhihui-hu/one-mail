import { networkInterfaces } from 'node:os'
import { BrowserWindow, net, powerMonitor } from 'electron'
import { listAccounts, markAccountAuthError } from '../db/repositories/account.repository'
import { getSettings } from '../db/repositories/settings.repository'
import { syncAccountNow, type AccountSyncResult } from '../db/repositories/sync.repository'
import { authenticateImapSession } from '../mail/imap-auth'
import { isImapAuthErrorMessage } from '../mail/imap-errors'
import { syncAccountNewInboxMessages } from '../mail/imap-sync'
import {
  ImapIdleSession,
  type IdleMailboxStatus,
  type IdleWatchMailbox
} from '../mail/imap-idle-session'
import { scheduleImapTask } from './imap-scheduler'
import { notifyNewMail } from './notification-center'

type WatchTask = {
  accountId: number
  signature: string
  stopped: boolean
  session?: ImapIdleSession
  retryCount: number
  failureCount: number
  lastWarningKey?: string
  watchMailboxes: IdleWatchMailbox[]
  lastStatuses: Map<string, IdleMailboxStatus>
}

type WatchSuspensionReason = 'auth' | 'failure'

type WatchSuspension = {
  signature: string
  reason: WatchSuspensionReason
}

type MailboxChangedEvent = {
  accountId: number
  reason: 'idle' | 'poll' | 'manual'
  changedAt: string
}

type ForegroundSyncReason =
  | 'startup'
  | 'focus'
  | 'show'
  | 'restore'
  | 'resume'
  | 'network'
  | 'interval'
type SyncableAccount = ReturnType<typeof listAccounts>[number]

const FALLBACK_POLL_MS = 5 * 60 * 1000
const IDLE_REFRESH_MS = FALLBACK_POLL_MS
const START_STAGGER_MS = 1500
const MIN_RETRY_MS = 5000
const MAX_RETRY_MS = 5 * 60 * 1000
const FOREGROUND_SYNC_COOLDOWN_MS = 60 * 1000
const MAX_WATCH_FAILURES = 10
const NETWORK_WATCH_FAILURES_BEFORE_SUSPEND = 3
const NETWORK_CHECK_INTERVAL_MS = 5000
const NETWORK_CHANGE_SETTLE_MS = 1500
const STARTUP_FOREGROUND_SYNC_LIMIT = 3
const ACTIVE_FOREGROUND_SYNC_LIMIT = 5
const ACTIVE_WATCHER_LIMIT = 5
const FOREGROUND_SYNC_STALE_MS = 10 * 60 * 1000
const PRIORITY_MANUAL_SYNC = 80
const PRIORITY_FOREGROUND_SYNC = 60
const PRIORITY_NEW_MAIL_SYNC = 50
const PRIORITY_WATCH_CONNECT = 20

const tasks = new Map<number, WatchTask>()
const runningSyncs = new Map<number, Promise<AccountSyncResult>>()
const suspendedWatchSignatures = new Map<number, WatchSuspension>()
let initialized = false
let foregroundSyncRunning = false
let lastForegroundSyncAt = 0
let pendingForegroundSyncReason: ForegroundSyncReason | undefined
let networkCheckTimer: NodeJS.Timeout | undefined
let pendingNetworkChangeTimer: NodeJS.Timeout | undefined
let foregroundSyncTimer: NodeJS.Timeout | undefined
let foregroundSyncIntervalMs = 0
let lastNetworkSignature = ''

export function startMailboxWatchers(): void {
  if (initialized) return
  initialized = true
  startNetworkChangeWatch()
  refreshMailboxWatchers()
  refreshForegroundSyncTimer()

  powerMonitor.on('resume', () => {
    restartMailboxWatchers()
    requestForegroundMailboxSync('resume')
  })
}

export function requestForegroundMailboxSync(reason: ForegroundSyncReason): void {
  const now = Date.now()
  const ignoresCooldown = reason === 'network'

  if (foregroundSyncRunning) {
    if (ignoresCooldown) pendingForegroundSyncReason = reason
    return
  }

  if (!ignoresCooldown && now - lastForegroundSyncAt < FOREGROUND_SYNC_COOLDOWN_MS) {
    return
  }

  foregroundSyncRunning = true
  lastForegroundSyncAt = now

  void syncForegroundMailboxes(reason).finally(() => {
    foregroundSyncRunning = false
    const pendingReason = pendingForegroundSyncReason
    pendingForegroundSyncReason = undefined
    if (pendingReason) requestForegroundMailboxSync(pendingReason)
  })
}

export async function requestManualMailboxSync(): Promise<void> {
  await syncMailboxes(getSyncableAccounts(), 'manual', PRIORITY_MANUAL_SYNC)
  refreshMailboxWatchers()
}

export function refreshMailboxWatchers(): void {
  refreshForegroundSyncTimer()
  const accounts = getWatcherAccounts()
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
      failureCount: 0,
      lastWarningKey: undefined,
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
  stopNetworkChangeWatch()
  stopForegroundSyncTimer()
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
      if (!account || !isWatchableAccount(account) || isWatchSuspended(account)) {
        stopMailboxWatcher(task.accountId)
        return
      }

      const session = await scheduleImapTask(account.imapHost, PRIORITY_WATCH_CONNECT, () => {
        if (task.stopped) throw new Error('邮箱监听已停止。')
        return ImapIdleSession.connect(account)
      })
      if (task.stopped) {
        await session.logout().catch(() => undefined)
        return
      }
      task.session = session
      task.retryCount = 0

      await authenticateImapSession(account, session)
      const capabilities = await session.capabilities().catch(() => new Set<string>())
      task.watchMailboxes = await listWatchMailboxes(session)
      task.lastStatuses = await readMailboxStatuses(session, task.watchMailboxes, task.lastStatuses)
      task.failureCount = 0

      if (capabilities.has('IDLE')) {
        await session.selectInbox()
        await runIdleLoop(task, session)
      } else {
        await runPollingLoop(task, session)
      }
    } catch (error) {
      if (!task.stopped) {
        const message = error instanceof Error ? error.message : '邮箱监听失败。'
        warnWatchFailure(task, message)
        if (isImapAuthErrorMessage(message)) {
          markAccountAuthError(task.accountId, message)
          suspendMailboxWatcher(task, 'auth')
          return
        }
        if (markWatchFailure(task, message)) return
        await wait(getRetryDelay(task))
      }
    } finally {
      await task.session?.logout().catch(() => undefined)
      task.session = undefined
    }
  }
}

function markWatchFailure(task: WatchTask, message: string): boolean {
  task.failureCount += 1

  const maxFailures = isNetworkFailureMessage(message)
    ? NETWORK_WATCH_FAILURES_BEFORE_SUSPEND
    : MAX_WATCH_FAILURES

  if (task.failureCount < maxFailures) return false

  console.warn(
    `[mailbox-watch] account ${task.accountId}: stopped after ${task.failureCount} consecutive failures. Last error: ${message}`
  )
  suspendMailboxWatcher(task, 'failure')
  return true
}

function suspendMailboxWatcher(task: WatchTask, reason: WatchSuspensionReason): void {
  suspendedWatchSignatures.set(task.accountId, { signature: task.signature, reason })
  stopMailboxWatcher(task.accountId)
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
      ? await runLimitedAccountSync(accountId, PRIORITY_NEW_MAIL_SYNC, syncNewInboxMessagesNow)
      : await runLimitedSync(accountId, PRIORITY_FOREGROUND_SYNC)
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

async function syncForegroundMailboxes(reason: ForegroundSyncReason): Promise<void> {
  const accounts = getForegroundSyncAccounts(reason)

  if (accounts.length === 0) return

  await syncMailboxes(accounts, reason, PRIORITY_FOREGROUND_SYNC)
  refreshMailboxWatchers()
}

async function syncMailboxes(
  accounts: SyncableAccount[],
  reason: ForegroundSyncReason | 'manual',
  priority: number
): Promise<void> {
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const result = await runLimitedSync(account.accountId, priority)

        notifyNewMail({
          accountId: account.accountId,
          reason: 'manual',
          messageCount: result.insertedCount
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '同步账号失败。'
        console.warn(
          `[mailbox-watch] foreground sync ${reason} account ${account.accountId}: ${message}`
        )
      } finally {
        notifyMailboxChanged({
          accountId: account.accountId,
          reason: 'manual',
          changedAt: new Date().toISOString()
        })
      }
    })
  )
}

async function runLimitedSync(
  accountId: number,
  priority = PRIORITY_MANUAL_SYNC
): Promise<AccountSyncResult> {
  return runLimitedAccountSync(accountId, priority, syncAccountNow)
}

async function syncNewInboxMessagesNow(accountId: number): Promise<AccountSyncResult> {
  const stats = await syncAccountNewInboxMessages(accountId)
  return { accountId, ...stats }
}

async function runLimitedAccountSync(
  accountId: number,
  priority: number,
  syncAccount: (accountId: number) => Promise<AccountSyncResult>
): Promise<AccountSyncResult> {
  const existingSync = runningSyncs.get(accountId)
  if (existingSync) {
    return existingSync
  }

  const account = listAccounts().find((item) => item.accountId === accountId)
  const host = account?.imapHost ?? `account:${accountId}`

  const syncPromise = scheduleImapTask(host, priority, () => syncAccount(accountId))
  runningSyncs.set(accountId, syncPromise)
  try {
    await syncPromise
  } finally {
    if (runningSyncs.get(accountId) === syncPromise) {
      runningSyncs.delete(accountId)
    }
  }

  return syncPromise
}

function getForegroundSyncAccounts(reason: ForegroundSyncReason): SyncableAccount[] {
  const accounts = getSyncableAccounts().sort(compareForegroundSyncPriority)

  if (reason === 'network') return accounts.slice(0, ACTIVE_FOREGROUND_SYNC_LIMIT)
  if (reason === 'startup') return accounts.slice(0, STARTUP_FOREGROUND_SYNC_LIMIT)

  return accounts.filter(isForegroundSyncDue).slice(0, ACTIVE_FOREGROUND_SYNC_LIMIT)
}

function getWatcherAccounts(): SyncableAccount[] {
  return getSyncableAccounts().sort(compareWatcherPriority).slice(0, ACTIVE_WATCHER_LIMIT)
}

function getSyncableAccounts(): SyncableAccount[] {
  return listAccounts().filter(
    (account) => isWatchableAccount(account) && !isWatchSuspended(account)
  )
}

function compareWatcherPriority(left: SyncableAccount, right: SyncableAccount): number {
  return compareForegroundSyncPriority(left, right)
}

function compareForegroundSyncPriority(left: SyncableAccount, right: SyncableAccount): number {
  const leftTime = getLastSyncTime(left)
  const rightTime = getLastSyncTime(right)

  if (leftTime !== rightTime) return leftTime - rightTime
  return left.accountId - right.accountId
}

function isForegroundSyncDue(account: SyncableAccount): boolean {
  const lastSyncTime = getLastSyncTime(account)
  return lastSyncTime === 0 || Date.now() - lastSyncTime >= FOREGROUND_SYNC_STALE_MS
}

function getLastSyncTime(account: SyncableAccount): number {
  if (!account.lastSyncAt) return 0

  const time = new Date(account.lastSyncAt).getTime()
  return Number.isNaN(time) ? 0 : time
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

function isWatchableAccount(account: ReturnType<typeof listAccounts>[number]): boolean {
  return (
    account.syncEnabled &&
    account.credentialState === 'stored' &&
    account.status !== 'auth_error' &&
    account.status !== 'disabled'
  )
}

function warnWatchFailure(task: WatchTask, message: string): void {
  const warningKey = normalizeWarningKey(message)
  const shouldWarn =
    task.failureCount === 0 || task.failureCount === NETWORK_WATCH_FAILURES_BEFORE_SUSPEND - 1

  if (!shouldWarn && task.lastWarningKey === warningKey) return

  task.lastWarningKey = warningKey
  console.warn(`[mailbox-watch] account ${task.accountId}: ${message}`)
}

function normalizeWarningKey(message: string): string {
  if (isNetworkFailureMessage(message)) return 'network'
  if (isImapAuthErrorMessage(message)) return 'auth'
  return message
}

function isNetworkFailureMessage(message: string): boolean {
  return /IMAP 服务器响应超时|IMAP 服务器未返回有效响应|连接 IMAP 服务器超时|网络|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(
    message
  )
}

function isWatchSuspended(account: ReturnType<typeof listAccounts>[number]): boolean {
  const suspension = suspendedWatchSignatures.get(account.accountId)
  if (!suspension) return false

  if (suspension.reason === 'auth') {
    if (account.status === 'auth_error' || account.credentialState !== 'stored') return true

    suspendedWatchSignatures.delete(account.accountId)
    return false
  }

  if (suspension.signature === getWatchSignature(account)) return true

  suspendedWatchSignatures.delete(account.accountId)
  return false
}

function startNetworkChangeWatch(): void {
  if (networkCheckTimer) return

  lastNetworkSignature = getNetworkSignature()
  networkCheckTimer = setInterval(checkNetworkSignatureChanged, NETWORK_CHECK_INTERVAL_MS)
  networkCheckTimer.unref?.()
}

function stopNetworkChangeWatch(): void {
  if (networkCheckTimer) {
    clearInterval(networkCheckTimer)
    networkCheckTimer = undefined
  }

  if (pendingNetworkChangeTimer) {
    clearTimeout(pendingNetworkChangeTimer)
    pendingNetworkChangeTimer = undefined
  }

  lastNetworkSignature = ''
}

function refreshForegroundSyncTimer(): void {
  const intervalMs = getForegroundSyncIntervalMs()
  if (intervalMs === foregroundSyncIntervalMs && (intervalMs === 0 || foregroundSyncTimer)) return

  stopForegroundSyncTimer()
  foregroundSyncIntervalMs = intervalMs

  if (intervalMs <= 0) return

  foregroundSyncTimer = setInterval(() => {
    requestForegroundMailboxSync('interval')
  }, intervalMs)
  foregroundSyncTimer.unref?.()
}

function stopForegroundSyncTimer(): void {
  if (foregroundSyncTimer) {
    clearInterval(foregroundSyncTimer)
    foregroundSyncTimer = undefined
  }
  foregroundSyncIntervalMs = 0
}

function getForegroundSyncIntervalMs(): number {
  const minutes = getSettings().syncIntervalMinutes
  if (!Number.isFinite(minutes) || minutes <= 0) return 0

  return minutes * 60 * 1000
}

function checkNetworkSignatureChanged(): void {
  const nextSignature = getNetworkSignature()
  if (nextSignature === lastNetworkSignature) return

  lastNetworkSignature = nextSignature
  scheduleNetworkMailboxCheck()
}

function scheduleNetworkMailboxCheck(): void {
  if (pendingNetworkChangeTimer) {
    clearTimeout(pendingNetworkChangeTimer)
  }

  pendingNetworkChangeTimer = setTimeout(() => {
    pendingNetworkChangeTimer = undefined
    handleNetworkChange()
  }, NETWORK_CHANGE_SETTLE_MS)
  pendingNetworkChangeTimer.unref?.()
}

function handleNetworkChange(): void {
  console.info('[mailbox-watch] network changed, rechecking mailbox availability.')
  clearNetworkFailureSuspensions()
  restartMailboxWatchers()
  requestForegroundMailboxSync('network')
}

function clearNetworkFailureSuspensions(): void {
  for (const [accountId, suspension] of suspendedWatchSignatures) {
    if (suspension.reason === 'failure') {
      suspendedWatchSignatures.delete(accountId)
    }
  }
}

function getNetworkSignature(): string {
  const addresses: string[] = []

  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      addresses.push([name, entry.family, entry.address, entry.cidr ?? '', entry.mac].join(':'))
    }
  }

  return [`online:${isNetworkOnline()}`, ...addresses.sort()].join('|')
}

function isNetworkOnline(): boolean {
  try {
    return net.isOnline()
  } catch {
    return true
  }
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
