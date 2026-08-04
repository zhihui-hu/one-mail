import * as React from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Edit3,
  Inbox,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import alibabaCloudIcon from 'simple-icons/icons/alibabacloud.svg?raw'
import gmailIcon from 'simple-icons/icons/gmail.svg?raw'
import icloudIcon from 'simple-icons/icons/icloud.svg?raw'
import mailRuIcon from 'simple-icons/icons/maildotru.svg?raw'
import qqIcon from 'simple-icons/icons/qq.svg?raw'
import sinaWeiboIcon from 'simple-icons/icons/sinaweibo.svg?raw'

import microsoftOutlookIcon from '@renderer/assets/provider-icons/microsoft-outlook.png'
import neteaseMailIcon from '@renderer/assets/provider-icons/netease-mail.png'
import type { Account } from '@renderer/components/mail/types'
import { SweepShine } from '@renderer/components/sweep-shine'
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
  TooltipProvider
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import {
  getProviderLogoMetadata,
  normalizeProviderKey
} from '@renderer/shared/provider-metadata'
import { AccountStatusIndicator } from './account-status-indicator'
import { getAccountWarning } from './account-warning'

type AccountListProps = {
  accounts: Account[]
  selectedAccountId: string
  syncingAccountIds: Set<string>
  onSelectAccount: (accountId: string) => void
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
  onSelectAccount,
  onRefreshAccount,
  onEditAccount,
  onDeleteAccount,
  onResolveAccountWarning
}: AccountListProps): React.JSX.Element {
  const { t } = useI18n()
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set())
  const allAccount = accounts.find((account) => account.id === 'all')
  const groups = groupAccountsByProvider(
    accounts.filter((account) => account.id !== 'all'),
    t
  )

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
    <aside className="native-sidebar flex min-h-0 min-w-0 flex-1 flex-col text-xs text-foreground">
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        <TooltipProvider>
          <div className="flex flex-col gap-0.5">
            {allAccount ? (
              <section className="mb-1">
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-muted-foreground/80">
                  {t('account.all.address')}
                </div>
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
              </section>
            ) : null}
            {groups.length > 0 ? (
              groups.map((group) => {
                const collapsed = collapsedGroups.has(group.key)

                return (
                  <section key={group.key}>
                    <button
                      type="button"
                      className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left text-[11px] font-semibold text-muted-foreground/80 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  const connectionStatus = account.id === 'all' ? undefined : account.connectionStatus ?? 'connected'
  const handleSelect = warning ? onResolveWarning : onClick
  const rowContent = (
    <div
      className={cn(
        'group grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-md px-2 transition-colors hover:bg-white/45 focus-within:ring-2 focus-within:ring-ring dark:hover:bg-white/8',
        selected &&
          'bg-primary/15 text-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/0.025)]'
      )}
    >
      <button
        type="button"
        onClick={handleSelect}
        className={cn(
          'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-1 text-left outline-none',
          warning && 'text-warning'
        )}
      >
        <ProviderLogo account={account} selected={selected} warning={Boolean(warning)} />
        <span className="min-w-0 truncate font-medium">
          {syncing ? (
            <SweepShine>{getAccountDisplayName(account, t)}</SweepShine>
          ) : (
            getAccountDisplayName(account, t)
          )}
        </span>
      </button>
      <span className="flex min-w-5 items-center justify-end gap-1">
        {warning ? null : (
          <Badge
            variant="secondary"
            className={cn(
              'h-[18px] min-w-[18px] rounded-full border-0 bg-black/7 px-1.5 text-[10px] tabular-nums text-foreground/75 shadow-none group-hover:hidden dark:bg-white/10',
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
            'hidden size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-white/60 hover:text-foreground focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex dark:hover:bg-white/10 [&_svg]:size-3',
            syncing && 'inline-flex'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRefresh()
          }}
        >
          <RefreshCw aria-hidden="true" strokeWidth={2} />
        </button>
        <AccountStatusIndicator
          status={connectionStatus}
          warning={Boolean(warning)}
          warningTooltip={warning?.tooltip}
        />
      </span>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
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
  const logo = getProviderLogoMetadata(account.providerKey, account.address)
  const providerKey = normalizeProviderKey(account.providerKey)
  const imageIcon = PROVIDER_IMAGE_ICONS[providerKey]

  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/55 text-muted-foreground shadow-[inset_0_0_0_1px_rgb(0_0_0/0.04)] dark:bg-white/8 [&_img]:size-4 [&_img]:object-contain [&_svg]:size-[17px]',
        isUnifiedInbox && 'bg-transparent text-primary shadow-none',
        warning && 'text-warning-foreground',
        selected && !isUnifiedInbox && 'text-foreground'
      )}
    >
      {isUnifiedInbox ? (
        <Inbox aria-hidden="true" strokeWidth={1.8} />
      ) : imageIcon ? (
        <img src={imageIcon} alt="" aria-hidden="true" />
      ) : (
        <span className="text-[10px] font-semibold leading-none" aria-hidden="true">
          {logo.fallback}
        </span>
      )}
    </span>
  )
}

const PROVIDER_IMAGE_ICONS: Record<string, string | undefined> = {
  gmail: createBrandIconUrl(gmailIcon, '#EA4335'),
  qq: createBrandIconUrl(qqIcon, '#1EBAFC'),
  aliyun: createBrandIconUrl(alibabaCloudIcon, '#FF6A00'),
  aliyunEnterprise: createBrandIconUrl(alibabaCloudIcon, '#FF6A00'),
  icloud: createBrandIconUrl(icloudIcon, '#3693F3'),
  mailru: createBrandIconUrl(mailRuIcon, '#005FF9'),
  sina: createBrandIconUrl(sinaWeiboIcon, '#E6162D'),
  outlook: microsoftOutlookIcon,
  '163': neteaseMailIcon
}

function createBrandIconUrl(source: string, color: string): string {
  const coloredSource = source.replace('<svg ', `<svg fill="${color}" `)
  return `data:image/svg+xml,${encodeURIComponent(coloredSource)}`
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

function getProviderLabel(providerKey: string, t: (key: TranslationKey) => string): string {
  const labels: Record<string, TranslationKey> = {
    gmail: 'account.provider.gmail',
    yahoo: 'account.provider.yahoo',
    outlook: 'account.provider.outlook',
    '163': 'account.provider.netease163',
    qq: 'account.provider.qq',
    aliyun: 'account.provider.aliyun',
    aliyunEnterprise: 'account.provider.aliyunEnterprise',
    '189': 'account.provider.mail189',
    sohu: 'account.provider.sohu',
    sina: 'account.provider.sina',
    '139': 'account.provider.mail139',
    '21cn': 'account.provider.mail21cn',
    perfect: 'account.provider.perfect',
    icloud: 'account.provider.icloud',
    aol: 'account.provider.aol',
    yandex: 'account.provider.yandex',
    mailru: 'account.provider.mailru',
    custom: 'account.provider.custom',
    manual: 'account.provider.custom'
  }

  const labelKey = labels[providerKey]
  return labelKey ? t(labelKey) : providerKey
}
