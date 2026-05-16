import * as React from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import type { Message } from '@renderer/components/mail/types'
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
  const count = messages.length
  const firstMessage = messages[0]
  const subject = firstMessage?.subject?.trim() || '无主题邮件'
  const meta =
    count === 1
      ? [firstMessage?.from, firstMessage?.dateLabel || firstMessage?.time].filter(Boolean).join(' · ')
      : '这些邮件会立即从远端邮箱中删除'

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
          <AlertDialogTitle className="font-semibold">永久删除邮件？</AlertDialogTitle>
          <AlertDialogDescription className="leading-5">
            删除后无法从 OneMail 恢复，请确认后继续。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="min-w-0 rounded-lg border bg-muted/40 px-3 py-2.5 text-left">
          <p className="truncate text-sm font-medium text-foreground">
            {count === 1 ? subject : `${count} 封邮件`}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p>
        </div>
        <AlertDialogFooter className="bg-background">
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || count === 0}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? '删除中...' : '永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
