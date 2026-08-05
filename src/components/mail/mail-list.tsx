import * as React from 'react'
import { CheckCheck, Paperclip, Pencil, Search, SendHorizontal, Star, X } from 'lucide-react'
import { toast } from 'sonner'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { EllipsisTooltip } from '@renderer/components/mail/ellipsis-tooltip'
import { getDisplaySender, getDisplaySubject } from '@renderer/components/mail/mail-display'
import { MailFilterTags } from '@renderer/components/mail/mail-filter-tags'
import { MailListSelectionToolbar } from '@renderer/components/mail/mail-list-selection-toolbar'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/components/ui/input-group'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useI18n, type AppLocale } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { startWindowDrag } from '@renderer/lib/window-drag'

type MailListProps = {
  account: Account
  messages: Message[]
  selectedMessageId: string
  filters: MailFilterTag[]
  searchKeyword: string
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: string | null
  onSelectMessage: (messageId: string) => void
  onChangeFilters: (filters: MailFilterTag[]) => void
  onChangeSearchKeyword: (keyword: string) => void
  onLoadMore: () => void
  onMarkAllRead?: () => void
  selectedMessageIds?: Set<string>
  allVisibleSelected?: boolean
  someVisibleSelected?: boolean
  selectionDisabled?: boolean
  composePending?: boolean
  outboxPending?: boolean
  onCompose?: () => void
  onOpenOutbox?: () => void
  onToggleMessageSelection?: (messageId: string, range?: boolean) => void
  onSelectAllVisible?: () => void
  onClearSelection?: () => void
  onMarkSelectedRead?: () => void
  onDeleteSelected?: () => void
}

export function MailList({
  account,
  messages,
  selectedMessageId,
  filters,
  searchKeyword,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error,
  onSelectMessage,
  onChangeFilters,
  onChangeSearchKeyword,
  onLoadMore,
  onMarkAllRead,
  selectedMessageIds = new Set(),
  allVisibleSelected = false,
  someVisibleSelected = false,
  selectionDisabled = false,
  composePending = false,
  outboxPending = false,
  onCompose,
  onOpenOutbox,
  onToggleMessageSelection,
  onSelectAllVisible,
  onClearSelection,
  onMarkSelectedRead,
  onDeleteSelected
}: MailListProps): React.JSX.Element {
  const { locale, t } = useI18n()
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const accountMessageCount = account.messageCount ?? messages.length
  const readCount = Math.max(0, accountMessageCount - account.unread)
  const selectedCount = selectedMessageIds.size
  const hasSelection = selectedCount > 0
  const unreadSelectedCount = React.useMemo(
    () => messages.filter((message) => selectedMessageIds.has(message.id) && message.unread).length,
    [messages, selectedMessageIds]
  )

  const handleScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (loading || loadingMore || !hasMore) return

      const element = event.currentTarget
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
      if (remaining <= 240) onLoadMore()
    },
    [hasMore, loading, loadingMore, onLoadMore]
  )

  React.useEffect(() => {
    const element = scrollContainerRef.current
    if (!element || loading || loadingMore || !hasMore || messages.length === 0) return

    const canScroll = element.scrollHeight > element.clientHeight
    if (!canScroll) onLoadMore()
  }, [hasMore, loading, loadingMore, messages.length, onLoadMore])

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header
        className="app-drag-region native-toolbar shrink-0 border-b"
        onMouseDown={startWindowDrag}
      >
        <div className="flex h-12 items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold leading-5">
              {account.id === 'all' ? t('account.all.name') : account.name || account.address}
            </h1>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">
              {t('mail.stats.readUnread', { read: readCount, unread: account.unread })}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 rounded-lg border border-black/5 bg-background/70 px-2.5 shadow-none hover:bg-background dark:border-white/8"
            disabled={composePending || !onCompose}
            onClick={onCompose}
          >
            <Pencil data-icon="inline-start" aria-hidden="true" />
            {t('account.list.compose')}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
            title={t('account.list.outbox')}
            aria-label={t('account.list.outbox')}
            disabled={outboxPending || !onOpenOutbox}
            onClick={onOpenOutbox}
          >
            <SendHorizontal aria-hidden="true" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
            title={t('mail.markAllRead')}
            aria-label={t('mail.markAllRead')}
            disabled={selectionDisabled || account.unread === 0 || !onMarkAllRead}
            onClick={onMarkAllRead}
          >
            <CheckCheck aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-center gap-2 px-3 pb-3">
          <InputGroup className="h-8 w-32 shrink-0 rounded-lg border-0 bg-black/5 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.035)] dark:bg-white/8">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={searchKeyword}
              onChange={(event) => onChangeSearchKeyword(event.target.value)}
              placeholder={t('mail.search.placeholder')}
              aria-label={t('mail.search.placeholder')}
            />
            {searchKeyword ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={t('mail.search.clear')}
                  onClick={() => onChangeSearchKeyword('')}
                >
                  <X aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <div className="min-w-0 flex-1">
            <MailFilterTags value={filters} onValueChange={onChangeFilters} />
          </div>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <TooltipProvider>
          {loading ? (
            <ListState loading>{t('mail.list.loadingLocal')}</ListState>
          ) : error ? (
            <ListState destructive>{error}</ListState>
          ) : messages.length > 0 ? (
            <div>
              {messages.map((message) => {
                const messageSelected = message.id === selectedMessageId
                const messageChecked = selectedMessageIds.has(message.id)

                return (
                  <MessageListItem
                    key={message.id}
                    message={message}
                    locale={locale}
                    selected={messageSelected}
                    checked={messageChecked}
                    selectionDisabled={selectionDisabled}
                    onToggleMessageSelection={onToggleMessageSelection}
                    onSelectMessage={onSelectMessage}
                  />
                )
              })}
              <LoadMoreState loading={loadingMore} hasMore={hasMore} />
            </div>
          ) : (
            <ListState>
              {searchKeyword.trim() ? t('mail.list.noSearchResults') : t('mail.list.emptyMailbox')}
            </ListState>
          )}
        </TooltipProvider>
      </div>

      {hasSelection &&
      onSelectAllVisible &&
      onClearSelection &&
      onMarkSelectedRead &&
      onDeleteSelected ? (
        <MailListSelectionToolbar
          selectedCount={selectedCount}
          unreadSelectedCount={unreadSelectedCount}
          allVisibleSelected={allVisibleSelected}
          someVisibleSelected={someVisibleSelected}
          disabled={selectionDisabled}
          onSelectAllVisible={onSelectAllVisible}
          onClearSelection={onClearSelection}
          onMarkSelectedRead={onMarkSelectedRead}
          onDeleteSelected={onDeleteSelected}
        />
      ) : null}
    </div>
  )
}

function LoadMoreState({
  loading,
  hasMore
}: {
  loading: boolean
  hasMore: boolean
}): React.JSX.Element {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="flex h-12 items-center justify-center border-b px-4 text-xs text-muted-foreground">
        <SweepShine>{t('mail.list.loadingMore')}</SweepShine>
      </div>
    )
  }

  if (!hasMore) {
    return (
      <div className="flex h-10 items-center justify-center border-b px-4 text-xs text-muted-foreground">
        {t('mail.list.allLoaded')}
      </div>
    )
  }

  return <div className="h-4 border-b" aria-hidden="true" />
}

const MessageListItem = React.memo(function MessageListItem({
  message,
  locale,
  selected,
  checked,
  selectionDisabled,
  onToggleMessageSelection,
  onSelectMessage
}: {
  message: Message
  locale: AppLocale
  selected: boolean
  checked: boolean
  selectionDisabled?: boolean
  onToggleMessageSelection?: (messageId: string, range?: boolean) => void
  onSelectMessage: (messageId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const absoluteTime = formatAbsoluteTime(message.receivedAt)
  const displaySubject = getDisplaySubject(message, t)
  const displaySender = getDisplaySender(message, t)
  const fromLabel =
    message.fromAddress && message.fromAddress !== displaySender
      ? `${displaySender} · ${message.fromAddress}`
      : displaySender
  const verificationCode = message.verificationCode
  const verificationLabel = message.verificationCode
    ? t('mail.list.verificationCodeWithValue', { code: message.verificationCode })
    : undefined

  function handleSelectClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (hasSelectionInside(event.currentTarget)) return

    onSelectMessage(message.id)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    onSelectMessage(message.id)
  }

  function handleCopyVerificationCode(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    if (!verificationCode) return

    void copyText(verificationCode)
      .then(() => {
        toast.success(t('mail.list.verificationCodeCopied'))
      })
      .catch(() => {
        toast.error(t('mail.list.verificationCodeCopyFailed'))
      })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelectClick}
      onKeyDown={handleKeyDown}
      aria-selected={selected}
      className={cn(
        'group relative grid w-full cursor-default grid-cols-[10px_minmax(0,1fr)] gap-2 border-b border-border/70 px-3 py-1.5 text-left outline-none transition-colors select-text hover:bg-muted/55 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-primary/10 text-foreground'
      )}
    >
      <span
        className={cn(
          'mt-1.5 size-1.5 rounded-full transition-opacity group-hover:opacity-0',
          message.unread ? 'bg-primary' : 'bg-transparent',
          checked && 'opacity-0'
        )}
      />
      <span
        className={cn(
          'absolute left-2.5 top-1.5 flex items-start justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
          checked && 'opacity-100'
        )}
      >
        <Checkbox
          className="size-3.5 rounded-[4px] bg-background"
          checked={checked}
          disabled={selectionDisabled}
          aria-label={t('mail.list.selectMessage', { subject: displaySubject })}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleMessageSelection?.(message.id, false)}
          onKeyDown={(event) => {
            if (event.key === ' ') event.stopPropagation()
          }}
          onPointerDown={(event) => {
            if (event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              onToggleMessageSelection?.(message.id, true)
            }
          }}
        />
      </span>
      <span className="min-w-0 select-text">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4">
          <EllipsisTooltip
            className={cn(
              'min-w-0 flex-1 truncate text-foreground select-text',
              message.unread && 'font-semibold'
            )}
            tooltip={fromLabel}
          >
            {displaySender}
          </EllipsisTooltip>
          {message.starred ? (
            <Star className="size-3 shrink-0 text-primary" aria-hidden="true" />
          ) : null}
          {message.attachments.length > 0 ? (
            <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground" title={absoluteTime}>
            {formatRelativeTime(message.receivedAt, locale)}
          </span>
        </span>
        {verificationLabel && verificationCode ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4">
            <EllipsisTooltip
              className={cn(
                'min-w-0 flex-1 truncate font-medium text-foreground select-text',
                message.unread && 'font-semibold'
              )}
              tooltip={displaySubject}
            >
              {displaySubject}
            </EllipsisTooltip>
            <span
              className={cn(
                'shrink-0 text-[11px] text-muted-foreground select-text',
                message.unread && 'font-medium'
              )}
            >
              {t('mail.list.verificationCode')}{' '}
              <button
                type="button"
                className="cursor-copy bg-transparent p-0 text-foreground underline underline-offset-2 outline-none select-text hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                title={t('mail.list.copyVerificationCode')}
                aria-label={t('mail.list.copyVerificationCodeWithValue', {
                  code: verificationCode
                })}
                onClick={handleCopyVerificationCode}
              >
                {verificationCode}
              </button>
            </span>
          </span>
        ) : (
          <EllipsisTooltip
            className={cn(
              'mt-0.5 block min-w-0 truncate text-[12px] font-medium leading-4 text-foreground select-text',
              message.unread && 'font-semibold'
            )}
            tooltip={displaySubject}
          >
            {displaySubject}
          </EllipsisTooltip>
        )}
      </span>
    </div>
  )
})

function hasSelectionInside(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return false

  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode

  return (
    (anchorNode !== null && element.contains(anchorNode)) ||
    (focusNode !== null && element.contains(focusNode))
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copy command failed.')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

function ListState({
  children,
  destructive = false,
  loading = false
}: {
  children: React.ReactNode
  destructive?: boolean
  loading?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full min-h-64 items-center justify-center px-8 text-center text-xs text-muted-foreground',
        destructive && 'text-destructive'
      )}
    >
      {loading ? <SweepShine>{children}</SweepShine> : children}
    </div>
  )
}
