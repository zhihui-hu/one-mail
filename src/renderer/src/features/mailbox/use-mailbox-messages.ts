import * as React from 'react'

import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import {
  downloadAttachment,
  loadMessageBody,
  loadMessageDetail as loadMessageDetailApi,
  loadMessages,
  MESSAGE_LIST_PAGE_SIZE,
  setMessageReadState,
  toMessageQuery
} from '@renderer/lib/api'
import { isVerificationMailCandidate } from '../../../../shared/verification-code'
import {
  decrementUnreadCount,
  getErrorMessage,
  getMessageListScopeKey,
  mergeMessagesById,
  shouldAutoLoadBody
} from './mailbox-utils'

type MessageListPageState = {
  hasMore: boolean
  loadingMore: boolean
}

type UseMailboxMessagesInput = {
  selectedAccountId: string
  filters: MailFilterTag[]
  searchKeyword: string
  loading: boolean
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useMailboxMessages({
  selectedAccountId,
  filters,
  searchKeyword,
  loading,
  setAccounts,
  setError
}: UseMailboxMessagesInput): {
  messages: Message[]
  selectedMessage: Message | undefined
  selectedMessageId: string
  messagePage: MessageListPageState
  loadingMessageId: string | null
  loadingBodyMessageId: string | null
  downloadingAttachmentIds: Set<number>
  replaceMessages: (nextMessages: Message[]) => void
  clearMessages: () => void
  removeMessages: (messageIds: string[]) => void
  refreshMessages: (
    accountId: string,
    nextFilters: MailFilterTag[],
    nextSearchKeyword: string
  ) => Promise<void>
  selectMessage: (messageId: string) => void
  loadMoreMessages: () => void
  loadMessageBody: (message: Message) => void
  downloadMessageAttachment: (message: Message, attachmentId: number) => void
} {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [selectedMessageId, setSelectedMessageId] = React.useState('')
  const [messagePage, setMessagePage] = React.useState<MessageListPageState>({
    hasMore: false,
    loadingMore: false
  })
  const [loadingMessageId, setLoadingMessageId] = React.useState<string | null>(null)
  const [loadingBodyMessageId, setLoadingBodyMessageId] = React.useState<string | null>(null)
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const loadingMoreMessagesRef = React.useRef(false)
  const loadingMessageIdsRef = React.useRef<Set<string>>(new Set())
  const loadingBodyMessageIdsRef = React.useRef<Set<string>>(new Set())
  const loadMoreRequestTokenRef = React.useRef(0)
  const messageListScopeRef = React.useRef('')
  const markingReadMessageIdsRef = React.useRef<Set<string>>(new Set())
  const prefetchingVerificationMessageIdsRef = React.useRef<Set<string>>(new Set())

  const selectedMessage = messages.find((message) => message.id === selectedMessageId)

  const beginLoadingBody = React.useCallback((message: Message): boolean => {
    if (message.bodyLoaded || loadingBodyMessageIdsRef.current.has(message.id)) return false
    loadingBodyMessageIdsRef.current.add(message.id)
    return true
  }, [])

  const replaceMessages = React.useCallback((nextMessages: Message[]): void => {
    loadMoreRequestTokenRef.current += 1
    loadingMoreMessagesRef.current = false
    setMessages((current) => {
      const currentById = new Map(current.map((message) => [message.id, message]))
      return nextMessages.map((message) =>
        preserveLoadedMessage(message, currentById.get(message.id))
      )
    })
    setMessagePage({
      hasMore: nextMessages.length === MESSAGE_LIST_PAGE_SIZE,
      loadingMore: false
    })
    setSelectedMessageId((current) => {
      if (nextMessages.some((message) => message.id === current)) return current
      return nextMessages[0]?.id ?? ''
    })
  }, [])

  const clearMessages = React.useCallback((): void => {
    loadMoreRequestTokenRef.current += 1
    loadingMoreMessagesRef.current = false
    setMessages([])
    setSelectedMessageId('')
    setMessagePage({ hasMore: false, loadingMore: false })
  }, [])

  const removeMessages = React.useCallback((messageIds: string[]): void => {
    const removedIds = new Set(messageIds)
    setMessages((current) => {
      const next = current.filter((message) => !removedIds.has(message.id))
      setSelectedMessageId((selectedId) => {
        if (!removedIds.has(selectedId)) return selectedId
        return next[0]?.id ?? ''
      })
      return next
    })
  }, [])

  React.useEffect(() => {
    messageListScopeRef.current = getMessageListScopeKey(selectedAccountId, filters, searchKeyword)
  }, [filters, searchKeyword, selectedAccountId])

  const refreshMessages = React.useCallback(
    async (
      accountId: string,
      nextFilters: MailFilterTag[],
      nextSearchKeyword: string
    ): Promise<void> => {
      loadMoreRequestTokenRef.current += 1
      loadingMoreMessagesRef.current = false
      setMessagePage((current) => ({ ...current, loadingMore: false }))

      if (!accountId) {
        clearMessages()
        return
      }
      const nextMessages = await loadMessages(
        toMessageQuery(
          accountId,
          nextFilters,
          { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 },
          nextSearchKeyword
        )
      )
      replaceMessages(nextMessages)
    },
    [clearMessages, replaceMessages]
  )

  const loadMoreMessages = React.useCallback((): void => {
    if (
      loading ||
      loadingMoreMessagesRef.current ||
      messagePage.loadingMore ||
      !messagePage.hasMore ||
      !selectedAccountId
    ) {
      return
    }

    loadingMoreMessagesRef.current = true
    const requestToken = loadMoreRequestTokenRef.current + 1
    loadMoreRequestTokenRef.current = requestToken
    setMessagePage((current) => ({ ...current, loadingMore: true }))
    setError(null)

    const offset = messages.length
    const scopeKey = getMessageListScopeKey(selectedAccountId, filters, searchKeyword)
    void loadMessages(
      toMessageQuery(
        selectedAccountId,
        filters,
        { limit: MESSAGE_LIST_PAGE_SIZE, offset },
        searchKeyword
      )
    )
      .then((nextMessages) => {
        if (
          messageListScopeRef.current !== scopeKey ||
          loadMoreRequestTokenRef.current !== requestToken
        ) {
          return
        }
        setMessages((current) => mergeMessagesById(current, nextMessages))
        setMessagePage({
          hasMore: nextMessages.length === MESSAGE_LIST_PAGE_SIZE,
          loadingMore: false
        })
      })
      .catch((loadError) => {
        if (loadMoreRequestTokenRef.current !== requestToken) return
        setError(getErrorMessage(loadError, '加载更多邮件失败。'))
        setMessagePage((current) => ({ ...current, loadingMore: false }))
      })
      .finally(() => {
        if (loadMoreRequestTokenRef.current === requestToken) {
          loadingMoreMessagesRef.current = false
        }
      })
  }, [
    filters,
    loading,
    messagePage.hasMore,
    messagePage.loadingMore,
    messages.length,
    searchKeyword,
    selectedAccountId,
    setError
  ])

  const loadMessageDetail = React.useCallback(
    (messageId: string): void => {
      if (loadingMessageIdsRef.current.has(messageId)) return
      loadingMessageIdsRef.current.add(messageId)
      setLoadingMessageId(messageId)

      void loadMessageDetailById(messageId)
        .then((detail) => {
          if (!detail) return
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId ? { ...message, ...detail } : message
            )
          )
        })
        .catch((loadError) => {
          setError(getErrorMessage(loadError, '加载邮件详情失败。'))
        })
        .finally(() => {
          loadingMessageIdsRef.current.delete(messageId)
          setLoadingMessageId((current) => (current === messageId ? null : current))
        })
    },
    [setError]
  )

  const loadMessageBodyForReader = React.useCallback(
    (message: Message): void => {
      if (!beginLoadingBody(message)) return
      setLoadingBodyMessageId(message.id)

      void loadMessageBody(message)
        .then((detail) => {
          replaceMessage(message.id, detail, setMessages)
        })
        .catch((loadError) => {
          setError(getErrorMessage(loadError, '加载邮件正文失败。'))
        })
        .finally(() => {
          loadingBodyMessageIdsRef.current.delete(message.id)
          setLoadingBodyMessageId((current) => (current === message.id ? null : current))
        })
    },
    [beginLoadingBody, setError]
  )

  React.useEffect(() => {
    const candidates = messages
      .filter(
        (message) =>
          !message.verificationCode &&
          !message.bodyLoaded &&
          message.bodyStatus !== 'error' &&
          !prefetchingVerificationMessageIdsRef.current.has(message.id) &&
          isVerificationMailCandidate(message.subject, message.preview)
      )
      .slice(0, 3)

    for (const message of candidates) {
      if (!beginLoadingBody(message)) continue
      prefetchingVerificationMessageIdsRef.current.add(message.id)

      void loadMessageBody(message)
        .then((detail) => {
          replaceMessage(message.id, detail, setMessages)
        })
        .catch(() => undefined)
        .finally(() => {
          loadingBodyMessageIdsRef.current.delete(message.id)
          prefetchingVerificationMessageIdsRef.current.delete(message.id)
        })
    }
  }, [beginLoadingBody, messages])

  const markMessageReadOnOpen = React.useCallback(
    (message: Message): void => {
      if (!message.unread || markingReadMessageIdsRef.current.has(message.id)) return

      markingReadMessageIdsRef.current.add(message.id)
      setError(null)

      void setMessageReadState(message.messageId, true)
        .then(() => {
          setMessages((current) =>
            current.map((item) => (item.id === message.id ? { ...item, unread: false } : item))
          )
          setAccounts((current) => decrementUnreadCount(current, message.accountId))
        })
        .catch((readStateError) => {
          setError(getErrorMessage(readStateError, '同步已读状态失败。'))
        })
        .finally(() => {
          markingReadMessageIdsRef.current.delete(message.id)
        })
    },
    [setAccounts, setError]
  )

  const reloadMessageDetail = React.useCallback((message: Message): Promise<void> => {
    return loadMessageDetailById(String(message.messageId)).then((detail) => {
      if (!detail) return
      replaceMessage(message.id, detail, setMessages)
    })
  }, [])

  const downloadMessageAttachment = React.useCallback(
    (message: Message, attachmentId: number): void => {
      if (downloadingAttachmentIds.has(attachmentId)) return

      setDownloadingAttachmentIds((current) => new Set(current).add(attachmentId))
      setError(null)

      void downloadAttachment(attachmentId)
        .then(async (result) => {
          if (!result.downloaded) return
          await reloadMessageDetail(message)
        })
        .catch((downloadError) => {
          setError(getErrorMessage(downloadError, '下载附件失败。'))
          void reloadMessageDetail(message)
        })
        .finally(() => {
          setDownloadingAttachmentIds((current) => {
            const next = new Set(current)
            next.delete(attachmentId)
            return next
          })
        })
    },
    [downloadingAttachmentIds, reloadMessageDetail, setError]
  )

  const selectMessage = React.useCallback(
    (messageId: string): void => {
      setSelectedMessageId(messageId)
      const message = messages.find((item) => item.id === messageId)
      if (message) markMessageReadOnOpen(message)
      if (!message?.detailLoaded) loadMessageDetail(messageId)
    },
    [loadMessageDetail, markMessageReadOnOpen, messages]
  )

  React.useEffect(() => {
    if (!selectedMessage || loading) return

    markMessageReadOnOpen(selectedMessage)

    const timer = window.setTimeout(() => {
      if (!selectedMessage.detailLoaded) {
        if (loadingMessageId !== selectedMessage.id) loadMessageDetail(selectedMessage.id)
        return
      }

      if (shouldAutoLoadBody(selectedMessage) && loadingBodyMessageId !== selectedMessage.id) {
        loadMessageBodyForReader(selectedMessage)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    loadMessageBodyForReader,
    loadMessageDetail,
    loading,
    loadingBodyMessageId,
    loadingMessageId,
    markMessageReadOnOpen,
    selectedMessage
  ])

  return {
    messages,
    selectedMessage,
    selectedMessageId,
    messagePage,
    loadingMessageId,
    loadingBodyMessageId,
    downloadingAttachmentIds,
    replaceMessages,
    clearMessages,
    removeMessages,
    refreshMessages,
    selectMessage,
    loadMoreMessages,
    loadMessageBody: loadMessageBodyForReader,
    downloadMessageAttachment
  }
}

function loadMessageDetailById(messageId: string): Promise<Message | null> {
  return loadMessageDetailApi(Number(messageId))
}

function replaceMessage(
  messageId: string,
  detail: Message,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
): void {
  setMessages((current) =>
    current.map((item) => (item.id === messageId ? { ...item, ...detail } : item))
  )
}

function preserveLoadedMessage(next: Message, current: Message | undefined): Message {
  if (!current || next.detailLoaded || (!current.detailLoaded && !current.bodyLoaded)) {
    return next
  }

  return {
    ...next,
    body: current.body,
    html: current.html,
    bodyStatus: current.bodyLoaded ? current.bodyStatus : next.bodyStatus,
    bodyLoaded: current.bodyLoaded,
    detailLoaded: current.detailLoaded,
    externalImagesBlocked: current.externalImagesBlocked,
    attachments: current.detailLoaded ? current.attachments : next.attachments
  }
}
