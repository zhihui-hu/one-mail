import * as React from 'react'
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
  openExternalUrl,
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
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
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
  const { setLocale, t } = useI18n()
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
    saveComposerDraft,
    discardComposerDraft
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
    setLocale(normalizeLocale(data.settings.locale))
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
        setLocale(normalizeLocale(data.settings.locale))
        setSystemInfo(data.systemInfo)
        setSelectedAccountId(data.selectedAccountId)
        replaceMessages(data.messages)
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, t('mailbox.loadDataError')))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [replaceMessages, t])

  React.useEffect(() => {
    return onMailboxChanged((event) => {
      void refreshVisibleMailbox(event.accountId).catch((refreshError) => {
        setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
      })
    })
  }, [refreshVisibleMailbox, t])

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
      setError(getErrorMessage(openError, t('mailbox.openRouteError')))
    })
  }, [loading, openRouteTarget, routeAccountId, routeMessageId, t])

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
        message: t('mailbox.accountSavedSyncing', { email: accountEmail })
      })

      void syncAccount(accountId, 'initial')
        .then(async (syncResult) => {
          await refreshAccounts()
          await refreshMessages(String(accountId), filters, searchKeyword)
          finishSyncing(accountKey, 'success', {
          label: accountEmail,
          startedAt,
          message: t('mailbox.initialSyncComplete', {
            email: accountEmail,
            inserted: syncResult.insertedCount,
            scanned: syncResult.scannedCount
          })
        })
      })
      .catch((syncError) => {
          const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
          const account = accounts.find((item) => item.accountId === accountId)
          if (shouldShowOutlookImapHelp(message, account)) {
            setOutlookImapHelpAccount(account ?? createOutlookHelpAccount(accountId, accountEmail))
          }
          setError(message)
          finishSyncing(accountKey, 'error', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.backgroundSyncFailed', { email: accountEmail, message })
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
      startSyncing,
      t
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
          setError(getErrorMessage(refreshError, t('mailbox.refreshAccountError')))
        })

      if (event.requestedSync) {
        syncCreatedAccountInBackground(event.account.accountId, event.account.email, startedAt)
      } else {
        setNotice({
          state: 'success',
          label: event.account.email,
          startedAt,
          finishedAt: new Date(),
          message: t('mailbox.accountSaved', { email: event.account.email })
        })
      }
    })
  }, [filters, refreshMessages, searchKeyword, setNotice, syncCreatedAccountInBackground, t])

  function handleOpenAddAccountWindow(): void {
    void openAddAccountWindow().catch((openError) => {
      setError(getErrorMessage(openError, t('mailbox.openAddAccountWindowError')))
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
        message: t('mailbox.syncingAccount', { account: account.email })
      })
      try {
        await syncAccount(account.accountId)
        finishSyncing(String(account.accountId), 'success', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncComplete', { account: account.email })
        })
      } catch (syncError) {
        const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
        finishSyncing(String(account.accountId), 'error', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncFailed', { account: account.email, message })
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
      message: t('mailbox.reauthorizing', { account: account.name })
    })
    setError(null)

    try {
      const authorizedAccount = await reauthorizeAccount(account.accountId)
      await refreshAccounts()
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorized', { account: account.name })
      })
      await handleRefreshAccount({
        ...account,
        status: authorizedAccount.status,
        credentialState: authorizedAccount.credentialState,
        lastError: authorizedAccount.lastError
      })
    } catch (reauthorizeError) {
      const message = getErrorMessage(reauthorizeError, t('mailbox.reauthorizeError'))
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorizeFailed', { account: account.name, message })
      })
      throw reauthorizeError
    }
  }

  async function handleRefreshAccount(account: Account): Promise<void> {
    const startedAt = new Date()
    const syncMessage =
      account.id === 'all'
        ? t('mailbox.syncingAll')
        : t('mailbox.syncingAccount', { account: account.name })

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
        message:
          account.id === 'all'
            ? t('mailbox.allSyncComplete')
            : t('mailbox.accountSyncComplete', { account: account.name })
      })
    } catch (refreshError) {
      const message = getErrorMessage(refreshError, t('mailbox.refreshAccountError'))
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
            ? t('mailbox.allSyncFailed', { message })
            : t('mailbox.accountSyncFailed', { account: account.name, message })
      })
    } finally {
      clearSyncing(account.id)
    }
  }

  async function handleUpdateSettings(input: SettingsUpdateInput): Promise<void> {
    const nextSettings = await saveSettings(input)
    setSettings(nextSettings)
    setLocale(normalizeLocale(nextSettings.locale))
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
      setError(getErrorMessage(importError, t('mailbox.importSqlError')))
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

  async function handleDiscardComposerDraft(draftId: number): Promise<void> {
    setError(null)
    try {
      await deleteDraftMessage(draftId)
      discardComposerDraft()
      toast.success(t('mailbox.draftDiscarded'))
      await refreshOutbox()
    } catch (discardError) {
      const messageText = getErrorMessage(discardError, t('mailbox.discardDraftError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function handleRetryOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      const result = await retryOutboxMessage(message.outboxId)
      toast.success(
        result.warning
          ? t('mail.composer.sentWithWarning', { warning: result.warning })
          : t('mail.composer.sent')
      )
      await refreshOutbox()
    } catch (retryError) {
      const messageText = getErrorMessage(retryError, t('mailbox.retrySendError'))
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
      toast.success(t('mailbox.outboxDeleted'))
      await refreshOutbox()
    } catch (deleteError) {
      const messageText = getErrorMessage(deleteError, t('mailbox.deleteOutboxError'))
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
      setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
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
      setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
    })
  }

  function handleChangeSearchKeyword(nextSearchKeyword: string): void {
    setSearchKeyword(nextSearchKeyword)
    void refreshMessages(selectedAccountId, filters, nextSearchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, t('mailbox.searchMailError')))
    })
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="relative shrink-0">
        <TitleBar
          onAddAccount={handleOpenAddAccountWindow}
          onOpenSettings={() => setDialogKind('settings')}
        />
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
              actionsDisabled={!hasAccounts}
              composePending={composerPending}
              outboxPending={outboxPending}
              onSelectAccount={handleSelectAccount}
              onCompose={() => {
                void openComposer('new')
              }}
              onOpenOutbox={() => setOutboxOpen(true)}
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
                  {t('mailbox.selectPreview')}
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
        onOpenVersion={() => {
          void openExternalUrl('https://github.com/zhihui-hu/one-mail')
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
        systemInfo={systemInfo}
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
        onDiscardDraft={handleDiscardComposerDraft}
      />
      <OutboxPanel
        open={outboxOpen}
        pending={outboxPending}
        outboxMessages={outboxMessages}
        onOpenChange={setOutboxOpen}
        onRefresh={() => {
          void refreshOutbox().catch((refreshError) => {
            setError(getErrorMessage(refreshError, t('mailbox.loadOutboxError')))
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
