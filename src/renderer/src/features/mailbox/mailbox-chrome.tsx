import type { AppSettings, AppUpdateStatus, SystemInfo } from '../../../../shared/types'
import {
  ChevronDown,
  CloudDownload,
  FileUp,
  Inbox,
  Link,
  Plus,
  RotateCcw,
  Settings,
  Upload
} from 'lucide-react'

import type { BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { ThemeToggleButton } from '@renderer/components/theme/theme-toggle-button'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

import type { SyncNotice } from './use-sync-feedback'
import { formatSyncNotice } from './use-sync-feedback'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { hasAvailableUpdate } from '@renderer/lib/update-status'

export function NoAccountsBody({
  importingSql,
  actionsDisabled = false,
  onAddAccount,
  onImportBackup
}: {
  importingSql: boolean
  actionsDisabled?: boolean
  onAddAccount: () => void
  onImportBackup: (source: BackupImportDialogSource) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <Empty className="min-h-0 flex-1 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('mailbox.noAccounts.title')}</EmptyTitle>
        <EmptyDescription>{t('mailbox.noAccounts.description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAddAccount} disabled={actionsDisabled}>
          <Plus data-icon="inline-start" />
          {t('common.addAccount')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={actionsDisabled}>
              <Upload data-icon="inline-start" />
              {importingSql ? t('mailbox.importing') : t('settings.backup.importMenu')}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48 min-w-48 rounded-md p-1">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('sql')}
              >
                <FileUp />
                <span className="truncate">{t('settings.backup.importSqlMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('webdav')}
              >
                <Link />
                <span className="truncate">{t('settings.backup.importWebDavMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('s3')}
              >
                <CloudDownload />
                <span className="truncate">{t('settings.backup.importS3Menu')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </EmptyContent>
    </Empty>
  )
}

export function TitleBar({
  platform,
  onAddAccount,
  onOpenSettings
}: {
  platform?: SystemInfo['platform'] | null
  onAddAccount: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const placeActionsOnLeft = Boolean(platform && platform !== 'darwin')

  return (
    <header
      className={cn(
        'app-titlebar app-drag-region flex h-10 shrink-0 items-center border-b bg-background',
        placeActionsOnLeft ? 'justify-start' : 'justify-end'
      )}
    >
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          {placeActionsOnLeft ? (
            <>
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
              <ThemeToggleButton />
            </>
          ) : (
            <>
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
              <ThemeToggleButton />
            </>
          )}
        </div>
      </TooltipProvider>
    </header>
  )
}

function AddAccountButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} onClick={onClick}>
          <Plus aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function SettingsButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} onClick={onClick}>
          <Settings aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function StatusBar({
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  updateStatus,
  onRevealDatabase,
  onOpenVersion,
  onInstallUpdate
}: {
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  updateStatus: AppUpdateStatus | null
  onRevealDatabase: () => void
  onOpenVersion: () => void
  onInstallUpdate: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const syncText = formatSyncNotice(syncNotice, t)
  const updateText = formatUpdateStatus(updateStatus, t)
  const hasUpdate = hasAvailableUpdate(updateStatus)
  const versionLabel = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : '...'
  const versionTitle =
    hasUpdate && updateStatus?.latestVersion
      ? t('status.openHomepageForUpdate', { version: updateStatus.latestVersion })
      : hasUpdate
        ? t('status.openHomepageForUpdateGeneric')
        : t('status.openRepository')
  const databasePath = systemInfo?.databasePath
  const databaseLabel = databasePath ? getFileName(databasePath) : t('common.loading')

  return (
    <footer className="app-drag-region flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
      <button
        type="button"
        className="app-no-drag flex w-72 shrink-0 items-center gap-1 overflow-hidden text-left outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        onClick={onRevealDatabase}
        title={databasePath}
        aria-label={
          databasePath
            ? t('status.openDatabaseFolder', { name: databaseLabel })
            : t('status.databaseLoading')
        }
        disabled={!databasePath}
      >
        <span className="shrink-0">{t('status.database')}</span>
        <span className="min-w-0 truncate">{databaseLabel}</span>
      </button>
      <div className="app-no-drag flex shrink-0 items-center gap-2">
        {syncText ? (
          <span className="max-w-80 truncate text-foreground" title={syncText}>
            {syncText}
          </span>
        ) : null}
        {updateText ? (
          <span className="max-w-64 truncate text-foreground" title={updateText}>
            {updateText}
          </span>
        ) : null}
        {updateStatus?.state === 'downloaded' ? (
          <Button className="h-5 rounded-sm px-1.5 text-xs" size="xs" onClick={onInstallUpdate}>
            <RotateCcw data-icon="inline-start" />
            {t('status.updateRestart')}
          </Button>
        ) : null}
        <span>{t('status.accounts', { count: accountCount })}</span>
        <span>{t('status.messages', { count: messageCount })}</span>
        <span>{t('status.cacheDays', { days: settings?.syncWindowDays ?? 90 })}</span>
        <button
          type="button"
          className={cn(
            'outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
            hasUpdate && 'font-medium text-warning hover:text-warning'
          )}
          title={versionTitle}
          aria-label={versionTitle}
          disabled={!systemInfo?.appVersion}
          onClick={onOpenVersion}
        >
          {versionLabel}
        </button>
      </div>
    </footer>
  )
}

function formatUpdateStatus(
  status: AppUpdateStatus | null,
  t: ReturnType<typeof useI18n>['t']
): string | null {
  if (!status || status.state === 'idle') return null

  if (status.state === 'checking') return t('status.updateChecking')
  if (status.state === 'downloading') {
    return t('status.updateDownloading', {
      percent: Math.round(status.progress?.percent ?? 0)
    })
  }
  if (status.state === 'downloaded') return t('status.updateDownloaded')
  if (status.state === 'installing') return t('status.updateInstalling')
  if (status.state === 'available') {
    return t('status.updateAvailable', { version: status.latestVersion ?? '' })
  }
  if (status.state === 'not_available') return t('status.updateNotAvailable')
  if (status.state === 'error') return t('status.updateError')
  if (status.state === 'unsupported') return t('status.updateUnsupported')

  return null
}

function getFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}
