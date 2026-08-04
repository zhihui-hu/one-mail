import * as React from 'react'
import {
  AlertTriangle,
  Clock3,
  FilePenLine,
  Mail,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users
} from 'lucide-react'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import type { OutboxMessage } from '@renderer/pages/mailbox/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'

type OutboxPanelProps = {
  open: boolean
  pending?: boolean
  outboxMessages: OutboxMessage[]
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
  onOpenDraft: (message: OutboxMessage) => void
  onRetry: (message: OutboxMessage) => void
  onDelete: (message: OutboxMessage) => void
}

export function OutboxPanel({
  open,
  pending = false,
  outboxMessages,
  onOpenChange,
  onRefresh,
  onOpenDraft,
  onRetry,
  onDelete
}: OutboxPanelProps): React.JSX.Element {
  const { locale, t } = useI18n()
  const [selectedOutboxId, setSelectedOutboxId] = React.useState<number | null>(null)
  const selectedMessage =
    outboxMessages.find((message) => message.outboxId === selectedOutboxId) ??
    outboxMessages[0]

  React.useEffect(() => {
    if (open) onRefresh()
  }, [onRefresh, open])

  React.useEffect(() => {
    if (!open) return
    setSelectedOutboxId((current) =>
      outboxMessages.some((message) => message.outboxId === current)
        ? current
        : (outboxMessages[0]?.outboxId ?? null)
    )
  }, [open, outboxMessages])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-50 h-[min(680px,86vh)] !w-[min(94vw,980px)] !max-w-[980px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b bg-muted/15 px-4 py-3 pr-16">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold">{t('mail.outbox.title')}</DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-[11px]">
                {pending ? (
                  <SweepShine>{t('mail.outbox.description')}</SweepShine>
                ) : (
                  t('mail.outbox.description')
                )}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 rounded-md"
              disabled={pending}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
        </DialogHeader>
        {outboxMessages.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
              <Mail aria-hidden="true" />
            </span>
            <span>
              {t('mail.outbox.empty')}
            </span>
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-[minmax(260px,32%)_minmax(0,1fr)] overflow-hidden">
            <div className="min-h-0 overflow-auto border-r bg-muted/15">
              <div className="divide-y">
                {outboxMessages.map((message) => {
                  const active = message.outboxId === selectedMessage?.outboxId
                  return (
                    <button
                      key={message.outboxId}
                      type="button"
                      className={`w-full px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        active
                          ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]'
                          : 'hover:bg-background/70'
                      }`}
                      onClick={() => setSelectedOutboxId(message.outboxId)}
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">
                            {message.subject || t('mail.outbox.noSubject')}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {formatAddresses(message.to) || t('mail.outbox.noRecipients')}
                          </div>
                        </div>
                        <Badge
                          className="h-5 shrink-0 px-1.5 text-[10px]"
                          variant={message.status === 'failed' ? 'destructive' : 'outline'}
                        >
                          {getStatusLabel(message.status, t)}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="truncate">
                          {message.lastError || message.lastWarning || getBodyPreview(message)}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatRelativeTime(message.updatedAt, locale)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedMessage ? (
              <div className="flex min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 border-b px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold tracking-tight">
                        {selectedMessage.subject || t('mail.outbox.noSubject')}
                      </h3>
                      <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Users className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="shrink-0">{t('mail.composer.to')}</span>
                          <span className="truncate">
                            {formatAddresses(selectedMessage.to) ||
                              t('mail.outbox.noRecipients')}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                          <span title={formatAbsoluteTime(selectedMessage.updatedAt)}>
                            {formatRelativeTime(selectedMessage.updatedAt, locale)}
                          </span>
                        </div>
                        {selectedMessage.attachments?.length ? (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                              {t('mail.composer.attachmentsSummary', {
                                count: selectedMessage.attachments.length,
                                size: formatAttachmentSize(selectedMessage.attachments)
                              })}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <Badge
                      className="h-5 shrink-0 px-1.5 text-[10px]"
                      variant={selectedMessage.status === 'failed' ? 'destructive' : 'outline'}
                    >
                      {getStatusLabel(selectedMessage.status, t)}
                    </Badge>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                  {selectedMessage.lastError ? (
                    <div className="mb-3 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                      <p>{selectedMessage.lastError}</p>
                    </div>
                  ) : null}
                  {selectedMessage.lastWarning ? (
                    <div className="mb-3 flex gap-2 rounded-lg border bg-muted/35 p-2.5 text-xs text-muted-foreground">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                      <p>{selectedMessage.lastWarning}</p>
                    </div>
                  ) : null}
                  <div className="min-h-48 whitespace-pre-wrap break-words px-1 text-sm leading-6 text-foreground">
                    {getBodyPreview(selectedMessage) || t('mail.outbox.bodyEmpty')}
                  </div>
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/10 px-4 py-2.5">
                  {selectedMessage.status === 'draft' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onOpenDraft(selectedMessage)}
                    >
                      <FilePenLine data-icon="inline-start" />
                      {t('common.edit')}
                    </Button>
                  ) : null}
                  {selectedMessage.status === 'failed' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onRetry(selectedMessage)}
                    >
                      <RotateCcw data-icon="inline-start" />
                      {t('common.retry')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={pending || selectedMessage.status === 'sending'}
                    onClick={() => onDelete(selectedMessage)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatAddresses(addresses: OutboxMessage['to']): string {
  return addresses.filter(Boolean).join(', ')
}

function getBodyPreview(message: OutboxMessage): string {
  if (message.bodyText?.trim()) return message.bodyText.trim()
  return (
    message.bodyHtml
      ?.replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

function formatAttachmentSize(attachments: NonNullable<OutboxMessage['attachments']>): string {
  const bytes = attachments.reduce((total, attachment) => total + (attachment.sizeBytes ?? 0), 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getStatusLabel(status: OutboxMessage['status'], t: (key: TranslationKey) => string): string {
  if (status === 'draft') return t('mail.outbox.statusDraft')
  if (status === 'failed') return t('mail.outbox.statusFailed')
  if (status === 'sending') return t('mail.outbox.statusSending')
  if (status === 'sent') return t('mail.outbox.statusSent')
  return status
}
