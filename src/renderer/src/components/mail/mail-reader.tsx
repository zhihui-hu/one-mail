import {
  Download,
  FileText,
  Forward,
  Image,
  Loader2,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import * as React from 'react'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { EllipsisTooltip } from '@renderer/components/mail/ellipsis-tooltip'
import {
  ATTACHMENT_METADATA_PENDING_SIZE,
  getDisplayAttachmentName,
  getDisplayAttachmentSize,
  getDisplayAttachmentType,
  getDisplayBodyParagraphs,
  getDisplaySender,
  getDisplaySubject
} from '@renderer/components/mail/mail-display'
import { prepareMailHtml, type PreparedMailHtml } from '@renderer/components/mail/mail-html'
import type { Attachment, Message } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'

const REMOTE_IMAGES_HELP_URL = 'https://huzhihui.com/blog/click-load-images-ip-leak-email-tracking'

type MailReaderProps = {
  message: Message
  recipientAddress: string
  loading?: boolean
  loadingBody?: boolean
  downloadingAttachmentIds?: Set<number>
  actionPending?: boolean
  deleting?: boolean
  onLoadBody: () => void
  onDownloadAttachment?: (attachment: Attachment) => void
  onReply?: () => void
  onReplyAll?: () => void
  onForward?: () => void
  onDelete?: () => void
}

export function MailReader({
  message,
  recipientAddress,
  loading = false,
  loadingBody = false,
  downloadingAttachmentIds,
  actionPending = false,
  deleting = false,
  onLoadBody,
  onDownloadAttachment,
  onReply,
  onReplyAll,
  onForward,
  onDelete
}: MailReaderProps): React.JSX.Element {
  const { locale, t } = useI18n()
  const canShowHtml = Boolean(message.html)
  const hasLoadedBody = message.bodyLoaded || canShowHtml
  const canLoadBody = !hasLoadedBody && !loadingBody
  const [externalContentState, setExternalContentState] = React.useState({
    allowed: false,
    messageId: message.id
  })
  const externalContentAllowed =
    externalContentState.messageId === message.id && externalContentState.allowed
  const preparedHtml = React.useMemo(
    () =>
      canShowHtml
        ? prepareMailHtml(message.html ?? '', { allowExternalImages: externalContentAllowed })
        : null,
    [canShowHtml, externalContentAllowed, message.html]
  )
  const blockedCount =
    preparedHtml?.blockedImageResourceCount ?? preparedHtml?.blockedResourceCount ?? 0
  const canLoadFullContent = canShowHtml && !externalContentAllowed && blockedCount > 0
  const allowExternalContent = React.useCallback(() => {
    setExternalContentState({ allowed: true, messageId: message.id })
  }, [message.id])
  const hasRealAttachments = message.attachments.some(
    (attachment) => attachment.size !== ATTACHMENT_METADATA_PENDING_SIZE
  )
  const displayRecipientAddress = message.to ?? recipientAddress
  const displaySubject = getDisplaySubject(message, t)
  const displaySender = getDisplaySender(message, t)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {canShowHtml ? (
        <header className="app-drag-region flex h-10 shrink-0 items-center gap-3 border-b bg-card/60 px-4 text-xs">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {externalContentAllowed
                ? t('mail.reader.safeFull')
                : canLoadFullContent
                  ? t('mail.reader.safeBlocked', { count: blockedCount })
                  : t('mail.reader.safePreview')}
            </span>
          </div>
          <div className="app-no-drag flex shrink-0 items-center gap-2">
            {loadingBody ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                {t('mail.reader.loadingBody')}
              </Button>
            ) : canLoadFullContent ? (
              <>
                <RemoteImagesHelpLink />
                <Button size="sm" variant="outline" onClick={allowExternalContent}>
                  <Image data-icon="inline-start" />
                  {t('mail.reader.loadFullContent')}
                </Button>
              </>
            ) : !hasLoadedBody && message.bodyStatus === 'error' ? (
              <Button size="sm" variant="outline" onClick={onLoadBody}>
                {loadingBody ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FileText data-icon="inline-start" />
                )}
                {t('mail.reader.retryLoadBody')}
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <article className="flex w-full min-w-0 flex-col px-5 py-4">
          <section className="mb-3 border-b pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold leading-snug tracking-normal">
                  {displaySubject}
                </h2>
                <TooltipProvider>
                  <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                    <MetaLine
                      label={t('mail.reader.from')}
                      value={formatAddress(displaySender, message.fromAddress)}
                    />
                    <MetaLine label={t('mail.reader.to')} value={displayRecipientAddress} />
                    {message.cc ? <MetaLine label={t('mail.reader.cc')} value={message.cc} /> : null}
                  </div>
                </TooltipProvider>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <div
                  className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                  title={formatAbsoluteTime(message.receivedAt)}
                >
                  {formatRelativeTime(message.receivedAt, locale)}
                </div>
                <TooltipProvider>
                  <div className="flex items-center gap-1">
                    <MailActionButton label={t('mail.reader.reply')} disabled={actionPending} onClick={onReply}>
                      {actionPending ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Reply aria-hidden="true" />
                      )}
                    </MailActionButton>
                    <MailActionButton
                      label={t('mail.reader.replyAll')}
                      disabled={actionPending}
                      onClick={onReplyAll}
                    >
                      {actionPending ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <ReplyAll aria-hidden="true" />
                      )}
                    </MailActionButton>
                    <MailActionButton label={t('mail.reader.forward')} disabled={actionPending} onClick={onForward}>
                      {actionPending ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Forward aria-hidden="true" />
                      )}
                    </MailActionButton>
                    <MailActionButton label={t('common.delete')} disabled={deleting} onClick={onDelete}>
                      {deleting ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 aria-hidden="true" />
                      )}
                    </MailActionButton>
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </section>

          {loading && !message.detailLoaded ? (
            <section className="text-xs text-muted-foreground">{t('mail.reader.loadingDetails')}</section>
          ) : (
            <MessageBody
              message={message}
              canShowHtml={canShowHtml}
              canLoadBody={canLoadBody}
              loadingBody={loadingBody}
              preparedHtml={preparedHtml}
              t={t}
              onLoadBody={onLoadBody}
            />
          )}

          {hasRealAttachments ? (
            <AttachmentList
              attachments={message.attachments}
              downloadingAttachmentIds={downloadingAttachmentIds}
              t={t}
              onDownloadAttachment={onDownloadAttachment}
            />
          ) : null}
        </article>
      </div>
    </div>
  )
}

function MailActionButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function RemoteImagesHelpLink(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={REMOTE_IMAGES_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('mail.reader.remoteHelp')}
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-72 whitespace-normal leading-5">
          {t('mail.reader.remoteHelpTooltip')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function MessageBody({
  message,
  canShowHtml,
  canLoadBody,
  loadingBody,
  preparedHtml,
  t,
  onLoadBody
}: {
  message: Message
  canShowHtml: boolean
  canLoadBody: boolean
  loadingBody: boolean
  preparedHtml: PreparedMailHtml | null
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  onLoadBody: () => void
}): React.JSX.Element {
  if (!canShowHtml && loadingBody) {
    return <MessageBodySkeleton />
  }

  if (!canShowHtml && !message.bodyLoaded) {
    return (
      <section
        role="button"
        tabIndex={0}
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border bg-card p-5 text-center text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          if (canLoadBody) onLoadBody()
        }}
        onKeyDown={(event) => {
          if (!canLoadBody || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          onLoadBody()
        }}
      >
        <FileText aria-hidden="true" />
        <span>
          {message.bodyStatus === 'error'
            ? t('mail.reader.bodyErrorRetry')
            : t('mail.reader.bodyClickLoad')}
        </span>
      </section>
    )
  }

  return (
    <section className="prose-mail flex min-w-0 flex-col select-text text-sm leading-6 text-foreground">
      {canShowHtml ? (
        <div
          className="mail-html min-h-40 select-text bg-background"
          dangerouslySetInnerHTML={{ __html: preparedHtml?.html ?? '' }}
        />
      ) : (
        <div className="mail-text min-h-40 w-full max-w-full select-text">
          {getDisplayBodyParagraphs(message, t).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}
    </section>
  )
}

function MessageBodySkeleton(): React.JSX.Element {
  return (
    <section className="flex min-h-40 flex-col gap-4 rounded-md border bg-card p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-44 max-w-full" />
          <Skeleton className="h-3 w-28 max-w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[86%]" />
        <Skeleton className="h-3 w-[74%]" />
      </div>
      <div className="flex flex-col gap-2.5 pt-2">
        <Skeleton className="h-3 w-[96%]" />
        <Skeleton className="h-3 w-[88%]" />
        <Skeleton className="h-3 w-[64%]" />
      </div>
    </section>
  )
}

function AttachmentList({
  attachments,
  downloadingAttachmentIds,
  t,
  onDownloadAttachment
}: {
  attachments: Message['attachments']
  downloadingAttachmentIds?: Set<number>
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  onDownloadAttachment?: (attachment: Attachment) => void
}): React.JSX.Element {
  return (
    <section className="mt-5 border-t pt-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
        <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
        {t('mail.reader.attachments')}
      </div>
      <div className="overflow-hidden rounded-md border bg-card">
        <Table className="text-[12px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 min-w-56 text-[12px]">
                {t('mail.reader.attachmentFileName')}
              </TableHead>
              <TableHead className="h-8 w-24 text-right text-[12px]">
                {t('mail.reader.attachmentAction')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attachments.map((attachment) => {
              const isDownloading =
                attachment.id !== undefined && downloadingAttachmentIds?.has(attachment.id)
              const canDownload = Boolean(attachment.id && onDownloadAttachment && !isDownloading)
              const attachmentName = getDisplayAttachmentName(attachment, t)
              const attachmentSize = getDisplayAttachmentSize(attachment, t)
              const attachmentType = getDisplayAttachmentType(attachment, t)

              return (
                <TableRow
                  key={attachment.id ?? attachment.name}
                  className={canDownload ? 'cursor-pointer' : undefined}
                  onClick={() => {
                    if (canDownload) onDownloadAttachment?.(attachment)
                  }}
                >
                  <TableCell className="max-w-0 py-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium leading-4">{attachmentName}</span>
                      <span className="truncate leading-4 text-muted-foreground">
                        {attachmentSize} · {attachmentType}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="w-24 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canDownload}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (canDownload) onDownloadAttachment?.(attachment)
                      }}
                    >
                      {isDownloading ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Download data-icon="inline-start" />
                      )}
                      {t('common.download')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function MetaLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] gap-3">
      <span>{label}:</span>
      <EllipsisTooltip alwaysShow className="min-w-0 truncate text-foreground" tooltip={value}>
        {value}
      </EllipsisTooltip>
    </div>
  )
}

function formatAddress(name: string, email?: string): string {
  return email ? `${name} <${email}>` : name
}
