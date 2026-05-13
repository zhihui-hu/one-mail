import * as React from 'react'
import { AccountList } from '@renderer/components/account/account-list'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { OutlookImapHelpDialog } from '@renderer/components/account/outlook-imap-help-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { MailList } from '@renderer/components/mail/mail-list'
import { MailReader } from '@renderer/components/mail/mail-reader'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import { ThemeToggleButton } from '@renderer/components/theme/theme-toggle-button'
import { Button } from '@renderer/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResizablePrimitive
} from '@renderer/components/ui/resizable'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { Inbox, Plus, Settings, Upload } from 'lucide-react'
import type {
  AccountUpdateInput,
  AppSettings,
  SettingsUpdateInput,
  SystemInfo
} from '../../../../shared/types'
import {
  downloadAttachment,
  importSqlBackup,
  loadAccounts,
  loadInitialData,
  loadMessageBody,
  loadMessageDetail,
  loadMessages,
  MESSAGE_LIST_PAGE_SIZE,
  onAccountCreated,
  openAddAccountWindow,
  removeAccount,
  revealDatabaseInFileManager,
  saveSettings,
  setMessageReadState,
  syncAllAccounts,
  syncAccount,
  toMessageQuery,
  updateAccount
} from '@renderer/lib/api'
import { isVerificationMailCandidate } from '../../../../shared/verification-code'

export type DialogKind = 'edit' | 'delete' | 'settings' | null

type SyncNotice = {
  state: 'idle' | 'running' | 'success' | 'error'
  label: string
  startedAt?: Date
  finishedAt?: Date
  message?: string
}

type MessageListPageState = {
  hasMore: boolean
  loadingMore: boolean
}

export function AppShell(): React.JSX.Element {
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [messages, setMessages] = React.useState<Message[]>([])
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [selectedAccountId, setSelectedAccountId] = React.useState('all')
  const [selectedMessageId, setSelectedMessageId] = React.useState('')
  const [filters, setFilters] = React.useState<MailFilterTag[]>([])
  const [searchKeyword, setSearchKeyword] = React.useState('')
  const [dialogKind, setDialogKind] = React.useState<DialogKind>(null)
  const [dialogAccountId, setDialogAccountId] = React.useState<string | null>(null)
  const [outlookImapHelpAccount, setOutlookImapHelpAccount] = React.useState<Account | null>(null)
  const [syncingAccountIds, setSyncingAccountIds] = React.useState<Set<string>>(() => new Set())
  const [syncNotice, setSyncNotice] = React.useState<SyncNotice>({ state: 'idle', label: '' })
  const [messagePage, setMessagePage] = React.useState<MessageListPageState>({
    hasMore: false,
    loadingMore: false
  })
  const [loadingMessageId, setLoadingMessageId] = React.useState<string | null>(null)
  const [loadingBodyMessageId, setLoadingBodyMessageId] = React.useState<string | null>(null)
  const loadingMoreMessagesRef = React.useRef(false)
  const loadMoreRequestTokenRef = React.useRef(0)
  const messageListScopeRef = React.useRef('')
  const markingReadMessageIdsRef = React.useRef<Set<string>>(new Set())
  const prefetchingVerificationMessageIdsRef = React.useRef<Set<string>>(new Set())
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const [importingSql, setImportingSql] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const mainLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-main-layout',
    panelIds: ['accounts', 'messages', 'reader']
  })

  const dialogAccount =
    accounts.find((account) => account.id === dialogAccountId) ??
    accounts.find((account) => account.id === selectedAccountId)
  const realAccounts = accounts.filter((account) => Boolean(account.accountId))
  const hasAccounts = realAccounts.length > 0
  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ??
    accounts[0] ??
    getFallbackAccount()
  const selectedMessage = messages.find((message) => message.id === selectedMessageId)
  const selectedMessageAccount = selectedMessage
    ? accounts.find((account) => account.accountId === selectedMessage.accountId)
    : undefined
  const showNoAccounts = !loading && !hasAccounts

  const replaceMessages = React.useCallback((nextMessages: Message[]): void => {
    loadMoreRequestTokenRef.current += 1
    loadingMoreMessagesRef.current = false
    setMessages(nextMessages)
    setMessagePage({
      hasMore: nextMessages.length === MESSAGE_LIST_PAGE_SIZE,
      loadingMore: false
    })
    setSelectedMessageId((current) => {
      if (nextMessages.some((message) => message.id === current)) return current
      return nextMessages[0]?.id ?? ''
    })
  }, [])

  React.useEffect(() => {
    messageListScopeRef.current = getMessageListScopeKey(selectedAccountId, filters, searchKeyword)
  }, [filters, searchKeyword, selectedAccountId])

  const refreshAccounts = React.useCallback(async () => {
    const nextAccounts = await loadAccounts()
    setAccounts(nextAccounts)
  }, [])

  const refreshMessages = React.useCallback(
    async (accountId: string, nextFilters: MailFilterTag[], nextSearchKeyword: string) => {
      if (!accountId) {
        setMessages([])
        setSelectedMessageId('')
        setMessagePage({ hasMore: false, loadingMore: false })
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
    [replaceMessages]
  )

  const refreshVisibleMailbox = React.useCallback(
    async (changedAccountId: number): Promise<void> => {
      const currentAccountId = selectedAccountId
      const shouldRefreshMessages =
        currentAccountId === 'all' || currentAccountId === String(changedAccountId)

      const refreshedAccounts = loadAccounts()
      const refreshedMessages = shouldRefreshMessages
        ? loadMessages(
            toMessageQuery(
              currentAccountId,
              filters,
              { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 },
              searchKeyword
            )
          )
        : Promise.resolve<Message[] | null>(null)
      const [nextAccounts, nextMessages] = await Promise.all([refreshedAccounts, refreshedMessages])

      setAccounts(nextAccounts)

      if (nextMessages) {
        replaceMessages(nextMessages)
      }
    },
    [filters, replaceMessages, searchKeyword, selectedAccountId]
  )

  const reloadInitialData = React.useCallback(async () => {
    const data = await loadInitialData()
    setAccounts(data.accounts)
    setSettings(data.settings)
    setSystemInfo(data.systemInfo)
    setSelectedAccountId(data.selectedAccountId)
    replaceMessages(data.messages)
  }, [replaceMessages])

  React.useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        setLoading(true)
        setError(null)
        const data = await loadInitialData()
        if (cancelled) return
        setAccounts(data.accounts)
        setSettings(data.settings)
        setSystemInfo(data.systemInfo)
        setSelectedAccountId(data.selectedAccountId)
        replaceMessages(data.messages)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载邮箱数据失败。')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [replaceMessages])

  React.useEffect(() => {
    return window.api.sync.onMailboxChanged((event) => {
      void refreshVisibleMailbox(event.accountId).catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : '刷新邮件失败。')
      })
    })
  }, [refreshVisibleMailbox])

  const syncCreatedAccountInBackground = React.useCallback(
    (accountId: number, accountEmail: string, startedAt: Date): void => {
      const accountKey = String(accountId)
      setSyncingAccountIds((current) => new Set(current).add(accountKey))

      void syncAccount(accountId, 'initial')
        .then(async () => {
          await refreshAccounts()
          await refreshMessages(String(accountId), filters, searchKeyword)
          setSyncNotice({
            state: 'success',
            label: accountEmail,
            startedAt,
            finishedAt: new Date(),
            message: `${accountEmail} 后台同步完成`
          })
        })
        .catch((syncError) => {
          const message = syncError instanceof Error ? syncError.message : '同步账号失败。'
          const account = accounts.find((item) => item.accountId === accountId)
          if (shouldShowOutlookImapHelp(message, account)) {
            setOutlookImapHelpAccount(account ?? createOutlookHelpAccount(accountId, accountEmail))
          }
          setError(message)
          setSyncNotice({
            state: 'error',
            label: accountEmail,
            startedAt,
            finishedAt: new Date(),
            message: `${accountEmail} 后台同步失败：${message}`
          })
        })
        .finally(() => {
          setSyncingAccountIds((current) => {
            const next = new Set(current)
            next.delete(accountKey)
            return next
          })
        })
    },
    [accounts, filters, refreshAccounts, refreshMessages, searchKeyword]
  )

  React.useEffect(() => {
    return onAccountCreated((event) => {
      const startedAt = new Date()
      const nextSelectedAccountId = String(event.account.accountId)

      setError(null)
      void loadAccounts()
        .then(async (nextAccounts) => {
          setAccounts(nextAccounts)
          setSelectedAccountId(nextSelectedAccountId)
          await refreshMessages(nextSelectedAccountId, filters, searchKeyword)
        })
        .catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : '刷新账号失败。')
        })

      if (event.requestedSync) {
        setSyncNotice({
          state: 'running',
          label: event.account.email,
          startedAt,
          message: `${event.account.email} 已保存，正在后台同步...`
        })
        syncCreatedAccountInBackground(event.account.accountId, event.account.email, startedAt)
      } else {
        setSyncNotice({
          state: 'success',
          label: event.account.email,
          startedAt,
          finishedAt: new Date(),
          message: `${event.account.email} 已保存`
        })
      }
    })
  }, [filters, refreshMessages, searchKeyword, syncCreatedAccountInBackground])

  function handleOpenAddAccountWindow(): void {
    void openAddAccountWindow().catch((openError) => {
      setError(openError instanceof Error ? openError.message : '打开添加账号窗口失败。')
    })
  }

  async function handleUpdateAccount(input: AccountUpdateInput): Promise<void> {
    setError(null)
    const account = await updateAccount(input)
    if (input.password) {
      const startedAt = new Date()
      setSyncNotice({
        state: 'running',
        label: account.email,
        startedAt,
        message: `正在同步 ${account.email}...`
      })
      try {
        await syncAccount(account.accountId)
        setSyncNotice({
          state: 'success',
          label: account.email,
          startedAt,
          finishedAt: new Date(),
          message: `${account.email} 同步完成`
        })
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : '同步账号失败。'
        setSyncNotice({
          state: 'error',
          label: account.email,
          startedAt,
          finishedAt: new Date(),
          message: `${account.email} 同步失败：${message}`
        })
        throw syncError
      }
    }
    await refreshAccounts()
    await refreshMessages(String(account.accountId), filters, searchKeyword)
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleRemoveAccount(account: Account): Promise<void> {
    if (!account.accountId) return
    setError(null)
    await removeAccount(account.accountId)
    const nextAccounts = await loadAccounts()
    const nextSelectedAccountId = getNextSelectedAccountId(
      nextAccounts,
      account.id,
      selectedAccountId
    )
    setAccounts(nextAccounts)
    if (
      selectedAccountId === account.id ||
      !nextAccounts.some((item) => item.id === selectedAccountId)
    ) {
      setSelectedAccountId(nextSelectedAccountId)
      if (nextSelectedAccountId) {
        await refreshMessages(nextSelectedAccountId, filters, searchKeyword)
      } else {
        setMessages([])
        setSelectedMessageId('')
      }
    }
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleRefreshAccount(account: Account): Promise<void> {
    const startedAt = new Date()

    setSyncingAccountIds((current) => new Set(current).add(account.id))
    setSyncNotice({
      state: 'running',
      label: account.name,
      startedAt,
      message: account.id === 'all' ? '正在同步全部账号...' : `正在同步 ${account.name}...`
    })
    setError(null)

    try {
      if (account.accountId) {
        await syncAccount(account.accountId)
      } else if (account.id === 'all') {
        await syncAllAccounts()
      } else {
        return
      }
      await refreshAccounts()
      await refreshMessages(selectedAccountId, filters, searchKeyword)
      setSyncNotice({
        state: 'success',
        label: account.name,
        startedAt,
        finishedAt: new Date(),
        message: account.id === 'all' ? '全部账号同步完成' : `${account.name} 同步完成`
      })
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : '刷新账号失败。'
      if (shouldShowOutlookImapHelp(message, account)) {
        setOutlookImapHelpAccount(account)
      }
      if (shouldEditCredential(message)) {
        setDialogAccountId(account.id)
        setDialogKind('edit')
      }
      setError(message)
      setSyncNotice({
        state: 'error',
        label: account.name,
        startedAt,
        finishedAt: new Date(),
        message:
          account.id === 'all'
            ? `全部账号同步失败：${message}`
            : `${account.name} 同步失败：${message}`
      })
    } finally {
      setSyncingAccountIds((current) => {
        const next = new Set(current)
        next.delete(account.id)
        return next
      })
    }
  }

  async function handleUpdateSettings(input: SettingsUpdateInput): Promise<void> {
    const nextSettings = await saveSettings(input)
    setSettings(nextSettings)
  }

  async function handleImportSqlBackup(): Promise<void> {
    if (importingSql) return

    setImportingSql(true)
    setError(null)

    try {
      const result = await importSqlBackup()
      if (result.imported) {
        await reloadInitialData()
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入 SQL 失败。')
    } finally {
      setImportingSql(false)
    }
  }

  function handleSelectAccount(accountId: string): void {
    if (!accountId) return
    setSelectedAccountId(accountId)
    void refreshMessages(accountId, filters, searchKeyword).catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : '刷新邮件失败。')
    })
  }

  function handleChangeFilters(nextFilters: MailFilterTag[]): void {
    setFilters(nextFilters)
    void refreshMessages(selectedAccountId, nextFilters, searchKeyword).catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : '刷新邮件失败。')
    })
  }

  function handleChangeSearchKeyword(nextSearchKeyword: string): void {
    setSearchKeyword(nextSearchKeyword)
    void refreshMessages(selectedAccountId, filters, nextSearchKeyword).catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : '搜索邮件失败。')
    })
  }

  const handleLoadMoreMessages = React.useCallback((): void => {
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
        setError(loadError instanceof Error ? loadError.message : '加载更多邮件失败。')
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
    selectedAccountId
  ])

  const handleLoadMessageDetail = React.useCallback((messageId: string): void => {
    setLoadingMessageId(messageId)

    void loadMessageDetail(Number(messageId))
      .then((detail) => {
        if (!detail) return
        setMessages((current) =>
          current.map((message) => (message.id === messageId ? { ...message, ...detail } : message))
        )
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : '加载邮件详情失败。')
      })
      .finally(() => {
        setLoadingMessageId((current) => (current === messageId ? null : current))
      })
  }, [])

  const handleLoadMessageBody = React.useCallback(
    (message: Message): void => {
      if (loadingBodyMessageId === message.id) return
      setLoadingBodyMessageId(message.id)

      void loadMessageBody(message)
        .then((detail) => {
          setMessages((current) =>
            current.map((item) => (item.id === message.id ? { ...item, ...detail } : item))
          )
        })
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : '加载邮件正文失败。')
        })
        .finally(() => {
          setLoadingBodyMessageId((current) => (current === message.id ? null : current))
        })
    },
    [loadingBodyMessageId]
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
      prefetchingVerificationMessageIdsRef.current.add(message.id)

      void loadMessageBody(message)
        .then((detail) => {
          setMessages((current) =>
            current.map((item) => (item.id === message.id ? { ...item, ...detail } : item))
          )
        })
        .catch(() => undefined)
        .finally(() => {
          prefetchingVerificationMessageIdsRef.current.delete(message.id)
        })
    }
  }, [messages])

  const handleDownloadAttachment = React.useCallback(
    (message: Message, attachmentId: number): void => {
      if (downloadingAttachmentIds.has(attachmentId)) return

      setDownloadingAttachmentIds((current) => new Set(current).add(attachmentId))
      setError(null)

      void downloadAttachment(attachmentId)
        .then(async (result) => {
          if (!result.downloaded) return

          const detail = await loadMessageDetail(message.messageId)
          if (!detail) return

          setMessages((current) =>
            current.map((item) => (item.id === message.id ? { ...item, ...detail } : item))
          )
        })
        .catch((downloadError) => {
          setError(downloadError instanceof Error ? downloadError.message : '下载附件失败。')
          void loadMessageDetail(message.messageId).then((detail) => {
            if (!detail) return
            setMessages((current) =>
              current.map((item) => (item.id === message.id ? { ...item, ...detail } : item))
            )
          })
        })
        .finally(() => {
          setDownloadingAttachmentIds((current) => {
            const next = new Set(current)
            next.delete(attachmentId)
            return next
          })
        })
    },
    [downloadingAttachmentIds]
  )

  const markMessageReadOnOpen = React.useCallback((message: Message): void => {
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
        setError(readStateError instanceof Error ? readStateError.message : '同步已读状态失败。')
      })
      .finally(() => {
        markingReadMessageIdsRef.current.delete(message.id)
      })
  }, [])

  function handleSelectMessage(messageId: string): void {
    setSelectedMessageId(messageId)
    const message = messages.find((item) => item.id === messageId)
    if (message) markMessageReadOnOpen(message)
    handleLoadMessageDetail(messageId)
  }

  React.useEffect(() => {
    if (!selectedMessage || loading) return

    markMessageReadOnOpen(selectedMessage)

    const timer = window.setTimeout(() => {
      if (!selectedMessage.detailLoaded) {
        if (loadingMessageId !== selectedMessage.id) handleLoadMessageDetail(selectedMessage.id)
        return
      }

      if (shouldAutoLoadBody(selectedMessage) && loadingBodyMessageId !== selectedMessage.id) {
        handleLoadMessageBody(selectedMessage)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    handleLoadMessageBody,
    handleLoadMessageDetail,
    loading,
    loadingBodyMessageId,
    loadingMessageId,
    markMessageReadOnOpen,
    selectedMessage
  ])

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar
        onAddAccount={handleOpenAddAccountWindow}
        onOpenSettings={() => setDialogKind('settings')}
      />

      {showNoAccounts ? (
        <NoAccountsBody
          importingSql={importingSql}
          onAddAccount={handleOpenAddAccountWindow}
          onImportSql={() => {
            void handleImportSqlBackup()
          }}
        />
      ) : (
        <ResizablePanelGroup
          id="onemail-main-layout"
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="accounts"
            defaultSize="292px"
            minSize="220px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <AccountList
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              syncingAccountIds={syncingAccountIds}
              onSelectAccount={handleSelectAccount}
              onRefreshAccount={(account) => {
                void handleRefreshAccount(account)
              }}
              onEditAccount={(account) => {
                setDialogAccountId(account.id)
                setDialogKind('edit')
              }}
              onDeleteAccount={(account) => {
                setDialogAccountId(account.id)
                setDialogKind('delete')
              }}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel
            id="messages"
            defaultSize="420px"
            minSize="320px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <MailList
              account={selectedAccount}
              messages={messages}
              selectedMessageId={selectedMessageId}
              filters={filters}
              searchKeyword={searchKeyword}
              loading={loading}
              loadingMore={messagePage.loadingMore}
              hasMore={messagePage.hasMore}
              error={error}
              onSelectMessage={handleSelectMessage}
              onChangeFilters={handleChangeFilters}
              onChangeSearchKeyword={handleChangeSearchKeyword}
              onLoadMore={handleLoadMoreMessages}
            />
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel id="reader" minSize="420px">
            <article className="flex h-full min-h-0 min-w-0 flex-col overflow-auto">
              {selectedMessage ? (
                <MailReader
                  message={selectedMessage}
                  recipientAddress={selectedMessageAccount?.address ?? selectedAccount.address}
                  loading={loadingMessageId === selectedMessage.id}
                  loadingBody={loadingBodyMessageId === selectedMessage.id}
                  downloadingAttachmentIds={downloadingAttachmentIds}
                  onLoadBody={() => handleLoadMessageBody(selectedMessage)}
                  onDownloadAttachment={(attachment) => {
                    if (attachment.id !== undefined) {
                      handleDownloadAttachment(selectedMessage, attachment.id)
                    }
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-xs text-muted-foreground">
                  选择一封邮件进行预览。
                </div>
              )}
            </article>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <StatusBar
        systemInfo={systemInfo}
        settings={settings}
        accountCount={realAccounts.length}
        messageCount={selectedAccount.messageCount ?? messages.length}
        syncNotice={syncNotice}
        onRevealDatabase={() => {
          void revealDatabaseInFileManager()
        }}
      />

      <EditAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'edit'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'edit' : null)
          if (!open) setDialogAccountId(null)
        }}
        onSubmit={handleUpdateAccount}
      />
      <RemoveAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'delete'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'delete' : null)
          if (!open) setDialogAccountId(null)
        }}
        onConfirm={handleRemoveAccount}
      />
      <SettingsDialog
        open={dialogKind === 'settings'}
        settings={settings}
        onOpenChange={(open) => setDialogKind(open ? 'settings' : null)}
        onSubmit={handleUpdateSettings}
        onImported={reloadInitialData}
      />
      <OutlookImapHelpDialog
        accountLabel={outlookImapHelpAccount?.name}
        open={Boolean(outlookImapHelpAccount)}
        onOpenChange={(open) => {
          if (!open) setOutlookImapHelpAccount(null)
        }}
      />
    </main>
  )
}

function shouldShowOutlookImapHelp(message: string, account?: Account | null): boolean {
  if (account?.providerKey && normalizeProviderKey(account.providerKey) !== 'outlook') return false
  return /IMAP OAuth 登录认证失败|AUTHENTICATE failed/i.test(message)
}

function normalizeProviderKey(providerKey: string): string {
  const normalized = providerKey.toLowerCase()
  if (normalized.includes('outlook') || normalized.includes('microsoft')) return 'outlook'
  return normalized
}

function createOutlookHelpAccount(accountId: number, email: string): Account {
  return {
    id: String(accountId),
    accountId,
    providerKey: 'outlook',
    name: email,
    address: email,
    unread: 0,
    status: 'auth_error',
    accent: 'bg-muted-foreground'
  }
}

function shouldEditCredential(message: string): boolean {
  return /凭据不存在|凭据格式无效|凭据解密失败|重新保存密码/.test(message)
}

function shouldAutoLoadBody(message: Message): boolean {
  if (message.bodyLoaded) return false
  return message.bodyStatus !== 'error'
}

function getNextSelectedAccountId(
  accounts: Account[],
  removedAccountId: string,
  currentAccountId: string
): string {
  if (accounts.length === 0) return ''
  if (
    currentAccountId !== removedAccountId &&
    accounts.some((account) => account.id === currentAccountId)
  ) {
    return currentAccountId
  }
  return accounts.find((account) => account.id === 'all')?.id ?? accounts[0]?.id ?? ''
}

function decrementUnreadCount(accounts: Account[], accountId: number): Account[] {
  return accounts.map((account) => {
    if (account.id !== 'all' && account.accountId !== accountId) return account
    return {
      ...account,
      unread: Math.max(0, account.unread - 1)
    }
  })
}

function mergeMessagesById(current: Message[], nextMessages: Message[]): Message[] {
  const existingIds = new Set(current.map((message) => message.id))
  const uniqueNextMessages = nextMessages.filter((message) => !existingIds.has(message.id))
  return [...current, ...uniqueNextMessages]
}

function getMessageListScopeKey(
  accountId: string,
  filters: MailFilterTag[],
  searchKeyword: string
): string {
  return `${accountId}:${[...filters].sort().join(',')}:${searchKeyword.trim()}`
}

function NoAccountsBody({
  importingSql,
  onAddAccount,
  onImportSql
}: {
  importingSql: boolean
  onAddAccount: () => void
  onImportSql: () => void
}): React.JSX.Element {
  return (
    <Empty className="min-h-0 flex-1 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>还没有邮箱账号</EmptyTitle>
        <EmptyDescription>添加账号后即可开始同步邮件。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAddAccount}>
          <Plus data-icon="inline-start" />
          添加账号
        </Button>
        <Button variant="outline" onClick={onImportSql} disabled={importingSql}>
          <Upload data-icon="inline-start" />
          {importingSql ? '导入中...' : '导入 SQL'}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function TitleBar({
  onAddAccount,
  onOpenSettings
}: {
  onAddAccount: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <header className="app-drag-region flex h-10 shrink-0 items-center justify-end border-b bg-card/60 px-5 pl-24">
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="添加账号" onClick={onAddAccount}>
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">添加账号</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="设置" onClick={onOpenSettings}>
                <Settings aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">设置</TooltipContent>
          </Tooltip>
          <ThemeToggleButton />
        </div>
      </TooltipProvider>
    </header>
  )
}

function StatusBar({
  systemInfo,
  settings,
  accountCount,
  messageCount,
  syncNotice,
  onRevealDatabase
}: {
  systemInfo: SystemInfo | null
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  syncNotice: SyncNotice
  onRevealDatabase: () => void
}): React.JSX.Element {
  const syncText = formatSyncNotice(syncNotice)
  const databasePath = systemInfo?.databasePath
  const databaseLabel = databasePath ? getFileName(databasePath) : '加载中...'

  return (
    <footer className="app-drag-region flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
      <button
        type="button"
        className="app-no-drag flex w-72 shrink-0 items-center gap-1 overflow-hidden text-left outline-none transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
        onClick={onRevealDatabase}
        title={databasePath}
        aria-label={databasePath ? `打开数据库文件夹：${databaseLabel}` : '数据库加载中'}
        disabled={!databasePath}
      >
        <span className="shrink-0">数据库：</span>
        <span className="min-w-0 truncate">{databaseLabel}</span>
      </button>
      <div className="app-no-drag flex shrink-0 items-center gap-2">
        {syncText ? (
          <span className="max-w-80 truncate text-foreground" title={syncText}>
            {syncText}
          </span>
        ) : null}
        <span>{accountCount} 个账号</span>
        <span>{messageCount} 封邮件</span>
        <span>{settings?.syncWindowDays ?? 90} 天缓存</span>
        <span>v{systemInfo?.appVersion ?? '...'}</span>
      </div>
    </footer>
  )
}

function formatSyncNotice(notice: SyncNotice): string {
  if (notice.state === 'idle') return ''
  if (notice.state === 'running') return notice.message ?? '正在同步...'

  const message = notice.message ?? (notice.state === 'success' ? '同步完成' : '同步失败')
  const elapsedSeconds =
    notice.startedAt && notice.finishedAt
      ? Math.max(1, Math.round((notice.finishedAt.getTime() - notice.startedAt.getTime()) / 1000))
      : undefined

  return elapsedSeconds ? `${message}，耗时 ${elapsedSeconds} 秒` : message
}

function getFileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

function getFallbackAccount(): Account {
  return {
    id: '',
    name: '暂无账号',
    address: '',
    unread: 0,
    messageCount: 0,
    status: 'empty',
    accent: 'bg-primary'
  }
}
