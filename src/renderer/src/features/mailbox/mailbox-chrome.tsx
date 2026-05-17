import type { AppSettings, SystemInfo } from '../../../../shared/types'
import { Inbox, Plus, Settings, Upload } from 'lucide-react'

import { ThemeToggleButton } from '@renderer/components/theme/theme-toggle-button'
import { Button } from '@renderer/components/ui/button'
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

export function NoAccountsBody({
  importingSql,
  onAddAccount,
  onImportSql
}: {
  importingSql: boolean
  onAddAccount: () => void
  onImportSql: () => void
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
        <Button onClick={onAddAccount}>
          <Plus data-icon="inline-start" />
          {t('common.addAccount')}
        </Button>
        <Button variant="outline" onClick={onImportSql} disabled={importingSql}>
          <Upload data-icon="inline-start" />
          {importingSql ? t('mailbox.importing') : t('settings.backup.import')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function TitleBar({
  onAddAccount,
  onOpenSettings
}: {
  onAddAccount: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <header className="app-drag-region flex h-10 shrink-0 items-center justify-end border-b bg-card/60 px-5 pl-24">
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('common.addAccount')}
                onClick={onAddAccount}
              >
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('common.addAccount')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('common.settings')}
                onClick={onOpenSettings}
              >
                <Settings aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('common.settings')}</TooltipContent>
          </Tooltip>
          <ThemeToggleButton />
        </div>
      </TooltipProvider>
    </header>
  )
}

export function StatusBar({
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  onRevealDatabase,
  onOpenVersion
}: {
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  onRevealDatabase: () => void
  onOpenVersion: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const syncText = formatSyncNotice(syncNotice, t)
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
        <span>{t('status.accounts', { count: accountCount })}</span>
        <span>{t('status.messages', { count: messageCount })}</span>
        <span>{t('status.cacheDays', { days: settings?.syncWindowDays ?? 90 })}</span>
        <button
          type="button"
          className="outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
          aria-label={t('status.openRepository')}
          disabled={!systemInfo?.appVersion}
          onClick={onOpenVersion}
        >
          v{systemInfo?.appVersion ?? '...'}
        </button>
      </div>
    </footer>
  )
}

function getFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}
