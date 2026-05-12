import * as React from 'react'
import { ChevronRight, Edit3, Mail, Plus, RefreshCw, Trash2 } from 'lucide-react'

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
import { cn } from '@renderer/lib/utils'
import oneMailIcon from '../../assets/onemail-icon.png'

type AccountListProps = {
  accounts: Account[]
  selectedAccountId: string
  syncingAccountIds: Set<string>
  onSelectAccount: (accountId: string) => void
  onRefreshAccount: (account: Account) => void
  onEditAccount: (account: Account) => void
  onDeleteAccount: (account: Account) => void
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
  onSelectAccount,
  onRefreshAccount,
  onEditAccount,
  onDeleteAccount
}: AccountListProps): React.JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set())
  const allAccount = accounts.find((account) => account.id === 'all')
  const groups = groupAccountsByProvider(accounts.filter((account) => account.id !== 'all'))

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
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="flex flex-col gap-1">
          {allAccount ? (
            <AccountRow
              account={allAccount}
              selected={selectedAccountId === allAccount.id}
              syncing={syncingAccountIds.has(allAccount.id)}
              onClick={() => onSelectAccount(allAccount.id)}
              onRefresh={() => onRefreshAccount(allAccount)}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
          ) : null}
          {groups.length > 0 ? (
            groups.map((group) => {
              const collapsed = collapsedGroups.has(group.key)

              return (
                <section key={group.key}>
                  <button
                    type="button"
                    className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <ChevronRight
                      className={cn('transition-transform size-4', !collapsed && 'rotate-90')}
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
  onDelete
}: {
  account: Account
  selected: boolean
  syncing: boolean
  onClick: () => void
  onRefresh: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const canModify = Boolean(account.accountId)
  const row = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group grid h-8 w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center  gap-0.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-secondary text-secondary-foreground'
      )}
    >
      <ProviderLogo account={account} selected={selected} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{account.name}</span>
      </span>
      <span className="flex w-6.5 items-center justify-end gap-1">
        <Badge
          variant="secondary"
          className={cn(
            'h-5 min-w-5 rounded-full px-1.5 text-[11px] group-hover:hidden',
            syncing && 'hidden'
          )}
        >
          {account.unread}
        </Badge>
        <span
          role="button"
          tabIndex={0}
          aria-label="刷新账号"
          className={cn(
            'hidden size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex [&_svg]:size-3.5',
            syncing && 'inline-flex'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRefresh()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            onRefresh()
          }}
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden="true" strokeWidth={2} />
        </span>
      </span>
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-36">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={onRefresh}>
            <RefreshCw strokeWidth={2} />
            刷新
          </ContextMenuItem>
          {canModify ? (
            <>
              <ContextMenuItem onSelect={onEdit}>
                <Edit3 strokeWidth={2} />
                编辑
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 strokeWidth={2} />
                删除
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
  selected
}: {
  account: Account
  selected: boolean
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

function EmptyAccounts(): React.JSX.Element {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-muted-foreground">
      <div className="font-medium text-foreground">暂无账号</div>
      <div className="max-w-44">可添加 Gmail、Outlook、163、QQ 或自定义 IMAP 账号。</div>
      <Button variant="outline" size="sm" disabled>
        <Plus data-icon="inline-start" />
        使用顶部按钮
      </Button>
    </div>
  )
}

function groupAccountsByProvider(accounts: Account[]): AccountGroup[] {
  const groups = new Map<string, Account[]>()

  for (const account of accounts) {
    const key = normalizeProviderKey(account.providerKey)
    groups.set(key, [...(groups.get(key) ?? []), account])
  }

  return Array.from(groups.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, groupAccounts]) => ({
      key,
      label: getProviderLabel(key),
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

function getProviderLabel(providerKey: string): string {
  const labels: Record<string, string> = {
    gmail: 'Gmail',
    outlook: 'Outlook',
    '163': '163 邮箱',
    qq: 'QQ 邮箱',
    custom: '自定义 IMAP',
    manual: '自定义 IMAP'
  }

  return labels[providerKey] ?? providerKey
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
