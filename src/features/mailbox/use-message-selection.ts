import * as React from 'react'

import type { Message } from '@renderer/components/mail/types'

type UseMessageSelectionInput = {
  messages: Message[]
  resetKey: string
}

type SelectionState = {
  scopeKey: string
  selectedMessageIds: Set<string>
  lastSelectedMessageId: string | null
}

export function useMessageSelection({ messages, resetKey }: UseMessageSelectionInput): {
  selectedMessageIds: Set<string>
  selectedMessages: Message[]
  selectedCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  lastSelectedMessageId: string | null
  clearSelection: () => void
  selectAllVisible: () => void
  isMessageSelected: (messageId: string) => boolean
  toggleMessageSelection: (messageId: string, range?: boolean) => void
} {
  const [selection, setSelection] = React.useState<SelectionState>(() => ({
    scopeKey: resetKey,
    selectedMessageIds: new Set(),
    lastSelectedMessageId: null
  }))
  const messageIds = React.useMemo(() => messages.map((message) => message.id), [messages])
  const selectedMessageIds = React.useMemo(() => {
    if (selection.scopeKey !== resetKey) return new Set<string>()
    const visibleIds = new Set(messageIds)
    return new Set(
      [...selection.selectedMessageIds].filter((messageId) => visibleIds.has(messageId))
    )
  }, [messageIds, resetKey, selection.scopeKey, selection.selectedMessageIds])
  const lastSelectedMessageId =
    selection.scopeKey === resetKey ? selection.lastSelectedMessageId : null

  const clearSelection = React.useCallback((): void => {
    setSelection({ scopeKey: resetKey, selectedMessageIds: new Set(), lastSelectedMessageId: null })
  }, [resetKey])

  const selectAllVisible = React.useCallback((): void => {
    setSelection({
      scopeKey: resetKey,
      selectedMessageIds: new Set(messageIds),
      lastSelectedMessageId: messageIds.at(-1) ?? null
    })
  }, [messageIds, resetKey])

  const toggleMessageSelection = React.useCallback(
    (messageId: string, range = false): void => {
      setSelection((current) => {
        const currentIds =
          current.scopeKey === resetKey ? current.selectedMessageIds : new Set<string>()
        const next = new Set(currentIds)
        const currentLastSelectedMessageId =
          current.scopeKey === resetKey ? current.lastSelectedMessageId : null

        if (range && currentLastSelectedMessageId) {
          const startIndex = messageIds.indexOf(currentLastSelectedMessageId)
          const endIndex = messageIds.indexOf(messageId)
          if (startIndex !== -1 && endIndex !== -1) {
            const [from, to] =
              startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
            for (const id of messageIds.slice(from, to + 1)) {
              next.add(id)
            }
            return {
              scopeKey: resetKey,
              selectedMessageIds: next,
              lastSelectedMessageId: messageId
            }
          }
        }

        if (next.has(messageId)) {
          next.delete(messageId)
        } else {
          next.add(messageId)
        }

        return {
          scopeKey: resetKey,
          selectedMessageIds: next,
          lastSelectedMessageId: messageId
        }
      })
    },
    [messageIds, resetKey]
  )

  const isMessageSelected = React.useCallback(
    (messageId: string): boolean => selectedMessageIds.has(messageId),
    [selectedMessageIds]
  )

  const selectedMessages = React.useMemo(
    () => messages.filter((message) => selectedMessageIds.has(message.id)),
    [messages, selectedMessageIds]
  )
  const selectedCount = selectedMessageIds.size
  const allVisibleSelected = messages.length > 0 && selectedCount === messages.length
  const someVisibleSelected = selectedCount > 0 && !allVisibleSelected

  return {
    selectedMessageIds,
    selectedMessages,
    selectedCount,
    allVisibleSelected,
    someVisibleSelected,
    lastSelectedMessageId,
    clearSelection,
    selectAllVisible,
    isMessageSelected,
    toggleMessageSelection
  }
}
