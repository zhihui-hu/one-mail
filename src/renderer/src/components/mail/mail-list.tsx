import * as React from 'react'
import { Paperclip, Star } from 'lucide-react'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { MailFilterTags } from '@renderer/components/mail/mail-filter-tags'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

type MailListProps = {
  account: Account
  messages: Message[]
  selectedMessageId: string
  filters: MailFilterTag[]
  loading?: boolean
  error?: string | null
  onSelectMessage: (messageId: string) => void
  onChangeFilters: (filters: MailFilterTag[]) => void
}

export function MailList({
  account,
  messages,
  selectedMessageId,
  filters,
  loading = false,
  error,
  onSelectMessage,
  onChangeFilters
}: MailListProps): React.JSX.Element {
  const messageCount =
    filters.length > 0 ? messages.length : (account.messageCount ?? messages.length)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="app-drag-region shrink-0 border-b bg-card/60">
        <div className="app-no-drag flex h-12 items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{account.name}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {messageCount} 封邮件，{account.unread} 封未读
            </p>
          </div>
        </div>
        <div className="app-no-drag px-4 pb-1.5">
          <MailFilterTags value={filters} onValueChange={onChangeFilters} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
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
                  onSelect={() => onSelectMessage(message.id)}
                />
              ))}
            </div>
          ) : (
            <ListState>当前邮箱暂无邮件。</ListState>
          )}
        </TooltipProvider>
      </div>
    </div>
  )
}

function MessageListItem({
  message,
  selected,
  onSelect
}: {
  message: Message
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const absoluteTime = formatAbsoluteTime(message.receivedAt)
  const fromLabel =
    message.fromAddress && message.fromAddress !== message.from
      ? `${message.from} · ${message.fromAddress}`
      : message.from

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'grid w-full grid-cols-[10px_minmax(0,1fr)] gap-2 border-b px-4 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-secondary text-secondary-foreground'
      )}
    >
      <span
        className={cn(
          'mt-1.5 size-1.5 rounded-full',
          message.unread ? 'bg-primary' : 'bg-transparent'
        )}
      />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          <EllipsisTooltip
            className={cn(
              'min-w-0 flex-1 truncate text-foreground',
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
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
          <EllipsisTooltip
            className={cn('min-w-0 truncate font-medium', message.unread && 'font-semibold')}
            tooltip={message.subject}
          >
            {message.subject}
          </EllipsisTooltip>
          <span className="shrink-0 text-muted-foreground">-</span>
          <EllipsisTooltip
            className="min-w-0 flex-1 truncate text-muted-foreground"
            tooltip={message.preview || '暂无预览。'}
          >
            {message.preview || '暂无预览。'}
          </EllipsisTooltip>
        </span>
      </span>
    </button>
  )
}

function EllipsisTooltip({
  children,
  className,
  tooltip
}: {
  children: React.ReactNode
  className?: string
  tooltip: string
}): React.JSX.Element {
  const textRef = React.useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = React.useState(false)

  React.useEffect(() => {
    const element = textRef.current
    if (!element) return

    let animationFrame = 0
    const updateTruncation = (): void => {
      animationFrame = 0
      setIsTruncated(element.scrollWidth > element.clientWidth)
    }
    const scheduleUpdate = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateTruncation)
    }
    const resizeObserver = new ResizeObserver(scheduleUpdate)

    resizeObserver.observe(element)
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [tooltip, children])

  const text = (
    <span ref={textRef} className={className}>
      {children}
    </span>
  )

  if (!isTruncated) return text

  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-normal break-words">{tooltip}</TooltipContent>
    </Tooltip>
  )
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
