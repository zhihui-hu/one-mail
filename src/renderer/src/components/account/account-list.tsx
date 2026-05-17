import * as React from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Edit3,
  Mail,
  MailWarning,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'

import type { Account } from '@renderer/components/mail/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import oneMailIcon from '../../assets/onemail-icon.png'
import { getAccountWarning } from './account-warning'

type AccountListProps = {
  accounts: Account[]
  selectedAccountId: string
  syncingAccountIds: Set<string>
  actionsDisabled: boolean
  composePending: boolean
  outboxPending: boolean
  onSelectAccount: (accountId: string) => void
  onCompose: () => void
  onOpenOutbox: () => void
  onRefreshAccount: (account: Account) => void
  onEditAccount: (account: Account) => void
  onDeleteAccount: (account: Account) => void
  onResolveAccountWarning: (account: Account) => void
}

type AccountGroup = {
  key: string
  label: string
  accounts: Account[]
}

export function AccountList({
  accounts,
  selectedAccountId,
  syncingAccountIds,
  actionsDisabled,
  composePending,
  outboxPending,
  onSelectAccount,
  onCompose,
  onOpenOutbox,
  onRefreshAccount,
  onEditAccount,
  onDeleteAccount,
  onResolveAccountWarning
}: AccountListProps): React.JSX.Element {
  const { t } = useI18n()
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set())
  const allAccount = accounts.find((account) => account.id === 'all')
  const groups = groupAccountsByProvider(accounts.filter((account) => account.id !== 'all'), t)

  function toggleGroup(groupKey: string): void {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  return (
    <aside className="flex h-full min-w-0 flex-col bg-card/60 text-xs text-foreground">
      <div className="shrink-0 border-b px-2 py-2">
        <TooltipProvider>
          <div className="flex items-center gap-1.5">
            <Button
              className="min-w-0 flex-1"
              size="sm"
              aria-label={t('account.list.compose')}
              disabled={actionsDisabled || composePending}
              onClick={onCompose}
            >
              <Pencil data-icon="inline-start" />
              {t('account.list.compose')}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('account.list.outbox')}
                  disabled={actionsDisabled || outboxPending}
                  onClick={onOpenOutbox}
                >
                  <MailWarning aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('account.list.outbox')}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        <TooltipProvider>
          <div className="flex flex-col gap-0.5">
            {allAccount ? (
              <AccountRow
                account={allAccount}
                selected={selectedAccountId === allAccount.id}
                syncing={syncingAccountIds.has(allAccount.id)}
                onClick={() => onSelectAccount(allAccount.id)}
                onRefresh={() => onRefreshAccount(allAccount)}
                onEdit={() => undefined}
                onDelete={() => undefined}
                onResolveWarning={() => onResolveAccountWarning(allAccount)}
              />
            ) : null}
            {groups.length > 0 ? (
              groups.map((group) => {
                const collapsed = collapsedGroups.has(group.key)

                return (
                  <section key={group.key}>
                    <button
                      type="button"
                      className="flex h-6 w-full items-center gap-1 rounded-md px-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleGroup(group.key)}
                    >
                      <ChevronRight
                        className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    </button>
                    {!collapsed ? (
                      <div className="flex flex-col gap-0.5">
                        {group.accounts.map((account) => (
                          <AccountRow
                            key={account.id}
                            account={account}
                            selected={selectedAccountId === account.id}
                            syncing={syncingAccountIds.has(account.id)}
                            onClick={() => onSelectAccount(account.id)}
                            onRefresh={() => onRefreshAccount(account)}
                            onEdit={() => onEditAccount(account)}
                            onDelete={() => onDeleteAccount(account)}
                            onResolveWarning={() => onResolveAccountWarning(account)}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                )
              })
            ) : (
              <EmptyAccounts />
            )}
          </div>
        </TooltipProvider>
      </div>
    </aside>
  )
}

function AccountRow({
  account,
  selected,
  syncing,
  onClick,
  onRefresh,
  onEdit,
  onDelete,
  onResolveWarning
}: {
  account: Account
  selected: boolean
  syncing: boolean
  onClick: () => void
  onRefresh: () => void
  onEdit: () => void
  onDelete: () => void
  onResolveWarning: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const canModify = Boolean(account.accountId)
  const warning = getAccountWarning(account, t)
  const handleSelect = warning ? onResolveWarning : onClick
  const rowContent = (
    <div
      className={cn(
        'group grid h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-md px-1.5 transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring',
        selected && 'bg-secondary text-secondary-foreground'
      )}
    >
      <button
        type="button"
        onClick={handleSelect}
        className={cn(
          'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-0.5 text-left outline-none',
          warning && 'text-warning-foreground'
        )}
      >
        <ProviderLogo account={account} selected={selected} warning={Boolean(warning)} />
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-medium">{getAccountDisplayName(account, t)}</span>
          {warning ? (
            <AlertTriangle
              className="size-3.5 shrink-0 text-warning-foreground"
              aria-hidden="true"
              strokeWidth={2}
            />
          ) : null}
        </span>
      </button>
      <span className="flex min-w-5 items-center justify-end gap-1">
        {warning ? null : (
          <Badge
            variant="secondary"
            className={cn(
              'h-4 min-w-4 rounded-full px-1 text-[10px] group-hover:hidden',
              syncing && 'hidden'
            )}
          >
            {account.unread}
          </Badge>
        )}
        <button
          type="button"
          aria-label={t('account.list.refreshAccount')}
          className={cn(
            'hidden size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex [&_svg]:size-3',
            syncing && 'inline-flex'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRefresh()
          }}
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden="true" strokeWidth={2} />
        </button>
      </span>
    </div>
  )

  return (
    <ContextMenu>
      {warning ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{warning.tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      )}
      <ContextMenuContent className="w-36">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={warning ? onResolveWarning : onRefresh}>
            {warning ? <AlertTriangle strokeWidth={2} /> : <RefreshCw strokeWidth={2} />}
            {warning ? t('account.list.resolveWarning') : t('common.refresh')}
          </ContextMenuItem>
          {warning ? (
            <ContextMenuItem onSelect={onRefresh}>
              <RefreshCw strokeWidth={2} />
              {t('account.list.resync')}
            </ContextMenuItem>
          ) : null}
          {canModify ? (
            <>
              <ContextMenuItem onSelect={onEdit}>
                <Edit3 strokeWidth={2} />
                {t('common.edit')}
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 strokeWidth={2} />
                {t('common.delete')}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ProviderLogo({
  account,
  selected,
  warning
}: {
  account: Account
  selected: boolean
  warning?: boolean
}): React.JSX.Element {
  const isUnifiedInbox = account.id === 'all'
  const domain = getProviderLogoDomain(account)
  const [src, setSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (isUnifiedInbox) return undefined

    let cancelled = false

    void window.api.logos.get(domain).then((logo) => {
      if (!cancelled) setSrc(logo)
    })

    return () => {
      cancelled = true
    }
  }, [domain, isUnifiedInbox])

  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-muted-foreground [&_img]:size-4 [&_img]:object-contain [&_svg]:size-4',
        isUnifiedInbox && 'bg-transparent [&_img]:size-5 [&_img]:rounded-md [&_img]:object-cover',
        warning && 'text-warning-foreground',
        selected && 'text-foreground'
      )}
    >
      {isUnifiedInbox ? (
        <img src={oneMailIcon} alt="" />
      ) : src ? (
        <img src={src} alt="" />
      ) : (
        <Mail aria-hidden="true" strokeWidth={2} />
      )}
    </span>
  )
}

function getAccountDisplayName(account: Account, t: (key: TranslationKey) => string): string {
  if (account.id === 'all') return t('account.all.name')
  return account.name || account.address || t('account.empty.name')
}

function EmptyAccounts(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-muted-foreground">
      <div className="font-medium text-foreground">{t('account.list.emptyTitle')}</div>
      <div className="max-w-44">{t('account.list.emptyDescription')}</div>
      <Button variant="outline" size="sm" disabled>
        <Plus data-icon="inline-start" />
        {t('account.list.useTopButton')}
      </Button>
    </div>
  )
}

function groupAccountsByProvider(
  accounts: Account[],
  t: (key: TranslationKey) => string
): AccountGroup[] {
  const groups = new Map<string, Account[]>()

  for (const account of accounts) {
    const key = normalizeProviderKey(account.providerKey)
    groups.set(key, [...(groups.get(key) ?? []), account])
  }

  return Array.from(groups.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, groupAccounts]) => ({
      key,
      label: getProviderLabel(key, t),
      accounts: groupAccounts.sort((first, second) => first.address.localeCompare(second.address))
    }))
}

function normalizeProviderKey(providerKey?: string): string {
  if (!providerKey) return 'custom'
  const normalized = providerKey.toLowerCase()
  if (normalized.includes('gmail')) return 'gmail'
  if (normalized.includes('outlook') || normalized.includes('microsoft')) return 'outlook'
  if (normalized.includes('163')) return '163'
  if (normalized.includes('qq') || normalized.includes('foxmail')) return 'qq'
  if (normalized.includes('custom')) return 'custom'
  return normalized
}

function getProviderLabel(providerKey: string, t: (key: TranslationKey) => string): string {
  const labels: Record<string, TranslationKey> = {
    gmail: 'account.provider.gmail',
    outlook: 'account.provider.outlook',
    '163': 'account.provider.netease163',
    qq: 'account.provider.qq',
    custom: 'account.provider.custom',
    manual: 'account.provider.custom'
  }

  const labelKey = labels[providerKey]
  return labelKey ? t(labelKey) : providerKey
}

function getProviderLogoDomain(account: Account): string {
  const providerKey = normalizeProviderKey(account.providerKey)
  const domains: Record<string, string> = {
    gmail: 'gmail.com',
    outlook: 'outlook.com',
    '163': '163.com',
    qq: 'qq.com',
    custom: getEmailDomain(account.address),
    manual: getEmailDomain(account.address)
  }

  return domains[providerKey] ?? getEmailDomain(account.address)
}

function getEmailDomain(address: string): string {
  return address.split('@')[1]?.trim().toLowerCase() || 'mail.google.com'
}
