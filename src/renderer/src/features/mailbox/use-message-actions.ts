import * as React from 'react'
import { toast } from 'sonner'

import type { Message } from '@renderer/components/mail/types'
import {
  bulkDeleteMessages,
  deleteMessage,
  type BulkDeleteMessagesResult,
  type DeleteMessageResult
} from '@renderer/lib/api'
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
        handleSingleDeleteResult(result)
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
      handleBulkDeleteResult(result)
      if (result.succeededMessageIds.length > 0) {
        const succeededIds = new Set(result.succeededMessageIds.map(String))
        removeMessages(messageIds.filter((messageId) => succeededIds.has(messageId)))
      }
      if (result.failedCount === 0) {
        clearSelection()
        setDeleteRequest(null)
      }
    } catch (deleteError) {
      const message = getErrorMessage(deleteError, '删除邮件失败。')
      setError(message)
      toast.error(message)
    } finally {
      setDeletingMessageIds(new Set())
    }
  }, [clearSelection, deleteRequest, deletingMessageIds.size, removeMessages, setError])

  return {
    deleteRequest,
    deletingMessageIds,
    deleting: deletingMessageIds.size > 0,
    requestDeleteMessages,
    cancelDelete,
    confirmDelete
  }
}

function handleSingleDeleteResult(result: DeleteMessageResult): void {
  if (result.deleted || result.hidden) {
    toast.success('邮件已永久删除')
    return
  }

  toast.error(result.error ?? '删除邮件失败。')
}

function handleBulkDeleteResult(result: BulkDeleteMessagesResult): void {
  if (result.failedCount === 0) {
    toast.success(`已删除 ${result.deletedCount} 封邮件`)
    return
  }

  const examples = result.failedItems
    .slice(0, 3)
    .map((item) => item.error)
    .join('；')
  toast.error(`已删除 ${result.deletedCount} 封，${result.failedCount} 封失败。${examples}`)
}
