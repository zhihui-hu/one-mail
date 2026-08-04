import { zodResolver } from '@hookform/resolvers/zod'
import {
  BadgeInfo,
  CalendarRange,
  ChevronRight,
  Cloud,
  Clock3,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  KeyRound,
  Languages,
  Power,
  RefreshCcw,
  Server,
  ShieldCheck,
  Upload
} from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import {
  exportSqlBackup,
  loadBackupSyncSettings,
  openExternalUrl,
  revealPathInFileManager,
  saveBackupSyncSettings,
  testBackupSyncSettings,
  uploadBackupSync
} from '@renderer/pages/mailbox/api'
import {
  BackupImportDialog,
  type BackupImportDialogSource
} from '@renderer/components/backup/backup-import-dialog'
import { BackupSyncConfigDialog } from '@renderer/components/backup/backup-sync-config-dialog'
import { getBackupSyncSettingsKey } from '@renderer/components/backup/backup-sync-draft'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { SweepShine } from '@renderer/components/sweep-shine'
import { UnderlineHover } from '@renderer/components/underline-hover'
import { Button } from '@renderer/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Alert, AlertTitle } from '@renderer/components/ui/alert'
import type {
  AppSettings,
  AppUpdateStatus,
  BackupImportResult,
  BackupImportSource,
  BackupSyncDownloadResult,
  BackupSyncSettings,
  SettingsUpdateInput,
  SystemInfo
} from '@renderer/shared/types'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { ONEMAIL_HOMEPAGE_URL, hasAvailableUpdate } from '@renderer/lib/update-status'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettings | null
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
  initialSection?: SettingsSection
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
  onImported?: () => Promise<void> | void
}

type SettingsSection = 'general' | 'backup' | 'about'
type BackupPending =
  | 'export'
  | 'import'
  | 'saveRemote'
  | 'testRemote'
  | 'uploadRemote'
  | 'downloadRemote'
  | null
type BackupMessage = {
  label: string
  path?: string
}

const AUTO_SAVE_DELAY_MS = 350

type SettingsFormValues = {
  syncIntervalMinutes: number
  syncWindowDays: number
  openAtLogin: boolean
  externalImagesBlocked: boolean
  locale: 'zh-CN' | 'en-US'
}

const sections: Array<{
  value: SettingsSection
  labelKey: TranslationKey
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  {
    value: 'general',
    labelKey: 'settings.general',
    icon: RefreshCcw
  },
  {
    value: 'backup',
    labelKey: 'settings.backup',
    icon: DatabaseBackup
  },
  {
    value: 'about',
    labelKey: 'settings.about',
    icon: BadgeInfo
  }
]

export function SettingsDialog({
  open,
  settings,
  systemInfo,
  updateStatus,
  initialSection = 'general',
  onOpenChange,
  onSubmit,
  onImported
}: SettingsDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const settingsSchema = React.useMemo(() => createSettingsSchema(t), [t])
  const [section, setSection] = React.useState<SettingsSection>('general')
  const [pending, setPending] = React.useState(false)
  const [backupPending, setBackupPending] = React.useState<BackupPending>(null)
  const [backupImportDialogOpen, setBackupImportDialogOpen] = React.useState(false)
  const [backupImportDefaultSource, setBackupImportDefaultSource] =
    React.useState<BackupImportDialogSource>('sql')
  const [backupImportSyncSettings, setBackupImportSyncSettings] =
    React.useState<BackupSyncSettings | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [backupMessage, setBackupMessage] = React.useState<BackupMessage | null>(null)
  const [backupError, setBackupError] = React.useState<string | null>(null)
  const [backupSyncSettings, setBackupSyncSettings] = React.useState<BackupSyncSettings | null>(
    null
  )
  const lastSavedValuesRef = React.useRef<SettingsFormValues>(toFormValues(settings))
  const autoSaveTimerRef = React.useRef<number | null>(null)
  const queuedValuesRef = React.useRef<SettingsFormValues | null>(null)
  const savingRef = React.useRef(false)
  const wasOpenRef = React.useRef(false)
  const backupImportSourceRef = React.useRef<BackupImportDialogSource>('sql')
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(settings),
    mode: 'onChange'
  })
  const watchedValues = useWatch({ control: form.control })

  const saveSettingsValues = React.useCallback(
    async (values: SettingsFormValues): Promise<void> => {
      if (areSettingsEqual(values, lastSavedValuesRef.current)) return
      if (savingRef.current) {
        queuedValuesRef.current = values
        return
      }

      savingRef.current = true
      setPending(true)
      setError(null)

      let nextValues: SettingsFormValues | null = values
      while (nextValues) {
        const currentValues = nextValues
        queuedValuesRef.current = null

        try {
          await onSubmit({
            syncIntervalMinutes: currentValues.syncIntervalMinutes,
            syncWindowDays: currentValues.syncWindowDays,
            openAtLogin: currentValues.openAtLogin,
            externalImagesBlocked: currentValues.externalImagesBlocked,
            locale: currentValues.locale
          })
          lastSavedValuesRef.current = currentValues
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : t('settings.updateError'))
          break
        }

        nextValues = queuedValuesRef.current
        if (nextValues && areSettingsEqual(nextValues, lastSavedValuesRef.current)) {
          nextValues = null
        }
      }

      savingRef.current = false
      queuedValuesRef.current = null
      setPending(false)
    },
    [onSubmit, t]
  )

  const flushPendingSettings = React.useCallback((): void => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(form.getValues())
    if (parsedValues.success) {
      void saveSettingsValues(parsedValues.data)
    }
  }, [form, saveSettingsValues, settingsSchema])

  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return

    const nextValues = toFormValues(settings)
    lastSavedValuesRef.current = nextValues
    form.reset(nextValues)
    setSection(initialSection)
    wasOpenRef.current = true
  }, [form, initialSection, open, settings])

  React.useEffect(() => {
    if (!open || section !== 'backup') return
    if (!('__TAURI_INTERNALS__' in window)) return

    let cancelled = false
    void loadBackupSyncSettings()
      .then((nextSettings) => {
        if (!cancelled) setBackupSyncSettings(nextSettings)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setBackupError(
            loadError instanceof Error ? loadError.message : t('settings.backup.error')
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, section, t])

  React.useEffect(() => {
    if (!open) return

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(watchedValues)
    if (!parsedValues.success) return
    if (areSettingsEqual(parsedValues.data, lastSavedValuesRef.current)) return

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveSettingsValues(parsedValues.data)
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [open, saveSettingsValues, settingsSchema, watchedValues])

  React.useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  function handleOpenChange(nextOpen: boolean): void {
    if ((pending || backupPending) && !nextOpen) return

    if (!nextOpen) {
      flushPendingSettings()
      setError(null)
      setBackupError(null)
      setBackupMessage(null)
      setSection('general')
    }
    onOpenChange(nextOpen)
  }

  async function handleExport(): Promise<void> {
    await runBackupAction('export', async () => {
      const path = await exportSqlBackup()
      setBackupMessage(
        path
          ? { label: t('settings.backup.exported'), path }
          : { label: t('settings.backup.exportCanceled') }
      )
    })
  }

  function handleImport(): void {
    openBackupImportDialog('sql')
  }

  async function handleSaveBackupSync(input: BackupSyncSettings): Promise<boolean> {
    return runBackupAction('saveRemote', async () => {
      const nextSettings = await saveBackupSyncSettings(input)
      setBackupSyncSettings(nextSettings)
      setBackupMessage({ label: t('settings.backup.remoteSaved') })
    })
  }

  async function handleTestBackupSync(input: BackupSyncSettings): Promise<boolean> {
    return runBackupAction('testRemote', async () => {
      const result = await testBackupSyncSettings(input)
      setBackupMessage({
        label: t('settings.backup.remoteTested'),
        path: result.remotePath
      })
    })
  }

  async function handleUploadBackupSync(): Promise<void> {
    await runBackupAction('uploadRemote', async () => {
      const result = await uploadBackupSync()
      setBackupMessage({
        label: t('settings.backup.remoteUploaded'),
        path: result.remotePath
      })
    })
  }

  function handleDownloadBackupSync(input: BackupSyncSettings): void {
    if (input.provider === 'none') return
    openBackupImportDialog(input.provider, input)
  }

  function openBackupImportDialog(
    source: BackupImportDialogSource,
    syncInput?: BackupSyncSettings
  ): void {
    if (backupPending) return
    backupImportSourceRef.current = source
    setBackupImportDefaultSource(source)
    setBackupImportSyncSettings(syncInput ?? null)
    setBackupError(null)
    setBackupMessage(null)
    setBackupImportDialogOpen(true)
  }

  function handleBackupImportBusyChange(busy: boolean): void {
    setBackupPending(
      busy ? (backupImportSourceRef.current === 'sql' ? 'import' : 'downloadRemote') : null
    )
  }

  async function handleBackupImported(
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ): Promise<void> {
    const remote = source !== 'local'
    setBackupMessage({
      label: formatImportResultMessage(result, remote, t),
      path: remote && 'remotePath' in result ? result.remotePath : result.filePath
    })
    await onImported?.()
  }

  async function runBackupAction(
    action: Exclude<BackupPending, null>,
    task: () => Promise<void>
  ): Promise<boolean> {
    setBackupPending(action)
    setBackupError(null)
    setBackupMessage(null)

    try {
      await task()
      return true
    } catch (backupActionError) {
      setBackupError(getBackupActionErrorMessage(backupActionError, t))
      return false
    } finally {
      setBackupPending(null)
    }
  }

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('settings.title')}
        contentClassName="h-[min(560px,90dvh)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(500px,86vh)] sm:max-w-[720px] md:grid-rows-[auto_minmax(0,1fr)]"
        headerClassName="shrink-0 border-b bg-background px-4 py-2.5 pr-12 [&_[data-slot=dialog-title]]:text-sm! [&_[data-slot=drawer-title]]:text-sm!"
        bodyClassName="h-full min-h-0 overflow-hidden"
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[144px_minmax(0,1fr)] md:grid-rows-1">
          <nav
            className="flex shrink-0 gap-1 border-b bg-muted/40 p-2 md:h-full md:flex-col md:border-r md:border-b-0"
            aria-label={t('settings.title')}
          >
            {sections.map((item) => {
              const Icon = item.icon
              const active = section === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium transition-colors md:flex-none md:justify-start ${
                    active
                      ? 'bg-background/95 text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/8'
                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                  }`}
                  onClick={() => setSection(item.value)}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              )
            })}
          </nav>

          <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-muted/25">
            <div className="flex h-10 items-center border-b bg-background/90 px-4">
              <h2 className="text-sm font-semibold">
                {t(sections.find((item) => item.value === section)?.labelKey ?? 'settings.general')}
              </h2>
            </div>
            <div className="min-h-0 overflow-auto">
              {section === 'general' ? (
                <GeneralSettingsForm form={form} error={error} />
              ) : section === 'backup' ? (
                <BackupSettings
                  key={getBackupSyncSettingsKey(backupSyncSettings)}
                  pending={backupPending}
                  message={backupMessage}
                  error={backupError}
                  syncSettings={backupSyncSettings}
                  onExport={handleExport}
                  onImport={handleImport}
                  onSaveSync={handleSaveBackupSync}
                  onTestSync={handleTestBackupSync}
                  onUploadSync={handleUploadBackupSync}
                  onDownloadSync={handleDownloadBackupSync}
                />
              ) : (
                <AboutSettings systemInfo={systemInfo} updateStatus={updateStatus} />
              )}
            </div>
          </div>
        </div>
      </ResponsiveDialog>

      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportDefaultSource}
        syncSettings={backupImportSyncSettings ?? backupSyncSettings ?? undefined}
        onOpenChange={(nextOpen) => {
          setBackupImportDialogOpen(nextOpen)
          if (!nextOpen) setBackupImportSyncSettings(null)
        }}
        onBusyChange={handleBackupImportBusyChange}
        onImported={handleBackupImported}
      />
    </>
  )
}

function GeneralSettingsForm({
  form,
  error
}: {
  form: ReturnType<typeof useForm<SettingsFormValues>>
  error: string | null
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 sm:p-4">
      <SettingsGroup title={t('settings.group.application')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <Controller
            control={form.control}
            name="openAtLogin"
            render={({ field }) => (
              <SettingRow
                icon={Power}
                iconClassName="bg-blue-500"
                title={t('settings.openAtLogin.title')}
                description={t('settings.openAtLogin.description')}
                control={
                  <Switch
                    id="open-at-login"
                    size="sm"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                }
              />
            )}
          />

          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <SettingRow
                icon={Languages}
                iconClassName="bg-indigo-500"
                title={t('settings.locale.title')}
                description={t('settings.locale.description')}
                control={
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id="locale"
                      size="sm"
                      className="w-32"
                      aria-invalid={Boolean(form.formState.errors.locale)}
                    >
                      <SelectValue placeholder={t('settings.locale.placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="zh-CN">{t('settings.locale.zhCN')}</SelectItem>
                        <SelectItem value="en-US">{t('settings.locale.enUS')}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
                error={form.formState.errors.locale?.message}
                invalid={Boolean(form.formState.errors.locale)}
              />
            )}
          />
        </FieldGroup>
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.sync')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <SettingRow
            icon={Clock3}
            iconClassName="bg-emerald-500"
            title={t('settings.syncInterval.title')}
            description={t('settings.syncInterval.description')}
            control={
              <Input
                id="sync-interval-minutes"
                className="h-7 w-24 px-2 text-xs"
                type="number"
                min={0}
                max={1440}
                aria-invalid={Boolean(form.formState.errors.syncIntervalMinutes)}
                {...form.register('syncIntervalMinutes', { valueAsNumber: true })}
              />
            }
            error={form.formState.errors.syncIntervalMinutes?.message}
            invalid={Boolean(form.formState.errors.syncIntervalMinutes)}
          />

          <SettingRow
            icon={CalendarRange}
            iconClassName="bg-cyan-500"
            title={t('settings.syncWindow.title')}
            description={t('settings.syncWindow.description')}
            control={
              <Input
                id="sync-window-days"
                className="h-7 w-24 px-2 text-xs"
                type="number"
                min={1}
                max={3650}
                aria-invalid={Boolean(form.formState.errors.syncWindowDays)}
                {...form.register('syncWindowDays', { valueAsNumber: true })}
              />
            }
            error={form.formState.errors.syncWindowDays?.message}
            invalid={Boolean(form.formState.errors.syncWindowDays)}
          />
        </FieldGroup>
      </SettingsGroup>

      <SettingsGroup title={t('settings.group.privacy')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <Controller
            control={form.control}
            name="externalImagesBlocked"
            render={({ field }) => (
              <SettingRow
                icon={ShieldCheck}
                iconClassName="bg-orange-500"
                title={t('settings.externalContent.title')}
                description={t('settings.externalContent.description')}
                control={
                  <Switch
                    id="external-images-blocked"
                    size="sm"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                }
              />
            )}
          />
        </FieldGroup>
      </SettingsGroup>

      {error ? <FieldError className="px-1 text-xs">{error}</FieldError> : null}
    </div>
  )
}

function BackupSettings({
  pending,
  message,
  error,
  syncSettings,
  onExport,
  onImport,
  onSaveSync,
  onTestSync,
  onUploadSync,
  onDownloadSync
}: {
  pending: BackupPending
  message: BackupMessage | null
  error: string | null
  syncSettings: BackupSyncSettings | null
  onExport: () => Promise<void>
  onImport: () => void
  onSaveSync: (input: BackupSyncSettings) => Promise<boolean>
  onTestSync: (input: BackupSyncSettings) => Promise<boolean>
  onUploadSync: () => Promise<void>
  onDownloadSync: (input: BackupSyncSettings) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [configOpen, setConfigOpen] = React.useState(false)
  const disabled = Boolean(pending)
  const remoteSettings =
    syncSettings && syncSettings.provider !== 'none' ? syncSettings : null
  const RemoteIcon = remoteSettings?.provider === 'webdav' ? Server : Cloud

  return (
    <>
      <div className="flex min-h-full w-full flex-col gap-3 p-3 sm:p-4">
        <SettingsGroup title={t('settings.backup.localGroup')}>
          <div className={SETTINGS_LIST_CLASS}>
            <BackupActionButton
              icon={Download}
              iconClassName="bg-blue-500"
              title={t('settings.backup.export')}
              loadingTitle={t('settings.backup.exporting')}
              description={t('settings.backup.exportDescription')}
              loading={pending === 'export'}
              disabled={disabled}
              onClick={onExport}
            />
            <BackupActionButton
              icon={FileUp}
              iconClassName="bg-emerald-500"
              title={t('settings.backup.import')}
              loadingTitle={t('settings.backup.importing')}
              description={t('settings.backup.importDescription')}
              loading={pending === 'import'}
              disabled={disabled}
              onClick={onImport}
            />
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.backup.remoteGroup')}>
          <div className={SETTINGS_LIST_CLASS}>
            {remoteSettings ? (
              <button
                type="button"
                className="flex min-h-12 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
                disabled={disabled}
                onClick={() => setConfigOpen(true)}
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-cyan-500 text-white shadow-sm">
                  <RemoteIcon className="size-3.5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">
                    {remoteSettings.provider === 'webdav' ? 'WebDAV' : 'S3'}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatRemoteSettingsSummary(remoteSettings)}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {t('settings.backup.remoteEdit')}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
                disabled={disabled}
                onClick={() => setConfigOpen(true)}
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-cyan-500 text-white shadow-sm">
                  <Cloud className="size-3.5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">
                    {t('settings.backup.remoteEmptyTitle')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('settings.backup.remoteEmptyDescription')}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-primary">
                  {t('settings.backup.remoteAdd')}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              </button>
            )}

            {remoteSettings ? (
              <>
                <BackupActionButton
                  icon={RefreshCcw}
                  iconClassName="bg-teal-500"
                  title={t('settings.backup.remoteTest')}
                  loadingTitle={t('settings.backup.remoteTesting')}
                  loading={pending === 'testRemote'}
                  disabled={disabled}
                  onClick={async () => {
                    await onTestSync(remoteSettings)
                  }}
                />
                <BackupActionButton
                  icon={Upload}
                  iconClassName="bg-blue-500"
                  title={t('settings.backup.remoteUpload')}
                  loadingTitle={t('settings.backup.remoteUploading')}
                  loading={pending === 'uploadRemote'}
                  disabled={disabled}
                  onClick={onUploadSync}
                />
                <BackupActionButton
                  icon={Download}
                  iconClassName="bg-orange-500"
                  title={t('settings.backup.remoteDownload')}
                  loadingTitle={t('settings.backup.remoteDownloading')}
                  loading={pending === 'downloadRemote'}
                  disabled={disabled}
                  onClick={() => onDownloadSync(remoteSettings)}
                />
              </>
            ) : null}
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.backup.securityGroup')}>
          <div className={`${SETTINGS_LIST_CLASS} flex min-h-12 items-center gap-2.5 px-3 py-2`}>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-white shadow-sm">
              <KeyRound className="size-3.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium">{t('settings.backup.securityTitle')}</div>
              <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                {t('settings.backup.securityDescription')}
              </div>
            </div>
          </div>
        </SettingsGroup>

        {message ? <BackupMessageView message={message} /> : null}
        {error && !configOpen ? <FieldError>{error}</FieldError> : null}
      </div>

      <BackupSyncConfigDialog
        open={configOpen}
        currentSettings={syncSettings}
        saving={pending === 'saveRemote'}
        testing={pending === 'testRemote'}
        error={error}
        onOpenChange={setConfigOpen}
        onSave={onSaveSync}
        onTest={onTestSync}
      />
    </>
  )
}

function formatRemoteSettingsSummary(settings: BackupSyncSettings): string {
  if (settings.provider === 'webdav') return settings.remoteUrl
  if (settings.provider === 's3') {
    const endpoint = settings.endpoint ? `${settings.endpoint.replace(/\/$/, '')} · ` : ''
    return `${endpoint}${settings.bucket}/${settings.key}`
  }
  return ''
}

function formatImportResultMessage(
  result: BackupImportResult,
  remote: boolean,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const values = {
    accounts: result.accountCount ?? 0,
    messages: result.messageCount ?? 0
  }

  return t(
    remote ? 'settings.backup.remoteDownloadedSummary' : 'settings.backup.importedSummary',
    values
  )
}

function getBackupActionErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
          ? error.message
          : t('settings.backup.error')
  return message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
}

function AboutSettings({
  systemInfo,
  updateStatus
}: {
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
}): React.JSX.Element {
  const { t } = useI18n()
  const version = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : t('common.loading')
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const versionTitle =
    hasUpdate && updateStatus?.latestVersion
      ? t('settings.about.updateVersionTooltip', { version: updateStatus.latestVersion })
      : hasUpdate
        ? t('settings.about.updateAvailable')
        : undefined

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 sm:p-4">
      <SettingsGroup title={t('settings.about.appGroup')}>
        <FieldGroup className={SETTINGS_LIST_CLASS}>
          <SettingRow
            icon={BadgeInfo}
            iconClassName="bg-blue-500"
            title="OneMail"
            description={
              <span>
                {t('settings.about.versionPrefix')}{' '}
                {hasUpdate ? (
                  <UnderlineHover asChild>
                    <button
                      type="button"
                      className="rounded-sm font-medium text-warning outline-none transition-colors hover:text-warning focus-visible:ring-2 focus-visible:ring-ring"
                      title={versionTitle}
                      onClick={() => void openExternalUrl(ONEMAIL_HOMEPAGE_URL)}
                    >
                      {version}
                    </button>
                  </UnderlineHover>
                ) : (
                  <span>{version}</span>
                )}
                {t('settings.about.versionSuffix')}
              </span>
            }
            control={
              <UnderlineHover asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openExternalUrl('https://github.com/zhihui-hu/one-mail')}
                >
                  <ExternalLink data-icon="inline-start" />
                  GitHub
                </Button>
              </UnderlineHover>
            }
          />
        </FieldGroup>
      </SettingsGroup>
    </div>
  )
}

function BackupMessageView({ message }: { message: BackupMessage }): React.JSX.Element {
  const isRemotePath =
    message.path?.startsWith('http://') === true || message.path?.startsWith('https://') === true

  if (!message.path) {
    return (
      <Alert className="py-2 text-xs">
        <ShieldCheck />
        <AlertTitle>{message.label}</AlertTitle>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <ShieldCheck aria-hidden="true" />
        <span>{message.label}</span>
      </div>
      <Button
        className="h-auto justify-start break-all px-0 py-0 text-left whitespace-normal"
        variant="link"
        size="sm"
        onClick={() =>
          void (isRemotePath
            ? openExternalUrl(message.path!)
            : revealPathInFileManager(message.path!))
        }
      >
        <FolderOpen data-icon="inline-start" />
        {message.path}
      </Button>
    </div>
  )
}

function SettingsGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="grid gap-1.5">
      <div className="flex min-h-5 items-center gap-2 px-1">
        <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function SettingRow({
  icon: Icon,
  iconClassName,
  title,
  description,
  control,
  error,
  invalid = false
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  iconClassName: string
  title: string
  description: React.ReactNode
  control?: React.ReactNode
  error?: string
  invalid?: boolean
}): React.JSX.Element {
  return (
    <Field data-invalid={invalid || undefined}>
      <div className="grid min-h-12 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 gap-2.5">
          <div
            className={`mt-px flex size-7 shrink-0 items-center justify-center rounded-md text-white shadow-sm [&_svg]:size-3.5 ${iconClassName}`}
          >
            <Icon aria-hidden="true" />
          </div>
          <FieldContent>
            <FieldLabel className="text-xs font-medium">{title}</FieldLabel>
            <FieldDescription className="text-xs leading-tight">{description}</FieldDescription>
            <FieldError className="text-xs">{error}</FieldError>
          </FieldContent>
        </div>
        {control ? <div className="flex justify-start sm:justify-end">{control}</div> : null}
      </div>
    </Field>
  )
}

function BackupActionButton({
  icon: Icon,
  iconClassName,
  title,
  loadingTitle,
  description,
  loading,
  disabled,
  onClick
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  iconClassName: string
  title: string
  loadingTitle: string
  description?: string
  loading: boolean
  disabled: boolean
  onClick: () => void | Promise<void>
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex min-h-12 w-full min-w-0 items-center gap-2.5 border-t border-border/60 px-3 py-2 text-left outline-none first:border-t-0 hover:bg-muted/45 focus-visible:bg-muted/45 disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-md text-white shadow-sm ${iconClassName}`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">
          {loading ? <SweepShine>{loadingTitle}</SweepShine> : title}
        </span>
        {description ? (
          <span className="text-xs font-normal text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  )
}

const SETTINGS_LIST_CLASS =
  'gap-0 overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/8 [&>[data-slot=field]+[data-slot=field]]:border-t [&>[data-slot=field]+[data-slot=field]]:border-border/60'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createSettingsSchema(t: (key: TranslationKey) => string) {
  return z.object({
    syncIntervalMinutes: z.coerce
      .number<number>(t('settings.syncInterval.errorRequired'))
      .int(t('settings.syncInterval.errorInteger'))
      .min(0, t('settings.syncInterval.errorMin'))
      .max(1440, t('settings.syncInterval.errorMax')),
    syncWindowDays: z.coerce
      .number<number>(t('settings.syncWindow.errorRequired'))
      .int(t('settings.syncWindow.errorInteger'))
      .min(1, t('settings.syncWindow.errorMin'))
      .max(3650, t('settings.syncWindow.errorMax')),
    openAtLogin: z.boolean(),
    externalImagesBlocked: z.boolean(),
    locale: z.enum(['zh-CN', 'en-US'])
  })
}

function toFormValues(settings: AppSettings | null): SettingsFormValues {
  return {
    syncIntervalMinutes: settings?.syncIntervalMinutes ?? 15,
    syncWindowDays: settings?.syncWindowDays ?? 90,
    openAtLogin: settings?.openAtLogin === true,
    externalImagesBlocked: settings?.externalImagesBlocked !== false,
    locale: settings?.locale === 'en-US' ? 'en-US' : 'zh-CN'
  }
}

function areSettingsEqual(first: SettingsFormValues, second: SettingsFormValues): boolean {
  return (
    first.syncIntervalMinutes === second.syncIntervalMinutes &&
    first.syncWindowDays === second.syncWindowDays &&
    first.openAtLogin === second.openAtLogin &&
    first.externalImagesBlocked === second.externalImagesBlocked &&
    first.locale === second.locale
  )
}
