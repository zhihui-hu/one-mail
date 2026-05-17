import * as React from 'react'
import { Paperclip, Search, Star, X } from 'lucide-react'
import { toast } from 'sonner'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { EllipsisTooltip } from '@renderer/components/mail/ellipsis-tooltip'
import { getDisplayPreview, getDisplaySender, getDisplaySubject } from '@renderer/components/mail/mail-display'
import { MailFilterTags } from '@renderer/components/mail/mail-filter-tags'
import { MailListSelectionToolbar } from '@renderer/components/mail/mail-list-selection-toolbar'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@renderer/components/ui/input-group'
import { Spinner } from '@renderer/components/ui/spinner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { useI18n, type AppLocale } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'

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
  selectedMessageIds?: Set<string>
  allVisibleSelected?: boolean
  someVisibleSelected?: boolean
  selectionDisabled?: boolean
  onToggleMessageSelection?: (messageId: string, range?: boolean) => void
  onSelectAllVisible?: () => void
  onClearSelection?: () => void
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
  selectedMessageIds = new Set(),
  allVisibleSelected = false,
  someVisibleSelected = false,
  selectionDisabled = false,
  onToggleMessageSelection,
  onSelectAllVisible,
  onClearSelection,
  onDeleteSelected
}: MailListProps): React.JSX.Element {
  const { locale, t } = useI18n()
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const accountMessageCount = account.messageCount ?? messages.length
  const readCount = Math.max(0, accountMessageCount - account.unread)
  const selectedCount = selectedMessageIds.size
  const hasSelection = selectedCount > 0

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
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="app-drag-region shrink-0 border-b bg-card/60">
        <div className="app-no-drag flex h-9 items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {account.id === 'all' ? t('account.all.name') : account.name || account.address}
            </h1>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            {t('mail.stats.readUnread', { read: readCount, unread: account.unread })}
          </p>
        </div>
        <div className="app-no-drag flex flex-col gap-2 px-4 pb-2">
          <InputGroup>
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
          <MailFilterTags value={filters} onValueChange={onChangeFilters} />
        </div>
        {hasSelection && onSelectAllVisible && onClearSelection && onDeleteSelected ? (
          <MailListSelectionToolbar
            selectedCount={selectedCount}
            allVisibleSelected={allVisibleSelected}
            someVisibleSelected={someVisibleSelected}
            disabled={selectionDisabled}
            onSelectAllVisible={onSelectAllVisible}
            onClearSelection={onClearSelection}
            onDeleteSelected={onDeleteSelected}
          />
        ) : null}
      </header>

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <TooltipProvider>
          {loading ? (
            <ListState>{t('mail.list.loadingLocal')}</ListState>
          ) : error ? (
            <ListState destructive>{error}</ListState>
          ) : messages.length > 0 ? (
            <div>
              {messages.map((message) => (
                <MessageListItem
                  key={message.id}
                  message={message}
                  locale={locale}
                  selected={message.id === selectedMessageId}
                  checked={selectedMessageIds.has(message.id)}
                  selectionDisabled={selectionDisabled}
                  onToggleSelection={(range) => onToggleMessageSelection?.(message.id, range)}
                  onSelect={() => onSelectMessage(message.id)}
                />
              ))}
              <LoadMoreState loading={loadingMore} hasMore={hasMore} />
            </div>
          ) : (
            <ListState>
              {searchKeyword.trim() ? t('mail.list.noSearchResults') : t('mail.list.emptyMailbox')}
            </ListState>
          )}
        </TooltipProvider>
      </div>
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
      <div className="flex h-12 items-center justify-center gap-2 border-b px-4 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" />
        <span>{t('mail.list.loadingMore')}</span>
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

function MessageListItem({
  message,
  locale,
  selected,
  checked,
  selectionDisabled,
  onToggleSelection,
  onSelect
}: {
  message: Message
  locale: AppLocale
  selected: boolean
  checked: boolean
  selectionDisabled?: boolean
  onToggleSelection?: (range?: boolean) => void
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const absoluteTime = formatAbsoluteTime(message.receivedAt)
  const displaySubject = getDisplaySubject(message, t)
  const displaySender = getDisplaySender(message, t)
  const fromLabel =
    message.fromAddress && message.fromAddress !== displaySender
      ? `${displaySender} · ${message.fromAddress}`
      : displaySender
  const preview = getDisplayPreview(message, t)
  const verificationCode = message.verificationCode
  const verificationLabel = message.verificationCode
    ? t('mail.list.verificationCodeWithValue', { code: message.verificationCode })
    : undefined
  const secondLineTooltip = verificationLabel
    ? `${verificationLabel} - ${displaySubject}${preview ? ` - ${preview}` : ''}`
    : `${displaySubject}${preview ? ` - ${preview}` : ''}`

  function handleSelectClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (hasSelectionInside(event.currentTarget)) return

    onSelect()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    onSelect()
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
        'grid w-full cursor-default grid-cols-[16px_10px_minmax(0,1fr)] gap-2 border-b px-4 py-2 text-left outline-none transition-colors select-text hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-secondary text-secondary-foreground'
      )}
    >
      <span className="mt-0.5 flex items-start justify-center">
        <Checkbox
          checked={checked}
          disabled={selectionDisabled}
          aria-label={t('mail.list.selectMessage', { subject: displaySubject })}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelection?.(false)}
          onKeyDown={(event) => {
            if (event.key === ' ') event.stopPropagation()
          }}
          onPointerDown={(event) => {
            if (event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              onToggleSelection?.(true)
            }
          }}
        />
      </span>
      <span
        className={cn(
          'mt-1.5 size-1.5 rounded-full',
          message.unread ? 'bg-primary' : 'bg-transparent'
        )}
      />
      <span className="min-w-0 select-text">
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          <EllipsisTooltip
            className={cn(
              'min-w-0 flex-1 truncate text-foreground select-text',
              message.unread && 'font-semibold'
            )}
            tooltip={fromLabel}
          >
            {fromLabel}
          </EllipsisTooltip>
          {message.starred ? (
            <Star className="size-3 shrink-0 text-primary" aria-hidden="true" />
          ) : null}
          {message.attachments.length > 0 ? (
            <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="shrink-0 text-muted-foreground" title={absoluteTime}>
            {formatRelativeTime(message.receivedAt, locale)}
          </span>
        </span>
        {verificationLabel && verificationCode ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
            <span
              className={cn('shrink-0 font-medium select-text', message.unread && 'font-semibold')}
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
            <span className="shrink-0 text-muted-foreground">-</span>
            <EllipsisTooltip
              className={cn(
                'min-w-0 flex-1 truncate text-muted-foreground select-text',
                message.unread && 'font-semibold'
              )}
              tooltip={secondLineTooltip}
            >
              {displaySubject}
            </EllipsisTooltip>
          </span>
        ) : (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
            <EllipsisTooltip
              className={cn(
                'min-w-0 truncate font-medium select-text',
                message.unread && 'font-semibold'
              )}
              tooltip={displaySubject}
            >
              {displaySubject}
            </EllipsisTooltip>
            <span className="shrink-0 text-muted-foreground">-</span>
            <EllipsisTooltip
              className="min-w-0 flex-1 truncate text-muted-foreground select-text"
              tooltip={preview}
            >
              {preview}
            </EllipsisTooltip>
          </span>
        )}
      </span>
    </div>
  )
}

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
  destructive = false
}: {
  children: React.ReactNode
  destructive?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full min-h-64 items-center justify-center px-8 text-center text-xs text-muted-foreground',
        destructive && 'text-destructive'
      )}
    >
      {children}
    </div>
  )
}
