import { zodResolver } from '@hookform/resolvers/zod'
import {
  CalendarRange,
  Clock3,
  DatabaseBackup,
  Download,
  FolderOpen,
  ImageOff,
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

import { exportSqlBackup, importSqlBackup, revealPathInFileManager } from '@renderer/lib/api'
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
import type { AppSettings, SettingsUpdateInput } from '../../../../shared/types'
import { cn } from '@renderer/lib/utils'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettings | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
  onImported?: () => Promise<void> | void
}

type SettingsSection = 'general' | 'backup'
type BackupMessage = {
  label: string
  path?: string
}

const AUTO_SAVE_DELAY_MS = 350

const settingsSchema = z.object({
  syncIntervalMinutes: z.coerce
    .number<number>('请输入同步间隔')
    .int('同步间隔必须是整数')
    .min(0, '同步间隔不能小于 0')
    .max(1440, '同步间隔不能超过 1440 分钟'),
  syncWindowDays: z.coerce
    .number<number>('请输入缓存天数')
    .int('缓存天数必须是整数')
    .min(1, '缓存天数不能小于 1')
    .max(3650, '缓存天数不能超过 3650 天'),
  openAtLogin: z.boolean(),
  externalImagesBlocked: z.boolean(),
  locale: z.enum(['zh-CN', 'en-US'])
})

type SettingsFormValues = z.infer<typeof settingsSchema>

const sections: Array<{
  value: SettingsSection
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  {
    value: 'general',
    label: '常规',
    icon: RefreshCcw
  },
  {
    value: 'backup',
    label: '导入导出',
    icon: DatabaseBackup
  }
]

export function SettingsDialog({
  open,
  settings,
  onOpenChange,
  onSubmit,
  onImported
}: SettingsDialogProps): React.JSX.Element {
  const [section, setSection] = React.useState<SettingsSection>('general')
  const [pending, setPending] = React.useState(false)
  const [backupPending, setBackupPending] = React.useState<'export' | 'import' | null>(null)
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
            externalImagesBlocked: currentValues.externalImagesBlocked,
            locale: currentValues.locale
          })
          lastSavedValuesRef.current = currentValues
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : '设置更新失败。')
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
    [onSubmit]
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
  }, [form, saveSettingsValues])

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
  }, [open, saveSettingsValues, watchedValues])

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
      setBackupMessage(path ? { label: '已导出', path } : { label: '已取消导出。' })
    })
  }

  async function handleImport(): Promise<void> {
    await runBackupAction('import', async () => {
      const result = await importSqlBackup()
      setBackupMessage(
        result.imported ? { label: '已导入', path: result.filePath } : { label: '已取消导入。' }
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
        backupActionError instanceof Error ? backupActionError.message : '备份操作失败。'
      )
    } finally {
      setBackupPending(null)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="设置"
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
                  <span className="min-w-0 truncate font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <div className="h-full min-h-0 overflow-auto">
          {section === 'general' ? (
            <GeneralSettingsForm form={form} error={error} />
          ) : (
            <BackupSettings
              pending={backupPending}
              message={backupMessage}
              error={backupError}
              onExport={handleExport}
              onImport={handleImport}
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
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[540px] flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Controller
          control={form.control}
          name="openAtLogin"
          render={({ field }) => (
            <SettingRow
              icon={Power}
              title="开机启动"
              description="登录系统后自动打开 OneMail。"
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
          title="同步间隔"
          description="单位：分钟，0 表示只手动同步。"
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
          title="缓存窗口"
          description="单位：天，用于限制本地邮件缓存范围。"
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
          name="externalImagesBlocked"
          render={({ field }) => (
            <SettingRow
              icon={ImageOff}
              title="默认阻止外部图片"
              description="降低追踪像素和远程内容自动加载风险。"
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

        <Controller
          control={form.control}
          name="locale"
          render={({ field }) => (
            <SettingRow
              icon={Languages}
              title="界面语言"
              description="选择应用界面的显示语言。"
              control={
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="locale"
                    size="sm"
                    className="w-36"
                    aria-invalid={Boolean(form.formState.errors.locale)}
                  >
                    <SelectValue placeholder="选择语言" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="zh-CN">中文</SelectItem>
                      <SelectItem value="en-US">English</SelectItem>
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
  const disabled = Boolean(pending)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[540px] flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Alert className="bg-muted/30 py-2 text-xs">
          <KeyRound />
          <AlertTitle>数据库密钥</AlertTitle>
          <AlertDescription className="text-xs">
            账号密码使用数据库密钥派生密钥加密；导入时会校验文件名中的密钥、Linux 时间戳范围和 SQL
            信息。
          </AlertDescription>
        </Alert>

        <div className="grid gap-2 sm:grid-cols-2">
          <BackupActionButton
            icon={Download}
            title="导出 SQL"
            description="保存一份可迁移的本地数据库备份。"
            loading={pending === 'export'}
            disabled={disabled}
            onClick={onExport}
          />
          <BackupActionButton
            icon={Upload}
            title="导入 SQL"
            description="从备份恢复数据，导入成功后刷新邮箱。"
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
  control: React.ReactNode
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
        <div className="flex justify-start sm:justify-end">{control}</div>
      </div>
    </Field>
  )
}

function BackupActionButton({
  icon: Icon,
  title,
  description,
  loading,
  disabled,
  onClick
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
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
        <span className="truncate">{loading ? `${title}中...` : title}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </span>
    </Button>
  )
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
