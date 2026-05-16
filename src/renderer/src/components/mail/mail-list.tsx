import * as React from 'react'
import { Paperclip, Search, Star, X } from 'lucide-react'
import { toast } from 'sonner'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { EllipsisTooltip } from '@renderer/components/mail/ellipsis-tooltip'
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
            <h1 className="truncate text-sm font-semibold">{account.name}</h1>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            已读 {readCount} · 未读 {account.unread}
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
              placeholder="搜索邮件"
              aria-label="搜索邮件"
            />
            {searchKeyword ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="清空搜索"
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
            <ListState>正在加载本地邮箱数据...</ListState>
          ) : error ? (
            <ListState destructive>{error}</ListState>
          ) : messages.length > 0 ? (
            <div>
              {messages.map((message) => (
                <MessageListItem
                  key={message.id}
                  message={message}
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
              {searchKeyword.trim() ? '没有找到匹配的邮件。' : '当前邮箱暂无邮件。'}
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
  if (loading) {
    return (
      <div className="flex h-12 items-center justify-center gap-2 border-b px-4 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" />
        <span>正在加载更多邮件...</span>
      </div>
    )
  }

  if (!hasMore) {
    return (
      <div className="flex h-10 items-center justify-center border-b px-4 text-xs text-muted-foreground">
        已加载全部邮件
      </div>
    )
  }

  return <div className="h-4 border-b" aria-hidden="true" />
}

function MessageListItem({
  message,
  selected,
  checked,
  selectionDisabled,
  onToggleSelection,
  onSelect
}: {
  message: Message
  selected: boolean
  checked: boolean
  selectionDisabled?: boolean
  onToggleSelection?: (range?: boolean) => void
  onSelect: () => void
}): React.JSX.Element {
  const absoluteTime = formatAbsoluteTime(message.receivedAt)
  const fromLabel =
    message.fromAddress && message.fromAddress !== message.from
      ? `${message.from} · ${message.fromAddress}`
      : message.from
  const preview = message.preview || '暂无预览。'
  const verificationLabel = message.verificationCode
    ? `验证码 ${message.verificationCode}`
    : undefined
  const secondLineTooltip = verificationLabel
    ? `${verificationLabel} - ${message.subject}${message.preview ? ` - ${message.preview}` : ''}`
    : `${message.subject}${message.preview ? ` - ${message.preview}` : ''}`

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
    if (!message.verificationCode) return

    void copyText(message.verificationCode)
      .then(() => {
        toast.success('验证码已复制')
      })
      .catch(() => {
        toast.error('复制验证码失败')
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
          aria-label={`选择 ${message.subject}`}
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
            {formatRelativeTime(message.receivedAt)}
          </span>
        </span>
        {verificationLabel ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
            <span
              className={cn('shrink-0 font-medium select-text', message.unread && 'font-semibold')}
            >
              验证码{' '}
              <button
                type="button"
                className="cursor-copy bg-transparent p-0 text-foreground underline underline-offset-2 outline-none select-text hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                title="复制验证码"
                aria-label={`复制验证码 ${message.verificationCode}`}
                onClick={handleCopyVerificationCode}
              >
                {message.verificationCode}
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
              {message.subject}
            </EllipsisTooltip>
          </span>
        ) : (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
            <EllipsisTooltip
              className={cn(
                'min-w-0 truncate font-medium select-text',
                message.unread && 'font-semibold'
              )}
              tooltip={message.subject}
            >
              {message.subject}
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
