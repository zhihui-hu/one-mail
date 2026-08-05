import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from '@tanstack/react-table'
import {
  Download,
  FileText,
  Forward,
  Image,
  Paperclip,
  Reply,
  RefreshCw,
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
import { SweepShine } from '@renderer/components/sweep-shine'
import { UnderlineHover } from '@renderer/components/underline-hover'
import { Button } from '@renderer/components/ui/button'
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
import { startWindowDrag } from '@renderer/lib/window-drag'

const REMOTE_IMAGES_HELP_URL = 'https://huzhihui.com/blog/click-load-images-ip-leak-email-tracking'
const MAIL_HTML_PREPARE_DELAY_MS = 40

type PreparedMailHtmlState = {
  messageId: string
  sourceHtml: string
  allowExternalImages: boolean
  result: PreparedMailHtml
}

type MailReaderProps = {
  message: Message
  recipientAddress: string
  loading?: boolean
  loadingBody?: boolean
  externalImagesBlocked?: boolean
  downloadingAttachmentIds?: Set<number>
  actionPending?: boolean
  deleting?: boolean
  onLoadBody: () => void
  onDownloadAttachment?: (attachment: Attachment) => void
  onReply?: () => void
  onForward?: () => void
  onDelete?: () => void
}

export function MailReader({
  message,
  recipientAddress,
  loading = false,
  loadingBody = false,
  externalImagesBlocked = true,
  downloadingAttachmentIds,
  actionPending = false,
  deleting = false,
  onLoadBody,
  onDownloadAttachment,
  onReply,
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
    !externalImagesBlocked ||
    (externalContentState.messageId === message.id && externalContentState.allowed)
  const htmlSource = message.html ?? ''
  const [preparedHtmlState, setPreparedHtmlState] = React.useState<PreparedMailHtmlState | null>(
    null
  )
  const preparedHtml =
    canShowHtml &&
    preparedHtmlState?.messageId === message.id &&
    preparedHtmlState.sourceHtml === htmlSource &&
    preparedHtmlState.allowExternalImages === externalContentAllowed
      ? preparedHtmlState.result
      : null
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

  React.useEffect(() => {
    if (!canShowHtml) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      const result = prepareMailHtml(htmlSource, { allowExternalImages: externalContentAllowed })
      if (!cancelled) {
        setPreparedHtmlState({
          messageId: message.id,
          sourceHtml: htmlSource,
          allowExternalImages: externalContentAllowed,
          result
        })
      }
    }, MAIL_HTML_PREPARE_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [canShowHtml, externalContentAllowed, htmlSource, message.id])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        className="app-drag-region app-window-controls-inset native-toolbar flex h-12 shrink-0 items-center gap-2 border-b px-3 text-xs"
        onMouseDown={startWindowDrag}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
          {canShowHtml ? (
            <>
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {externalContentAllowed
                  ? t('mail.reader.safeFull')
                  : canLoadFullContent
                    ? t('mail.reader.safeBlocked', { count: blockedCount })
                    : t('mail.reader.safePreview')}
              </span>
            </>
          ) : null}
        </div>
        <div className="app-no-drag flex shrink-0 items-center gap-1">
          {loadingBody ? (
            <Button size="xs" variant="ghost" disabled>
              <FileText data-icon="inline-start" />
              <SweepShine>{t('mail.reader.loadingBody')}</SweepShine>
            </Button>
          ) : canLoadFullContent ? (
            <>
              <RemoteImagesHelpLink />
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg text-primary hover:bg-primary/10 hover:text-primary"
                onClick={allowExternalContent}
              >
                <Image data-icon="inline-start" />
                {t('mail.reader.loadFullContent')}
              </Button>
            </>
          ) : !hasLoadedBody && message.bodyStatus === 'error' ? (
            <Button size="xs" variant="ghost" onClick={onLoadBody}>
              <FileText data-icon="inline-start" />
              {t('common.retry')}
            </Button>
          ) : null}
          <TooltipProvider>
            <div className="ml-1 flex items-center gap-0.5 border-l pl-1.5">
              <MailActionButton
                label={t('mail.reader.reply')}
                disabled={actionPending}
                onClick={onReply}
              >
                <Reply aria-hidden="true" />
              </MailActionButton>
              <MailActionButton
                label={t('mail.reader.forward')}
                disabled={actionPending}
                onClick={onForward}
              >
                <Forward aria-hidden="true" />
              </MailActionButton>
              <MailActionButton
                label={t('common.delete')}
                disabled={deleting}
                onClick={onDelete}
              >
                <Trash2 aria-hidden="true" />
              </MailActionButton>
            </div>
          </TooltipProvider>
        </div>
      </header>

      <article className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="shrink-0 border-b px-5 py-4">
          <div className="flex items-start gap-3">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-muted-foreground"
              aria-hidden="true"
            >
              {getAvatarLabel(displaySender)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <h2 className="truncate text-[15px] font-semibold leading-5 tracking-normal">
                  {displaySender}
                </h2>
                <time
                  className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground"
                  title={formatAbsoluteTime(message.receivedAt)}
                >
                  {formatRelativeTime(message.receivedAt, locale)}
                </time>
              </div>
              <p className="mt-0.5 truncate text-[13px] leading-5 text-foreground">
                {displaySubject}
              </p>
              <TooltipProvider>
                <div className="mt-1 flex flex-col gap-0.5 text-[11px] leading-4 text-muted-foreground">
                  <MetaLine
                    label={t('mail.reader.from')}
                    value={message.fromAddress || displaySender}
                  />
                  <MetaLine label={t('mail.reader.to')} value={displayRecipientAddress} />
                  {message.cc ? <MetaLine label={t('mail.reader.cc')} value={message.cc} /> : null}
                </div>
              </TooltipProvider>
            </div>
          </div>
        </section>

        <div className="mail-reader-scroll min-h-0 flex-1 overflow-auto px-6 py-5">
          {loading && !message.detailLoaded ? (
            <section className="text-xs text-muted-foreground">
              <SweepShine>{t('mail.reader.loadingDetails')}</SweepShine>
            </section>
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
        </div>

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
          className="rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/8"
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
          <UnderlineHover asChild>
            <a
              href={REMOTE_IMAGES_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('mail.reader.remoteHelp')}
            </a>
          </UnderlineHover>
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
    return <MessageBodyLoading />
  }

  if (canShowHtml && !preparedHtml) {
    return <MessageBodyLoading />
  }

  if (!canShowHtml && !message.bodyLoaded) {
    return (
      <div className="flex w-full max-w-xl items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-xs text-muted-foreground shadow-xs">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <FileText className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {message.bodyStatus === 'error'
            ? message.bodyError || t('mail.reader.bodyErrorRetry')
            : t('common.bodyNotLoaded')}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          disabled={!canLoadBody}
          onClick={onLoadBody}
        >
          <RefreshCw data-icon="inline-start" />
          {message.bodyStatus === 'error'
            ? t('common.retry')
            : t('mail.reader.bodyClickLoad')}
        </Button>
      </div>
    )
  }

  return (
    <section className="prose-mail flex min-w-0 flex-col select-text text-sm text-foreground">
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

function MessageBodyLoading(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <section
      className="flex w-full max-w-xl items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-xs text-muted-foreground shadow-xs"
      role="status"
      aria-live="polite"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileText className="size-3.5" aria-hidden="true" />
      </span>
      <SweepShine>{t('mail.reader.loadingBody')}</SweepShine>
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
  const columns = React.useMemo<ColumnDef<Attachment>[]>(
    () => [
      {
        id: 'file',
        header: t('mail.reader.attachmentFileName'),
        cell: ({ row }) => {
          const attachment = row.original
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium leading-4">
                {getDisplayAttachmentName(attachment, t)}
              </span>
              <span className="truncate leading-4 text-muted-foreground">
                {getDisplayAttachmentSize(attachment, t)} ·{' '}
                {getDisplayAttachmentType(attachment, t)}
              </span>
            </div>
          )
        }
      },
      {
        id: 'action',
        header: t('mail.reader.attachmentAction'),
        cell: ({ row }) => {
          const attachment = row.original
          const isDownloading =
            attachment.id !== undefined && downloadingAttachmentIds?.has(attachment.id)
          const canDownload = Boolean(attachment.id && onDownloadAttachment && !isDownloading)

          return (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canDownload}
              onClick={(event) => {
                event.stopPropagation()
                if (canDownload) onDownloadAttachment?.(attachment)
              }}
            >
              <Download data-icon="inline-start" />
              {isDownloading ? (
                <SweepShine>{t('common.download')}</SweepShine>
              ) : (
                t('common.download')
              )}
            </Button>
          )
        }
      }
    ],
    [downloadingAttachmentIds, onDownloadAttachment, t]
  )
  const table = useReactTable({
    data: attachments,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (attachment) =>
      String(attachment.id ?? `${attachment.name}:${attachment.size}:${attachment.type}`)
  })

  return (
    <section className="shrink-0 border-t bg-background px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
        <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
        {t('mail.reader.attachments')}
      </div>
      <div className="overflow-hidden rounded-md border bg-card">
        <Table className="text-[12px]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={
                      header.column.id === 'action'
                        ? 'h-8 w-24 text-right text-[12px]'
                        : 'h-8 min-w-56 text-[12px]'
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const attachment = row.original
              const isDownloading =
                attachment.id !== undefined && downloadingAttachmentIds?.has(attachment.id)
              const canDownload = Boolean(attachment.id && onDownloadAttachment && !isDownloading)

              return (
                <TableRow
                  key={row.id}
                  className={canDownload ? 'cursor-pointer' : undefined}
                  onClick={() => {
                    if (canDownload) onDownloadAttachment?.(attachment)
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        cell.column.id === 'action'
                          ? 'w-24 py-2 text-right'
                          : 'max-w-0 py-2'
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
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
    <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-baseline ">
      <span>{label}:</span>
      <EllipsisTooltip alwaysShow className="min-w-0 truncate text-foreground" tooltip={value}>
        {value}
      </EllipsisTooltip>
    </div>
  )
}

function getAvatarLabel(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
