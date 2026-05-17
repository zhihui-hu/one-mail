import { zodResolver } from '@hookform/resolvers/zod'
import {
  BadgeInfo,
  CalendarRange,
  Clock3,
  DatabaseBackup,
  Download,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Languages,
  LoaderCircle,
  Power,
  RefreshCcw,
  ShieldCheck,
  Upload
} from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import {
  checkForAppUpdates,
  exportSqlBackup,
  importSqlBackup,
  openExternalUrl,
  revealPathInFileManager
} from '@renderer/lib/api'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
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
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import type {
  AppSettings,
  AppUpdateCheckResult,
  SettingsUpdateInput,
  SystemInfo
} from '../../../../shared/types'
import { cn } from '@renderer/lib/utils'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettings | null
  systemInfo: SystemInfo | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
  onImported?: () => Promise<void> | void
}

type SettingsSection = 'general' | 'backup' | 'about'
type BackupMessage = {
  label: string
  path?: string
}

const AUTO_SAVE_DELAY_MS = 350

type SettingsFormValues = {
  syncIntervalMinutes: number
  syncWindowDays: number
  openAtLogin: boolean
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
  onOpenChange,
  onSubmit,
  onImported
}: SettingsDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const settingsSchema = React.useMemo(() => createSettingsSchema(t), [t])
  const [section, setSection] = React.useState<SettingsSection>('general')
  const [pending, setPending] = React.useState(false)
  const [backupPending, setBackupPending] = React.useState<'export' | 'import' | null>(null)
  const [updatePending, setUpdatePending] = React.useState(false)
  const [updateResult, setUpdateResult] = React.useState<AppUpdateCheckResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [backupMessage, setBackupMessage] = React.useState<BackupMessage | null>(null)
  const [backupError, setBackupError] = React.useState<string | null>(null)
  const lastSavedValuesRef = React.useRef<SettingsFormValues>(toFormValues(settings))
  const autoSaveTimerRef = React.useRef<number | null>(null)
  const queuedValuesRef = React.useRef<SettingsFormValues | null>(null)
  const savingRef = React.useRef(false)
  const wasOpenRef = React.useRef(false)
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
    wasOpenRef.current = true
  }, [form, open, settings])

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
    if ((pending || backupPending || updatePending) && !nextOpen) return

    if (!nextOpen) {
      flushPendingSettings()
      setError(null)
      setBackupError(null)
      setBackupMessage(null)
      setUpdateResult(null)
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

  async function handleImport(): Promise<void> {
    await runBackupAction('import', async () => {
      const result = await importSqlBackup()
      setBackupMessage(
        result.imported
          ? { label: t('settings.backup.imported'), path: result.filePath }
          : { label: t('settings.backup.importCanceled') }
      )
      if (result.imported) {
        await onImported?.()
      }
    })
  }

  async function runBackupAction(
    action: 'export' | 'import',
    task: () => Promise<void>
  ): Promise<void> {
    setBackupPending(action)
    setBackupError(null)
    setBackupMessage(null)

    try {
      await task()
    } catch (backupActionError) {
      setBackupError(
        backupActionError instanceof Error ? backupActionError.message : t('settings.backup.error')
      )
    } finally {
      setBackupPending(null)
    }
  }

  async function handleCheckUpdates(): Promise<void> {
    setUpdatePending(true)
    setUpdateResult(null)

    try {
      const result = await checkForAppUpdates()
      setUpdateResult(result)
    } catch (updateError) {
      setUpdateResult({
        status: 'error',
        currentVersion: systemInfo?.appVersion ?? '',
        message:
          updateError instanceof Error ? updateError.message : t('settings.about.updateError')
      })
    } finally {
      setUpdatePending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('settings.title')}
      contentClassName="h-[min(560px,82vh)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
      headerClassName="shrink-0 border-b px-4 py-3 pr-12 [&_[data-slot=dialog-title]]:text-sm! [&_[data-slot=drawer-title]]:text-sm!"
      bodyClassName="h-full min-h-0 overflow-hidden"
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[136px_minmax(0,1fr)] md:grid-rows-1">
        <nav className="min-h-0 shrink-0 border-b bg-muted/30 p-1.5 md:border-r md:border-b-0 md:p-2">
          <div className="flex gap-1 md:flex-col">
            {sections.map((item) => {
              const Icon = item.icon
              const active = section === item.value

              return (
                <button
                  key={item.value}
                  type="button"
                  className={cn(
                    'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:w-full md:flex-none [&_svg]:size-3.5',
                    active
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                  )}
                  onClick={() => setSection(item.value)}
                >
                  <Icon className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate font-medium">{t(item.labelKey)}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <div className="h-full min-h-0 overflow-auto">
          {section === 'general' ? (
            <GeneralSettingsForm form={form} error={error} />
          ) : section === 'backup' ? (
            <BackupSettings
              pending={backupPending}
              message={backupMessage}
              error={backupError}
              onExport={handleExport}
              onImport={handleImport}
            />
          ) : (
            <AboutSettings
              systemInfo={systemInfo}
              updatePending={updatePending}
              updateResult={updateResult}
              onCheckUpdates={handleCheckUpdates}
            />
          )}
        </div>
      </div>
    </ResponsiveDialog>
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
    <div className="mx-auto flex min-h-full w-full max-w-[540px] flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Controller
          control={form.control}
          name="openAtLogin"
          render={({ field }) => (
            <SettingRow
              icon={Power}
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

        <SettingRow
          icon={Clock3}
          title={t('settings.syncInterval.title')}
          description={t('settings.syncInterval.description')}
          control={
            <Input
              id="sync-interval-minutes"
              className="w-28"
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
          title={t('settings.syncWindow.title')}
          description={t('settings.syncWindow.description')}
          control={
            <Input
              id="sync-window-days"
              className="w-28"
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

        <Controller
          control={form.control}
          name="locale"
          render={({ field }) => (
            <SettingRow
              icon={Languages}
              title={t('settings.locale.title')}
              description={t('settings.locale.description')}
              control={
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="locale"
                    size="sm"
                    className="w-36"
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

        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </div>
  )
}

function BackupSettings({
  pending,
  message,
  error,
  onExport,
  onImport
}: {
  pending: 'export' | 'import' | null
  message: BackupMessage | null
  error: string | null
  onExport: () => Promise<void>
  onImport: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const disabled = Boolean(pending)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[540px] flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Alert className="bg-muted/30 py-2 text-xs">
          <KeyRound />
          <AlertTitle>{t('settings.backup.securityTitle')}</AlertTitle>
          <AlertDescription className="text-xs">
            {t('settings.backup.securityDescription')}
          </AlertDescription>
        </Alert>

        <div className="grid gap-2 sm:grid-cols-2">
          <BackupActionButton
            icon={Download}
            title={t('settings.backup.export')}
            loadingTitle={t('settings.backup.exporting')}
            description={t('settings.backup.exportDescription')}
            loading={pending === 'export'}
            disabled={disabled}
            onClick={onExport}
          />
          <BackupActionButton
            icon={Upload}
            title={t('settings.backup.import')}
            loadingTitle={t('settings.backup.importing')}
            description={t('settings.backup.importDescription')}
            loading={pending === 'import'}
            disabled={disabled}
            onClick={onImport}
          />
        </div>

        {message ? <BackupMessageView message={message} /> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </div>
  )
}

function AboutSettings({
  systemInfo,
  updatePending,
  updateResult,
  onCheckUpdates
}: {
  systemInfo: SystemInfo | null
  updatePending: boolean
  updateResult: AppUpdateCheckResult | null
  onCheckUpdates: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const version = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : t('common.loading')

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[540px] flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <SettingRow
          icon={BadgeInfo}
          title="OneMail"
          description={t('settings.about.description', { version })}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternalUrl('https://github.com/zhihui-hu/one-mail')}
            >
              <ExternalLink data-icon="inline-start" />
              GitHub
            </Button>
          }
        />

        <SettingRow
          icon={RefreshCcw}
          title={t('settings.about.updateTitle')}
          description={t('settings.about.updateDescription')}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onCheckUpdates()}
              disabled={updatePending}
            >
              {updatePending ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCcw data-icon="inline-start" />
              )}
              {updatePending ? t('settings.about.updateChecking') : t('settings.about.updateCheck')}
            </Button>
          }
        />

        {updateResult ? <UpdateResultView result={updateResult} /> : null}
      </FieldGroup>
    </div>
  )
}

function UpdateResultView({ result }: { result: AppUpdateCheckResult }): React.JSX.Element {
  const { t } = useI18n()
  const variant = result.status === 'error' ? 'destructive' : 'default'

  return (
    <Alert className="py-2 text-xs" variant={variant}>
      <ShieldCheck />
      <AlertTitle>{getUpdateResultTitle(result, t)}</AlertTitle>
      <AlertDescription className="text-xs">{result.message}</AlertDescription>
    </Alert>
  )
}

function BackupMessageView({ message }: { message: BackupMessage }): React.JSX.Element {
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
        onClick={() => void revealPathInFileManager(message.path!)}
      >
        <FolderOpen data-icon="inline-start" />
        {message.path}
      </Button>
    </div>
  )
}

function getUpdateResultTitle(
  result: AppUpdateCheckResult,
  t: (key: TranslationKey) => string
): string {
  if (result.status === 'available') {
    return result.latestVersion
      ? `${t('settings.about.updateAvailable')} v${result.latestVersion}`
      : t('settings.about.updateAvailable')
  }

  if (result.status === 'not_available') return t('settings.about.updateNotAvailable')
  if (result.status === 'unsupported') return t('settings.about.updateUnsupported')
  return t('settings.about.updateFailed')
}

function SettingRow({
  icon: Icon,
  title,
  description,
  control,
  error,
  invalid = false
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description: string
  control?: React.ReactNode
  error?: string
  invalid?: boolean
}): React.JSX.Element {
  return (
    <Field data-invalid={invalid || undefined}>
      <div className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 gap-2.5">
          <div className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">
            <Icon aria-hidden="true" />
          </div>
          <FieldContent>
            <FieldLabel className="text-xs">{title}</FieldLabel>
            <FieldDescription className="text-xs leading-snug">{description}</FieldDescription>
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
  title,
  loadingTitle,
  description,
  loading,
  disabled,
  onClick
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  loadingTitle: string
  description: string
  loading: boolean
  disabled: boolean
  onClick: () => Promise<void>
}): React.JSX.Element {
  return (
    <Button
      className="h-auto justify-start px-3 py-2 text-left"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate">{loading ? loadingTitle : title}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </span>
    </Button>
  )
}

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
    locale: z.enum(['zh-CN', 'en-US'])
  })
}

function toFormValues(settings: AppSettings | null): SettingsFormValues {
  return {
    syncIntervalMinutes: settings?.syncIntervalMinutes ?? 15,
    syncWindowDays: settings?.syncWindowDays ?? 90,
    openAtLogin: settings?.openAtLogin === true,
    locale: settings?.locale === 'en-US' ? 'en-US' : 'zh-CN'
  }
}

function areSettingsEqual(first: SettingsFormValues, second: SettingsFormValues): boolean {
  return (
    first.syncIntervalMinutes === second.syncIntervalMinutes &&
    first.syncWindowDays === second.syncWindowDays &&
    first.openAtLogin === second.openAtLogin &&
    first.locale === second.locale
  )
}
