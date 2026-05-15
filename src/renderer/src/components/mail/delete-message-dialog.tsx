import * as React from 'react'
import { Trash2 } from 'lucide-react'

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
  permanent: boolean
  open: boolean
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteMessageDialog({
  messages,
  permanent,
  open,
  pending = false,
  onOpenChange,
  onConfirm
}: DeleteMessageDialogProps): React.JSX.Element {
  const count = messages.length
  const title = permanent ? '永久删除邮件' : '删除邮件'
  const description = permanent
    ? `将永久删除 ${count} 封废纸篓中的邮件。这个操作无法撤销。`
    : `将 ${count} 封邮件移到废纸篓。`

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || count === 0}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? '删除中...' : permanent ? '永久删除' : '移到废纸篓'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
