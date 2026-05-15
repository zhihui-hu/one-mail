import * as React from 'react'
import { MailWarning, Pencil } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { AccountList } from '@renderer/components/account/account-list'
import { AccountWarningDialog } from '@renderer/components/account/account-warning-dialog'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { OutlookImapHelpDialog } from '@renderer/components/account/outlook-imap-help-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { DeleteMessageDialog } from '@renderer/components/mail/delete-message-dialog'
import { MailComposer } from '@renderer/components/mail/mail-composer'
import { MailList } from '@renderer/components/mail/mail-list'
import { MailReader } from '@renderer/components/mail/mail-reader'
import { OutboxPanel } from '@renderer/components/mail/outbox-panel'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResizablePrimitive
} from '@renderer/components/ui/resizable'
import { Button } from '@renderer/components/ui/button'
import type {
  AccountUpdateInput,
  AppSettings,
  SettingsUpdateInput,
  SystemInfo
} from '../../../../shared/types'
import {
  deleteDraftMessage,
  deleteOutboxMessage,
  importSqlBackup,
  loadAccounts,
  loadInitialData,
  loadMessageDetail,
  loadMessages,
  loadOutboxMessages,
  MESSAGE_LIST_PAGE_SIZE,
  onAccountCreated,
  onMailboxChanged,
  openAddAccountWindow,
  reauthorizeAccount,
  removeAccount,
  revealDatabaseInFileManager,
  retryOutboxMessage,
  saveSettings,
  syncAllAccounts,
  syncAccount,
  toMessageQuery,
  updateAccount
} from '@renderer/lib/api'
import type { OutboxMessage } from '@renderer/lib/api'
import { toast } from 'sonner'
import { NoAccountsBody, StatusBar, TitleBar } from './mailbox-chrome'
import {
  createOutlookHelpAccount,
  getErrorMessage,
  getFallbackAccount,
  getNextSelectedAccountId,
  shouldEditCredential,
  shouldShowOutlookImapHelp
} from './mailbox-utils'
import { useMailboxMessages } from './use-mailbox-messages'
import { useMailComposer } from './use-mail-composer'
import { useMessageActions } from './use-message-actions'
import { useMessageSelection } from './use-message-selection'
import { useSyncFeedback } from './use-sync-feedback'

export type DialogKind = 'edit' | 'delete' | 'settings' | null

function normalizeRouteId(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  return decodeURIComponent(text)
}

export function MailboxWorkspace(): React.JSX.Element {
  const navigate = useNavigate()
  const routeParams = useParams<{ accountId?: string; messageId?: string }>()
  const internalRouteRef = React.useRef<string | null>(null)
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [selectedAccountId, setSelectedAccountId] = React.useState('all')
  const [filters, setFilters] = React.useState<MailFilterTag[]>([])
  const [searchKeyword, setSearchKeyword] = React.useState('')
  const [dialogKind, setDialogKind] = React.useState<DialogKind>(null)
  const [dialogAccountId, setDialogAccountId] = React.useState<string | null>(null)
  const [warningAccountId, setWarningAccountId] = React.useState<string | null>(null)
  const [outboxOpen, setOutboxOpen] = React.useState(false)
  const [outboxMessages, setOutboxMessages] = React.useState<OutboxMessage[]>([])
  const [outboxPending, setOutboxPending] = React.useState(false)
  const [outlookImapHelpAccount, setOutlookImapHelpAccount] = React.useState<Account | null>(null)
  const { syncingAccountIds, syncNotice, startSyncing, finishSyncing, setNotice, clearSyncing } =
    useSyncFeedback()
  const [importingSql, setImportingSql] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const {
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
    loadMessageBody,
    downloadMessageAttachment
  } = useMailboxMessages({
    selectedAccountId,
    filters,
    searchKeyword,
    loading,
    setAccounts,
    setError
  })
  const selectionScopeKey = React.useMemo(
    () => `${selectedAccountId}:${filters.join(',')}:${searchKeyword}`,
    [filters, searchKeyword, selectedAccountId]
  )
  const {
    selectedMessageIds,
    selectedMessages,
    allVisibleSelected,
    someVisibleSelected,
    clearSelection,
    selectAllVisible,
    toggleMessageSelection
  } = useMessageSelection({ messages, resetKey: selectionScopeKey })
  const {
    deleteRequest,
    deletingMessageIds,
    deleting,
    requestDeleteMessages,
    cancelDelete,
    confirmDelete
  } = useMessageActions({
    removeMessages,
    clearSelection,
    setError
  })
  const mainLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-main-layout',
    panelIds: ['accounts', 'messages', 'reader']
  })

  const dialogAccount =
    accounts.find((account) => account.id === dialogAccountId) ??
    accounts.find((account) => account.id === selectedAccountId)
  const warningAccount =
    accounts.find((account) => account.id === warningAccountId) ??
    (warningAccountId ? null : undefined)
  const realAccounts = accounts.filter((account) => Boolean(account.accountId))
  const hasAccounts = realAccounts.length > 0
  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ??
    accounts[0] ??
    getFallbackAccount()
  const selectedMessageAccount = selectedMessage
    ? accounts.find((account) => account.accountId === selectedMessage.accountId)
    : undefined
  const showNoAccounts = !loading && !hasAccounts
  const {
    composerOpen,
    composerDraft,
    composerPending,
    openComposer,
    openOutboxDraft,
    closeComposer,
    sendComposerDraft,
    saveComposerDraft
  } = useMailComposer({
    accounts,
    selectedAccount,
    setError
  })
  const routeAccountId = normalizeRouteId(routeParams.accountId)
  const routeMessageId = normalizeRouteId(routeParams.messageId)

  const refreshAccounts = React.useCallback(async () => {
    const nextAccounts = await loadAccounts()
    setAccounts(nextAccounts)
  }, [])

  const refreshOutbox = React.useCallback(async (): Promise<void> => {
    const messages = await loadOutboxMessages()
    setOutboxMessages(messages)
  }, [])

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
          setError(getErrorMessage(loadError, '加载邮箱数据失败。'))
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
    return onMailboxChanged((event) => {
      void refreshVisibleMailbox(event.accountId).catch((refreshError) => {
        setError(getErrorMessage(refreshError, '刷新邮件失败。'))
      })
    })
  }, [refreshVisibleMailbox])

  const openRouteTarget = React.useCallback(
    async (accountId: string, messageId?: string): Promise<void> => {
      setError(null)
      setSelectedAccountId(accountId)
      setFilters([])
      setSearchKeyword('')

      const nextMessages = await loadMessages(
        toMessageQuery(accountId, [], { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 }, '')
      )
      const numericMessageId = messageId ? Number(messageId) : undefined
      const targetMessage =
        numericMessageId !== undefined && Number.isFinite(numericMessageId)
          ? (nextMessages.find((message) => message.messageId === numericMessageId) ??
            (await loadMessageDetail(numericMessageId)))
          : nextMessages[0]
      const visibleMessages =
        targetMessage && !nextMessages.some((message) => message.id === targetMessage.id)
          ? [targetMessage, ...nextMessages]
          : nextMessages

      replaceMessages(visibleMessages)
      if (targetMessage) {
        window.setTimeout(() => selectMessage(targetMessage.id), 0)
      }
    },
    [replaceMessages, selectMessage]
  )

  React.useEffect(() => {
    if (loading || !routeAccountId || !routeMessageId) return
    const currentRoute = toMailboxRoute(routeAccountId, routeMessageId)
    if (internalRouteRef.current === currentRoute) {
      internalRouteRef.current = null
      return
    }
    void openRouteTarget(routeAccountId, routeMessageId).catch((openError) => {
      setError(getErrorMessage(openError, '打开链接对应邮件失败。'))
    })
  }, [loading, openRouteTarget, routeAccountId, routeMessageId])

  React.useEffect(() => {
    if (routeAccountId && routeMessageId) return
    internalRouteRef.current = '/'
    navigate('/', { replace: true })
  }, [navigate, routeAccountId, routeMessageId])

  const syncCreatedAccountInBackground = React.useCallback(
    (accountId: number, accountEmail: string, startedAt: Date): void => {
      const accountKey = String(accountId)
      startSyncing(accountKey, {
        label: accountEmail,
        startedAt,
        message: `${accountEmail} 已保存，正在后台同步...`
      })

      void syncAccount(accountId, 'initial')
        .then(async () => {
          await refreshAccounts()
          await refreshMessages(String(accountId), filters, searchKeyword)
          finishSyncing(accountKey, 'success', {
            label: accountEmail,
            startedAt,
            message: `${accountEmail} 后台同步完成`
          })
        })
        .catch((syncError) => {
          const message = getErrorMessage(syncError, '同步账号失败。')
          const account = accounts.find((item) => item.accountId === accountId)
          if (shouldShowOutlookImapHelp(message, account)) {
            setOutlookImapHelpAccount(account ?? createOutlookHelpAccount(accountId, accountEmail))
          }
          setError(message)
          finishSyncing(accountKey, 'error', {
            label: accountEmail,
            startedAt,
            message: `${accountEmail} 后台同步失败：${message}`
          })
        })
    },
    [
      accounts,
      filters,
      finishSyncing,
      refreshAccounts,
      refreshMessages,
      searchKeyword,
      startSyncing
    ]
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
          setError(getErrorMessage(refreshError, '刷新账号失败。'))
        })

      if (event.requestedSync) {
        syncCreatedAccountInBackground(event.account.accountId, event.account.email, startedAt)
      } else {
        setNotice({
          state: 'success',
          label: event.account.email,
          startedAt,
          finishedAt: new Date(),
          message: `${event.account.email} 已保存`
        })
      }
    })
  }, [filters, refreshMessages, searchKeyword, setNotice, syncCreatedAccountInBackground])

  function handleOpenAddAccountWindow(): void {
    void openAddAccountWindow().catch((openError) => {
      setError(getErrorMessage(openError, '打开添加账号窗口失败。'))
    })
  }

  async function handleUpdateAccount(input: AccountUpdateInput): Promise<void> {
    setError(null)
    const account = await updateAccount(input)
    if (input.password) {
      const startedAt = new Date()
      startSyncing(String(account.accountId), {
        label: account.email,
        startedAt,
        message: `正在同步 ${account.email}...`
      })
      try {
        await syncAccount(account.accountId)
        finishSyncing(String(account.accountId), 'success', {
          label: account.email,
          startedAt,
          message: `${account.email} 同步完成`
        })
      } catch (syncError) {
        const message = getErrorMessage(syncError, '同步账号失败。')
        finishSyncing(String(account.accountId), 'error', {
          label: account.email,
          startedAt,
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
        clearMessages()
      }
    }
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleReauthorizeAccount(account: Account): Promise<void> {
    if (!account.accountId) return

    const startedAt = new Date()
    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: `正在重新授权 ${account.name}...`
    })
    setError(null)

    try {
      const authorizedAccount = await reauthorizeAccount(account.accountId)
      await refreshAccounts()
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message: `${account.name} 授权已更新`
      })
      await handleRefreshAccount({
        ...account,
        status: authorizedAccount.status,
        credentialState: authorizedAccount.credentialState,
        lastError: authorizedAccount.lastError
      })
    } catch (reauthorizeError) {
      const message = getErrorMessage(reauthorizeError, '重新授权失败。')
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message: `${account.name} 重新授权失败：${message}`
      })
      throw reauthorizeError
    }
  }

  async function handleRefreshAccount(account: Account): Promise<void> {
    const startedAt = new Date()
    const syncMessage = account.id === 'all' ? '正在同步全部账号...' : `正在同步 ${account.name}...`

    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: syncMessage
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
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message: account.id === 'all' ? '全部账号同步完成' : `${account.name} 同步完成`
      })
    } catch (refreshError) {
      const message = getErrorMessage(refreshError, '刷新账号失败。')
      if (shouldShowOutlookImapHelp(message, account)) {
        setOutlookImapHelpAccount(account)
      }
      if (shouldEditCredential(message)) {
        setDialogAccountId(account.id)
        setDialogKind('edit')
      }
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message:
          account.id === 'all'
            ? `全部账号同步失败：${message}`
            : `${account.name} 同步失败：${message}`
      })
    } finally {
      clearSyncing(account.id)
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
      setError(getErrorMessage(importError, '导入 SQL 失败。'))
    } finally {
      setImportingSql(false)
    }
  }

  async function handleSaveComposerDraft(
    input: Parameters<typeof saveComposerDraft>[0]
  ): Promise<void> {
    await saveComposerDraft(input)
    await refreshOutbox()
  }

  async function handleRetryOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      const result = await retryOutboxMessage(message.outboxId)
      toast.success(result.warning ? `邮件已发送：${result.warning}` : '邮件已发送')
      await refreshOutbox()
    } catch (retryError) {
      const messageText = getErrorMessage(retryError, '重试发送失败。')
      setError(messageText)
      toast.error(messageText)
      await refreshOutbox()
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleDeleteOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      if (message.status === 'draft') {
        await deleteDraftMessage(message.outboxId)
      } else {
        await deleteOutboxMessage(message.outboxId)
      }
      toast.success('发送记录已删除')
      await refreshOutbox()
    } catch (deleteError) {
      const messageText = getErrorMessage(deleteError, '删除发送记录失败。')
      setError(messageText)
      toast.error(messageText)
    } finally {
      setOutboxPending(false)
    }
  }

  function handleSelectAccount(accountId: string): void {
    if (!accountId) return
    navigateToMailboxRoute()
    setSelectedAccountId(accountId)
    void refreshMessages(accountId, filters, searchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, '刷新邮件失败。'))
    })
  }

  function handleSelectMessage(messageId: string): void {
    selectMessage(messageId)
    navigateToMailboxRoute(selectedAccountId, messageId)
  }

  function navigateToMailboxRoute(accountId?: string, messageId?: string): void {
    const route = toMailboxRoute(accountId, messageId)
    internalRouteRef.current = route
    navigate(route, { replace: false })
  }

  function handleChangeFilters(nextFilters: MailFilterTag[]): void {
    setFilters(nextFilters)
    void refreshMessages(selectedAccountId, nextFilters, searchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, '刷新邮件失败。'))
    })
  }

  function handleChangeSearchKeyword(nextSearchKeyword: string): void {
    setSearchKeyword(nextSearchKeyword)
    void refreshMessages(selectedAccountId, filters, nextSearchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, '搜索邮件失败。'))
    })
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="relative shrink-0">
        <TitleBar
          onAddAccount={handleOpenAddAccountWindow}
          onOpenSettings={() => setDialogKind('settings')}
        />
        <div className="app-no-drag absolute top-1 right-28 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="发送记录"
            disabled={!hasAccounts || outboxPending}
            onClick={() => setOutboxOpen(true)}
          >
            <MailWarning data-icon="inline-start" />
            记录
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="写邮件"
            disabled={!hasAccounts || composerPending}
            onClick={() => {
              void openComposer('new')
            }}
          >
            <Pencil data-icon="inline-start" />
            写信
          </Button>
        </div>
      </div>

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
              onResolveAccountWarning={(account) => {
                setWarningAccountId(account.id)
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
              onLoadMore={loadMoreMessages}
              selectedMessageIds={selectedMessageIds}
              allVisibleSelected={allVisibleSelected}
              someVisibleSelected={someVisibleSelected}
              selectionDisabled={deleting}
              onToggleMessageSelection={toggleMessageSelection}
              onSelectAllVisible={selectAllVisible}
              onClearSelection={clearSelection}
              onDeleteSelected={() => requestDeleteMessages(selectedMessages)}
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
                  actionPending={composerPending}
                  deleting={deletingMessageIds.has(selectedMessage.id)}
                  onLoadBody={() => loadMessageBody(selectedMessage)}
                  onDownloadAttachment={(attachment) => {
                    if (attachment.id !== undefined) {
                      downloadMessageAttachment(selectedMessage, attachment.id)
                    }
                  }}
                  onReply={() => {
                    void openComposer('reply', selectedMessage)
                  }}
                  onReplyAll={() => {
                    void openComposer('reply_all', selectedMessage)
                  }}
                  onForward={() => {
                    void openComposer('forward', selectedMessage)
                  }}
                  onDelete={() => requestDeleteMessages([selectedMessage])}
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
      {warningAccount ? (
        <AccountWarningDialog
          account={warningAccount}
          open={Boolean(warningAccountId)}
          syncing={syncingAccountIds.has(warningAccount.id)}
          onOpenChange={(open) => {
            if (!open) setWarningAccountId(null)
          }}
          onEdit={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('edit')
          }}
          onRetry={(account) => {
            void handleRefreshAccount(account)
          }}
          onDelete={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('delete')
          }}
          onReauthorize={handleReauthorizeAccount}
        />
      ) : null}
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
      <MailComposer
        open={composerOpen}
        accounts={realAccounts}
        draft={composerDraft}
        pending={composerPending}
        onOpenChange={(open) => {
          if (!open) closeComposer()
        }}
        onSend={sendComposerDraft}
        onSaveDraft={handleSaveComposerDraft}
      />
      <OutboxPanel
        open={outboxOpen}
        pending={outboxPending}
        outboxMessages={outboxMessages}
        onOpenChange={setOutboxOpen}
        onRefresh={() => {
          void refreshOutbox().catch((refreshError) => {
            setError(getErrorMessage(refreshError, '加载发送记录失败。'))
          })
        }}
        onOpenDraft={(message) => {
          setOutboxOpen(false)
          openOutboxDraft(message)
        }}
        onRetry={(message) => {
          void handleRetryOutbox(message)
        }}
        onDelete={(message) => {
          void handleDeleteOutbox(message)
        }}
      />
      <DeleteMessageDialog
        open={Boolean(deleteRequest)}
        messages={deleteRequest?.messages ?? []}
        permanent={deleteRequest?.permanent ?? false}
        pending={deleting}
        onOpenChange={(open) => {
          if (!open) cancelDelete()
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </main>
  )
}

function toMailboxRoute(accountId?: string, messageId?: string): string {
  if (!accountId) return '/'
  if (accountId === 'all' && !messageId) return '/'
  return messageId
    ? `/${encodeURIComponent(accountId)}/${encodeURIComponent(messageId)}`
    : `/${encodeURIComponent(accountId)}`
}
