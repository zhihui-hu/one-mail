import * as React from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import type { Message } from '@renderer/components/mail/types'
import { getDisplaySubject } from '@renderer/components/mail/mail-display'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { useI18n } from '@renderer/lib/i18n'

type DeleteMessageDialogProps = {
  messages: Message[]
  open: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteMessageDialog({
  messages,
  open,
  pending = false,
  onOpenChange,
  onConfirm
}: DeleteMessageDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const count = messages.length
  const firstMessage = messages[0]
  const subject = firstMessage ? getDisplaySubject(firstMessage, t) : t('mail.delete.subjectFallback')
  const meta =
    count === 1
      ? [firstMessage?.from, firstMessage?.dateLabel || firstMessage?.time].filter(Boolean).join(' · ')
      : t('mail.delete.remoteMeta')

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent size="sm" className="sm:max-w-[360px]">
        <AlertDialogHeader className="gap-2">
          <AlertDialogMedia className="bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle className="font-semibold">{t('mail.delete.title')}</AlertDialogTitle>
          <AlertDialogDescription className="leading-5">
            {t('mail.delete.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-w-0 rounded-lg border bg-muted/40 px-3 py-2.5 text-left">
          <p className="truncate text-sm font-medium text-foreground">
            {count === 1 ? subject : t('mail.delete.summaryCount', { count })}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <AlertDialogFooter className="bg-background">
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || count === 0}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? t('common.deleting') : t('mail.selection.deletePermanently')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
