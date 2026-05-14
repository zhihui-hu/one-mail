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

export function NoAccountsBody({
  importingSql,
  onAddAccount,
  onImportSql
}: {
  importingSql: boolean
  onAddAccount: () => void
  onImportSql: () => void
}): React.JSX.Element {
  return (
    <Empty className="min-h-0 flex-1 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>还没有邮箱账号</EmptyTitle>
        <EmptyDescription>添加账号后即可开始同步邮件。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAddAccount}>
          <Plus data-icon="inline-start" />
          添加账号
        </Button>
        <Button variant="outline" onClick={onImportSql} disabled={importingSql}>
          <Upload data-icon="inline-start" />
          {importingSql ? '导入中...' : '导入 SQL'}
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
  return (
    <header className="app-drag-region flex h-10 shrink-0 items-center justify-end border-b bg-card/60 px-5 pl-24">
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="添加账号" onClick={onAddAccount}>
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">添加账号</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="设置" onClick={onOpenSettings}>
                <Settings aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">设置</TooltipContent>
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
  onRevealDatabase
}: {
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  onRevealDatabase: () => void
}): React.JSX.Element {
  const syncText = formatSyncNotice(syncNotice)
  const databasePath = systemInfo?.databasePath
  const databaseLabel = databasePath ? getFileName(databasePath) : '加载中...'

  return (
    <footer className="app-drag-region flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
      <button
        type="button"
        className="app-no-drag flex w-72 shrink-0 items-center gap-1 overflow-hidden text-left outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        onClick={onRevealDatabase}
        title={databasePath}
        aria-label={databasePath ? `打开数据库文件夹：${databaseLabel}` : '数据库加载中'}
        disabled={!databasePath}
      >
        <span className="shrink-0">数据库：</span>
        <span className="min-w-0 truncate">{databaseLabel}</span>
      </button>
      <div className="app-no-drag flex shrink-0 items-center gap-2">
        {syncText ? (
          <span className="max-w-80 truncate text-foreground" title={syncText}>
            {syncText}
          </span>
        ) : null}
        <span>{accountCount} 个账号</span>
        <span>{messageCount} 封邮件</span>
        <span>{settings?.syncWindowDays ?? 90} 天缓存</span>
        <span>v{systemInfo?.appVersion ?? '...'}</span>
      </div>
    </footer>
  )
}

function getFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}
