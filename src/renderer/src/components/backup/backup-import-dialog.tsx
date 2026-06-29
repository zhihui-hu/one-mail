import { CheckCircle2, DatabaseBackup, Download, LoaderCircle, XCircle } from 'lucide-react'
import * as React from 'react'

import { importBackupFromRemote, importSqlBackup, onBackupImportProgress } from '@renderer/lib/api'
import { createBackupSyncDraft } from '@renderer/components/backup/backup-sync-draft'
import { BackupSyncFields } from '@renderer/components/backup/backup-sync-fields'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Progress } from '@renderer/components/ui/progress'
import { cn } from '@renderer/lib/utils'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type {
  BackupImportProgress,
  BackupImportResult,
  BackupImportSource,
  BackupImportStage,
  BackupSyncDownloadResult,
  BackupSyncSettings
} from '../../../../shared/types'

export type BackupImportDialogSource = 'sql' | 'webdav' | 's3'

type BackupImportDialogProps = {
  open: boolean
  defaultSource?: BackupImportDialogSource
  syncSettings?: BackupSyncSettings | null
  onOpenChange: (open: boolean) => void
  onImported: (
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ) => Promise<void> | void
  onBusyChange?: (busy: boolean) => void
}

type ImportOutcome =
  | {
      state: 'success'
      label: string
      path?: string
    }
  | {
      state: 'canceled'
      label: string
    }

const LOCAL_STAGES: BackupImportStage[] = [
  'selecting_file',
  'reading_file',
  'validating_backup',
  'restoring_database',
  'loading_stats',
  'completed'
]

const REMOTE_STAGES: BackupImportStage[] = [
  'downloading_remote',
  'validating_backup',
  'restoring_database',
  'loading_stats',
  'completed'
]

export function BackupImportDialog({
  open,
  defaultSource = 'sql',
  syncSettings,
  onOpenChange,
  onImported,
  onBusyChange
}: BackupImportDialogProps): React.JSX.Element | null {
  const { t } = useI18n()
  const [remoteDraft, setRemoteDraft] = React.useState<BackupSyncSettings>(() =>
    createRemoteImportDraft(defaultSource, syncSettings)
  )
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<BackupImportProgress | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [outcome, setOutcome] = React.useState<ImportOutcome | null>(null)
  const operationIdRef = React.useRef<string | null>(null)
  const onBusyChangeRef = React.useRef(onBusyChange)

  const stages = progress?.source === 'local' ? LOCAL_STAGES : REMOTE_STAGES
  const remoteDialogSource = defaultSource === 'sql' ? null : defaultSource
  const showRemoteForm = Boolean(remoteDialogSource && !busy && !progress && !outcome)
  const hideLocalFilePickerDialog =
    defaultSource === 'sql' &&
    !outcome &&
    !error &&
    (!progress || progress.stage === 'selecting_file')
  const dialogDescriptionKey = showRemoteForm
    ? 'settings.backup.importRemoteConfigDescription'
    : 'settings.backup.importDialogSourceDescription'

  React.useEffect(() => {
    onBusyChangeRef.current = onBusyChange
  }, [onBusyChange])

  React.useEffect(() => {
    return onBackupImportProgress((nextProgress) => {
      if (nextProgress.operationId !== operationIdRef.current) return
      setProgress(nextProgress)
    })
  }, [])

  React.useEffect(() => {
    if (open) return
    operationIdRef.current = null

    const timer = window.setTimeout(() => {
      setBusy(false)
      setProgress(null)
      setError(null)
      setOutcome(null)
      setRemoteDraft(createRemoteImportDraft(defaultSource, syncSettings))
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [defaultSource, open, syncSettings])

  React.useEffect(() => {
    if (!open) return

    const timer = window.setTimeout(() => {
      setRemoteDraft(createRemoteImportDraft(defaultSource, syncSettings))
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [defaultSource, open, syncSettings])

  React.useEffect(() => {
    onBusyChangeRef.current?.(busy)
  }, [busy])

  const runImport = React.useCallback(
    async (source: BackupImportDialogSource, remoteInput?: BackupSyncSettings): Promise<void> => {
      if (busy) return
      const importSource = source === 'sql' ? 'local' : source
      const remoteSettings =
        source === 'sql' ? undefined : resolveRemoteImportSettings(source, remoteInput)
      if (source !== 'sql' && !remoteSettings) {
        setError(
          t('settings.backup.importRemoteConfigRequired', {
            provider: formatBackupImportSource(source)
          })
        )
        return
      }

      const operationId = createOperationId()
      operationIdRef.current = operationId
      setBusy(true)
      setError(null)
      setOutcome(null)
      setProgress(createInitialProgress(operationId, importSource))

      try {
        let result: BackupImportResult | BackupSyncDownloadResult
        if (source === 'sql') {
          result = await importSqlBackup(operationId)
        } else {
          if (!remoteSettings) throw new Error(t('settings.backup.error'))
          result = await importBackupFromRemote(remoteSettings, operationId)
        }

        if (!result.imported) {
          setProgress(null)
          if (source === 'sql') {
            onOpenChange(false)
          } else {
            setOutcome({ state: 'canceled', label: t('settings.backup.importCanceled') })
          }
          return
        }

        setOutcome({
          state: 'success',
          label: formatImportResultMessage(result, importSource, t),
          path: importSource === 'local' ? result.filePath : getRemoteResultPath(result)
        })
        await onImported(result, importSource)
      } catch (importError) {
        setProgress(null)
        setError(getImportErrorMessage(importError, t))
      } finally {
        operationIdRef.current = null
        setBusy(false)
      }
    },
    [busy, onImported, onOpenChange, t]
  )

  React.useEffect(() => {
    if (!open || defaultSource !== 'sql' || busy || progress || outcome || error) return

    const timer = window.setTimeout(() => {
      void runImport(defaultSource)
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [busy, defaultSource, error, open, outcome, progress, runImport])

  function handleOpenChange(nextOpen: boolean): void {
    if (busy && !nextOpen) return
    onOpenChange(nextOpen)
  }

  function handleRemoteSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void runImport(defaultSource, remoteDraft)
  }

  if (hideLocalFilePickerDialog) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md gap-2.5 p-4" showCloseButton={!busy}>
        <DialogHeader className="gap-1">
          <DialogTitle>{t('settings.backup.importDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t(dialogDescriptionKey, {
              source: formatBackupImportSource(defaultSource),
              provider: formatBackupImportSource(defaultSource)
            })}
          </DialogDescription>
        </DialogHeader>

        {busy || progress ? <ImportProgressView progress={progress} stages={stages} /> : null}

        {showRemoteForm && remoteDialogSource ? (
          <RemoteImportForm
            source={remoteDialogSource}
            draft={remoteDraft}
            disabled={busy}
            onChange={setRemoteDraft}
            onSubmit={handleRemoteSubmit}
          />
        ) : null}

        {outcome ? <ImportOutcomeView outcome={outcome} /> : null}
        {error ? (
          <Alert variant="destructive" className="py-2 text-xs">
            <XCircle />
            <AlertTitle>{t('settings.backup.error')}</AlertTitle>
            <AlertDescription className="break-words text-xs">{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="pt-1">
          <Button variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>
            {outcome || error ? t('common.close') : t('common.cancel')}
          </Button>
          {showRemoteForm ? (
            <Button type="submit" form="backup-remote-import-form" disabled={busy}>
              <Download data-icon="inline-start" />
              {t('settings.backup.importStart')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImportProgressView({
  progress,
  stages
}: {
  progress: BackupImportProgress | null
  stages: BackupImportStage[]
}): React.JSX.Element {
  const { t } = useI18n()
  const activeStage = progress?.stage ?? stages[0]
  const activeIndex = Math.max(stages.indexOf(activeStage), 0)
  const completed = activeStage === 'completed'
  const StatusIcon = completed ? CheckCircle2 : LoaderCircle

  return (
    <div className="flex flex-col gap-2.5 rounded-md border bg-card p-2.5">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md bg-muted',
            completed ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          <StatusIcon
            className={cn('size-4', completed ? '' : 'animate-spin')}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {completed ? t('settings.backup.importStageCompleted') : t('settings.backup.importing')}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {t(getImportStageLabelKey(activeStage))}
          </div>
        </div>
      </div>

      <Progress value={progress?.percent ?? 5} />

      <div className="grid gap-1">
        {stages.map((stage, index) => (
          <div
            key={stage}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              index <= activeIndex ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {index < activeIndex || activeStage === 'completed' ? (
              <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            ) : index === activeIndex ? (
              <LoaderCircle
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <span className="size-3.5 rounded-full border" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{t(getImportStageLabelKey(stage))}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RemoteImportForm({
  source,
  draft,
  disabled,
  onChange,
  onSubmit
}: {
  source: Exclude<BackupImportDialogSource, 'sql'>
  draft: BackupSyncSettings
  disabled: boolean
  onChange: (nextDraft: BackupSyncSettings) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <form
      id="backup-remote-import-form"
      className="flex flex-col gap-2 rounded-md border bg-card p-3"
      onSubmit={onSubmit}
    >
      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium">
          {t('settings.backup.importRemoteProviderTitle', {
            provider: formatBackupImportSource(source)
          })}
        </div>
        <div className="text-xs leading-snug text-muted-foreground">
          {t(
            source === 'webdav'
              ? 'settings.backup.importWebDavDescription'
              : 'settings.backup.importS3Description'
          )}
        </div>
      </div>
      <BackupSyncFields
        draft={draft}
        disabled={disabled}
        idPrefix={`backup-import-${source}`}
        showProvider={false}
        onChange={onChange}
      />
    </form>
  )
}

function ImportOutcomeView({ outcome }: { outcome: ImportOutcome }): React.JSX.Element {
  const Icon = outcome.state === 'success' ? CheckCircle2 : DatabaseBackup

  return (
    <Alert className="py-2 text-xs [&>svg]:size-4">
      <Icon className={outcome.state === 'success' ? 'text-primary' : undefined} />
      <AlertTitle>{outcome.label}</AlertTitle>
      {outcome.state === 'success' && outcome.path ? (
        <AlertDescription className="break-all text-xs">{outcome.path}</AlertDescription>
      ) : null}
    </Alert>
  )
}

function createInitialProgress(
  operationId: string,
  source: BackupImportSource
): BackupImportProgress {
  return {
    operationId,
    source,
    stage: source === 'local' ? 'selecting_file' : 'downloading_remote',
    percent: 5
  }
}

function createOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatImportResultMessage(
  result: BackupImportResult | BackupSyncDownloadResult,
  source: BackupImportSource,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const values = {
    accounts: result.accountCount ?? 0,
    messages: result.messageCount ?? 0
  }

  return t(
    source === 'local'
      ? 'settings.backup.importedSummary'
      : 'settings.backup.remoteDownloadedSummary',
    values
  )
}

function getRemoteResultPath(
  result: BackupImportResult | BackupSyncDownloadResult
): string | undefined {
  return 'remotePath' in result ? result.remotePath : undefined
}

function createRemoteImportDraft(
  source: BackupImportDialogSource,
  settings?: BackupSyncSettings | null
): BackupSyncSettings {
  if (source === 'sql') return { provider: 'none' }
  return createBackupSyncDraft(source, settings?.provider === source ? settings : null)
}

function resolveRemoteImportSettings(
  source: Exclude<BackupImportDialogSource, 'sql'>,
  input: BackupSyncSettings | undefined
): BackupSyncSettings | undefined {
  return input?.provider === source ? input : undefined
}

function formatBackupImportSource(source: BackupImportDialogSource | BackupImportSource): string {
  if (source === 'webdav') return 'WebDAV'
  if (source === 's3') return 'S3'
  return 'SQL'
}

function getImportStageLabelKey(stage: BackupImportStage): TranslationKey {
  switch (stage) {
    case 'selecting_file':
      return 'settings.backup.importStageSelecting'
    case 'reading_file':
      return 'settings.backup.importStageReading'
    case 'downloading_remote':
      return 'settings.backup.importStageDownloading'
    case 'validating_backup':
      return 'settings.backup.importStageValidating'
    case 'restoring_database':
      return 'settings.backup.importStageRestoring'
    case 'loading_stats':
      return 'settings.backup.importStageLoadingStats'
    case 'completed':
      return 'settings.backup.importStageCompleted'
  }
}

function getImportErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  const message = error instanceof Error ? error.message : t('settings.backup.error')
  return message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
}
