import * as React from 'react'
import { toast } from 'sonner'

import type { Message } from '@renderer/components/mail/types'
import {
  bulkDeleteMessages,
  deleteMessage,
  type BulkDeleteMessagesResult,
  type DeleteMessageResult
} from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import { getErrorMessage } from './mailbox-utils'

type DeleteRequest = {
  messages: Message[]
}

type UseMessageActionsInput = {
  removeMessages: (messageIds: string[]) => void
  clearSelection: () => void
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useMessageActions({
  removeMessages,
  clearSelection,
  setError
}: UseMessageActionsInput): {
  deleteRequest: DeleteRequest | null
  deletingMessageIds: Set<string>
  deleting: boolean
  requestDeleteMessages: (messages: Message[]) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
} {
  const { t } = useI18n()
  const [deleteRequest, setDeleteRequest] = React.useState<DeleteRequest | null>(null)
  const [deletingMessageIds, setDeletingMessageIds] = React.useState<Set<string>>(() => new Set())

  const requestDeleteMessages = React.useCallback((messages: Message[]): void => {
    if (messages.length === 0) return
    setDeleteRequest({
      messages
    })
  }, [])

  const cancelDelete = React.useCallback((): void => {
    if (deletingMessageIds.size > 0) return
    setDeleteRequest(null)
  }, [deletingMessageIds.size])

  const confirmDelete = React.useCallback(async (): Promise<void> => {
    if (!deleteRequest || deletingMessageIds.size > 0) return

    const messageIds = deleteRequest.messages.map((message) => message.id)
    setDeletingMessageIds(new Set(messageIds))
    setError(null)

    try {
      if (deleteRequest.messages.length === 1) {
        const result = await deleteMessage({
          messageId: deleteRequest.messages[0].messageId,
          permanent: true
        })
        handleSingleDeleteResult(result, t)
        if (result.deleted || result.hidden) {
          removeMessages(messageIds)
          clearSelection()
          setDeleteRequest(null)
        }
        return
      }

      const result = await bulkDeleteMessages({
        messageIds: deleteRequest.messages.map((message) => message.messageId),
        permanent: true
      })
      handleBulkDeleteResult(result, t)
      if (result.succeededMessageIds.length > 0) {
        const succeededIds = new Set(result.succeededMessageIds.map(String))
        removeMessages(messageIds.filter((messageId) => succeededIds.has(messageId)))
      }
      if (result.failedCount === 0) {
        clearSelection()
        setDeleteRequest(null)
      }
    } catch (deleteError) {
      const message = getErrorMessage(deleteError, t('mail.delete.error'))
      setError(message)
      toast.error(message)
    } finally {
      setDeletingMessageIds(new Set())
    }
  }, [clearSelection, deleteRequest, deletingMessageIds.size, removeMessages, setError, t])

  return {
    deleteRequest,
    deletingMessageIds,
    deleting: deletingMessageIds.size > 0,
    requestDeleteMessages,
    cancelDelete,
    confirmDelete
  }
}

function handleSingleDeleteResult(
  result: DeleteMessageResult,
  t: ReturnType<typeof useI18n>['t']
): void {
  if (result.deleted || result.hidden) {
    toast.success(t('mail.delete.successSingle'))
    return
  }

  toast.error(result.error ?? t('mail.delete.error'))
}

function handleBulkDeleteResult(
  result: BulkDeleteMessagesResult,
  t: ReturnType<typeof useI18n>['t']
): void {
  if (result.failedCount === 0) {
    toast.success(t('mail.delete.successBulk', { count: result.deletedCount }))
    return
  }

  const examples = result.failedItems
    .slice(0, 3)
    .map((item) => item.error)
    .join('；')
  toast.error(
    t('mail.delete.partialFailed', {
      deleted: result.deletedCount,
      failed: result.failedCount,
      examples
    })
  )
}
