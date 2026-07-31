import * as React from 'react'

import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import {
  downloadAttachment,
  bulkSetMessageReadState,
  loadMessageBody,
  loadMessageDetail as loadMessageDetailApi,
  loadMessages,
  markAllMessagesRead,
  MESSAGE_LIST_PAGE_SIZE,
  setMessageReadState,
  toMessageQuery
} from '@renderer/pages/mailbox/api'
import type { MessageBulkReadStateResult, MessageListQuery } from '@renderer/shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { isVerificationMailCandidate } from '@renderer/shared/verification-code'
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

type ReplaceMessagesOptions = {
  selectFirst?: boolean
}

const MESSAGE_OPEN_SIDE_EFFECT_DELAY_MS = 80

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
  markingRead: boolean
  replaceMessages: (nextMessages: Message[], options?: ReplaceMessagesOptions) => void
  clearMessages: () => void
  removeMessages: (messageIds: string[]) => void
  refreshMessages: (
    accountId: string,
    nextFilters: MailFilterTag[],
    nextSearchKeyword: string,
    options?: ReplaceMessagesOptions
  ) => Promise<void>
  selectMessage: (messageId: string) => void
  markMessagesRead: (targetMessages: Message[]) => Promise<MessageBulkReadStateResult>
  markCurrentQueryRead: (query: MessageListQuery) => Promise<MessageBulkReadStateResult>
  loadMoreMessages: () => void
  loadMessageBody: (message: Message) => void
  downloadMessageAttachment: (message: Message, attachmentId: number) => void
} {
  const { t } = useI18n()
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
  const [markingRead, setMarkingRead] = React.useState(false)
  const loadingMoreMessagesRef = React.useRef(false)
  const loadingMessageIdsRef = React.useRef<Set<string>>(new Set())
  const loadingBodyMessageIdsRef = React.useRef<Set<string>>(new Set())
  const loadMoreRequestTokenRef = React.useRef(0)
  const messageListScopeRef = React.useRef('')
  const markingReadMessageIdsRef = React.useRef<Set<string>>(new Set())
  const prefetchingVerificationMessageIdsRef = React.useRef<Set<string>>(new Set())

  const messagesById = React.useMemo(() => {
    return new Map(messages.map((message) => [message.id, message]))
  }, [messages])
  const selectedMessage = selectedMessageId ? messagesById.get(selectedMessageId) : undefined

  const beginLoadingBody = React.useCallback((message: Message): boolean => {
    if (message.bodyLoaded || loadingBodyMessageIdsRef.current.has(message.id)) return false
    loadingBodyMessageIdsRef.current.add(message.id)
    return true
  }, [])

  const replaceMessages = React.useCallback(
    (nextMessages: Message[], options: ReplaceMessagesOptions = {}): void => {
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
        return options.selectFirst ? (nextMessages[0]?.id ?? '') : ''
      })
    },
    []
  )

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
      nextSearchKeyword: string,
      options: ReplaceMessagesOptions = {}
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
      replaceMessages(nextMessages, options)
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
        setError(getErrorMessage(loadError, t('mailbox.loadMoreError')))
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
    setError,
    t
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
          setError(getErrorMessage(loadError, t('mailbox.loadDetailError')))
        })
        .finally(() => {
          loadingMessageIdsRef.current.delete(messageId)
          setLoadingMessageId((current) => (current === messageId ? null : current))
        })
    },
    [setError, t]
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
          setError(getErrorMessage(loadError, t('mailbox.loadBodyError')))
        })
        .finally(() => {
          loadingBodyMessageIdsRef.current.delete(message.id)
          setLoadingBodyMessageId((current) => (current === message.id ? null : current))
        })
    },
    [beginLoadingBody, setError, t]
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
          setError(getErrorMessage(readStateError, t('mailbox.readStateError')))
        })
        .finally(() => {
          markingReadMessageIdsRef.current.delete(message.id)
        })
    },
    [setAccounts, setError, t]
  )

  const applyReadStateUpdates = React.useCallback(
    (result: MessageBulkReadStateResult): void => {
      if (result.updates.length === 0) return

      const succeededIds = new Set(result.updates.map((update) => String(update.messageId)))
      const accountUnreadDelta = new Map<number, number>()

      for (const update of result.updates) {
        const visibleMessage = messagesById.get(String(update.messageId))
        const shouldCountChange = visibleMessage ? visibleMessage.unread !== !result.isRead : true

        if (!shouldCountChange) continue

        accountUnreadDelta.set(
          update.accountId,
          (accountUnreadDelta.get(update.accountId) ?? 0) + (result.isRead ? -1 : 1)
        )
      }

      setMessages((current) =>
        current.map((message) =>
          succeededIds.has(message.id) ? { ...message, unread: !result.isRead } : message
        )
      )

      if (accountUnreadDelta.size === 0) return

      setAccounts((current) =>
        current.map((account) => {
          if (account.id !== 'all' && !accountUnreadDelta.has(account.accountId ?? -1)) {
            return account
          }

          const delta =
            account.id === 'all'
              ? Array.from(accountUnreadDelta.values()).reduce((sum, value) => sum + value, 0)
              : (accountUnreadDelta.get(account.accountId ?? -1) ?? 0)

          return {
            ...account,
            unread: Math.max(0, account.unread + delta)
          }
        })
      )
    },
    [messagesById, setAccounts]
  )

  const markMessagesRead = React.useCallback(
    async (targetMessages: Message[]): Promise<MessageBulkReadStateResult> => {
      const unreadMessages = targetMessages.filter((message) => message.unread)
      const messageIds = unreadMessages.map((message) => message.messageId)

      setMarkingRead(true)
      setError(null)

      try {
        const result =
          messageIds.length === 0
            ? {
                isRead: true,
                updates: [],
                succeededMessageIds: [],
                failedItems: [],
                updatedCount: 0,
                failedCount: 0
              }
            : await bulkSetMessageReadState(messageIds, true)
        applyReadStateUpdates(result)

        if (result.failedCount > 0) {
          setError(result.failedItems[0]?.error ?? t('mailbox.readStateError'))
        }

        return result
      } finally {
        setMarkingRead(false)
      }
    },
    [applyReadStateUpdates, setError, t]
  )

  const markCurrentQueryRead = React.useCallback(
    async (query: MessageListQuery): Promise<MessageBulkReadStateResult> => {
      setMarkingRead(true)
      setError(null)

      try {
        const result = await markAllMessagesRead(query)
        applyReadStateUpdates(result)

        if (result.failedCount > 0) {
          setError(result.failedItems[0]?.error ?? t('mailbox.readStateError'))
        }

        return result
      } finally {
        setMarkingRead(false)
      }
    },
    [applyReadStateUpdates, setError, t]
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
          setError(getErrorMessage(downloadError, t('mailbox.downloadAttachmentError')))
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
    [downloadingAttachmentIds, reloadMessageDetail, setError, t]
  )

  const selectMessage = React.useCallback((messageId: string): void => {
    setSelectedMessageId(messageId)
  }, [])

  React.useEffect(() => {
    if (!selectedMessage || loading) return

    const timer = window.setTimeout(() => {
      markMessageReadOnOpen(selectedMessage)

      if (!selectedMessage.detailLoaded) {
        if (loadingMessageId !== selectedMessage.id) loadMessageDetail(selectedMessage.id)
        return
      }

      if (shouldAutoLoadBody(selectedMessage) && loadingBodyMessageId !== selectedMessage.id) {
        loadMessageBodyForReader(selectedMessage)
      }
    }, MESSAGE_OPEN_SIDE_EFFECT_DELAY_MS)

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
    markingRead,
    replaceMessages,
    clearMessages,
    removeMessages,
    refreshMessages,
    selectMessage,
    markMessagesRead,
    markCurrentQueryRead,
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
