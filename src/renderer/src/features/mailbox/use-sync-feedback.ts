import * as React from 'react'

export type SyncNotice = {
  state: 'idle' | 'running' | 'success' | 'error'
  label: string
  startedAt?: Date
  finishedAt?: Date
  message?: string
}

type SyncFeedback = {
  syncingAccountIds: Set<string>
  syncNotice: SyncNotice
  startSyncing: (accountId: string, notice: Omit<SyncNotice, 'state' | 'finishedAt'>) => void
  finishSyncing: (
    accountId: string,
    state: Extract<SyncNotice['state'], 'success' | 'error'>,
    notice: Omit<SyncNotice, 'state' | 'finishedAt'>
  ) => void
  setNotice: React.Dispatch<React.SetStateAction<SyncNotice>>
  clearSyncing: (accountId: string) => void
}

export function useSyncFeedback(): SyncFeedback {
  const [syncingAccountIds, setSyncingAccountIds] = React.useState<Set<string>>(() => new Set())
  const [syncNotice, setNotice] = React.useState<SyncNotice>({ state: 'idle', label: '' })

  const startSyncing = React.useCallback(
    (accountId: string, notice: Omit<SyncNotice, 'state' | 'finishedAt'>): void => {
      setSyncingAccountIds((current) => new Set(current).add(accountId))
      setNotice({
        ...notice,
        state: 'running'
      })
    },
    []
  )

  const finishSyncing = React.useCallback(
    (
      accountId: string,
      state: Extract<SyncNotice['state'], 'success' | 'error'>,
      notice: Omit<SyncNotice, 'state' | 'finishedAt'>
    ): void => {
      setNotice({
        ...notice,
        state,
        finishedAt: new Date()
      })
      setSyncingAccountIds((current) => {
        const next = new Set(current)
        next.delete(accountId)
        return next
      })
    },
    []
  )

  const clearSyncing = React.useCallback((accountId: string): void => {
    setSyncingAccountIds((current) => {
      const next = new Set(current)
      next.delete(accountId)
      return next
    })
  }, [])

  return {
    syncingAccountIds,
    syncNotice,
    startSyncing,
    finishSyncing,
    setNotice,
    clearSyncing
  }
}

export function formatSyncNotice(notice: SyncNotice): string {
  if (notice.state === 'idle') return ''
  if (notice.state === 'running') return notice.message ?? '正在同步...'

  const message = notice.message ?? (notice.state === 'success' ? '同步完成' : '同步失败')
  const elapsedSeconds =
    notice.startedAt && notice.finishedAt
      ? Math.max(1, Math.round((notice.finishedAt.getTime() - notice.startedAt.getTime()) / 1000))
      : undefined

  return elapsedSeconds ? `${message}，耗时 ${elapsedSeconds} 秒` : message
}
