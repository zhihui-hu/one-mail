import type {
  AccountMailboxStats,
  AccountCreatedEvent,
  AccountCreateInput,
  AccountUpdateInput,
  AppSettings,
  BackupImportResult,
  AttachmentDownloadResult,
  MailAccount,
  MailMessageDetail,
  MailMessageBody,
  MailMessageSummary,
  MessageReadStateUpdate,
  MessageFilterTag,
  MessageListQuery,
  MailboxChangedEvent,
  SettingsUpdateInput,
  SyncMode,
  SyncStatus,
  SystemInfo
} from '../../../shared/types'
import { normalizeMailBodyText, normalizeMailDisplayText } from '../../../shared/mail-text'
import type { Account, Message } from '@renderer/components/mail/types'

const platformLabel: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

export const MESSAGE_LIST_PAGE_SIZE = 100

export async function loadInitialData(): Promise<{
  accounts: Account[]
  messages: Message[]
  settings: AppSettings
  systemInfo: SystemInfo
  selectedAccountId: string
}> {
  const [mailAccounts, accountStats, settings, systemInfo] = await Promise.all([
    window.api.accounts.list(),
    window.api.messages.stats(),
    window.api.settings.get(),
    window.api.system.info()
  ])
  const accounts = toAccountList(mailAccounts, accountStats)
  const selectedAccountId = getDefaultSelectedAccountId(accounts)
  const messages = selectedAccountId
    ? await window.api.messages.list(
        toMessageQuery(selectedAccountId, [], { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 })
      )
    : []

  return {
    accounts,
    messages: messages.map(toMessage),
    settings,
    systemInfo,
    selectedAccountId
  }
}

export async function createAccount(input: AccountCreateInput): Promise<MailAccount> {
  return window.api.accounts.create(input)
}

export async function openAddAccountWindow(): Promise<boolean> {
  return window.api.accounts.openAddWindow()
}

export function onAccountCreated(callback: (event: AccountCreatedEvent) => void): () => void {
  const onCreated = window.api?.accounts?.onCreated
  if (typeof onCreated !== 'function') return () => {}

  return onCreated(callback)
}

export async function updateAccount(input: AccountUpdateInput): Promise<MailAccount> {
  return window.api.accounts.update(input)
}

export async function removeAccount(accountId: number): Promise<boolean> {
  return window.api.accounts.remove(accountId)
}

export async function syncAccount(
  accountId: number,
  mode: SyncMode = 'refresh'
): Promise<SyncStatus> {
  const startAccount = window.api?.sync?.startAccount
  if (typeof startAccount !== 'function') {
    throw new Error('同步服务暂不可用，请重启应用后重试。')
  }

  return startAccount(accountId, mode)
}

export async function syncAllAccounts(mode: SyncMode = 'refresh'): Promise<SyncStatus> {
  const startAll = window.api?.sync?.startAll
  if (typeof startAll !== 'function') {
    throw new Error('同步服务暂不可用，请重启应用后重试。')
  }

  return startAll(mode)
}

export function onMailboxChanged(callback: (event: MailboxChangedEvent) => void): () => void {
  const onChanged = window.api?.sync?.onMailboxChanged
  if (typeof onChanged !== 'function') return () => {}

  return onChanged(callback)
}

export async function saveSettings(input: SettingsUpdateInput): Promise<AppSettings> {
  return window.api.settings.update(input)
}

export async function exportSqlBackup(): Promise<string | null> {
  return window.api.settings.exportSql()
}

export async function importSqlBackup(): Promise<BackupImportResult> {
  return window.api.settings.importSql()
}

export async function revealDatabaseInFileManager(): Promise<boolean> {
  return window.api.system.revealDatabase()
}

export async function revealPathInFileManager(path: string): Promise<boolean> {
  return window.api.system.revealPath(path)
}

export async function loadAccounts(): Promise<Account[]> {
  const [accounts, accountStats] = await Promise.all([
    window.api.accounts.list(),
    window.api.messages.stats()
  ])

  return toAccountList(accounts, accountStats)
}

export async function loadMessages(query: MessageListQuery): Promise<Message[]> {
  const messages = await window.api.messages.list(query)
  return messages.map(toMessage)
}

export async function loadMessageDetail(messageId: number): Promise<Message | null> {
  const message = await window.api.messages.get(messageId)
  return message ? toMessage(message) : null
}

export async function loadMessageBody(message: Message): Promise<Message> {
  const result = await window.api.messages.loadBody(message.messageId)
  if (!result.body) {
    return {
      ...message,
      bodyStatus: result.error ? 'error' : message.bodyStatus
    }
  }

  const detail = await window.api.messages.get(message.messageId)
  if (detail) return toMessage(detail)

  return mergeMessageBody(message, result.body)
}

export async function setMessageReadState(
  messageId: number,
  isRead: boolean
): Promise<MessageReadStateUpdate> {
  if (typeof window.api.messages.setReadState === 'function') {
    return window.api.messages.setReadState(messageId, isRead)
  }

  return window.electron.ipcRenderer.invoke(
    'messages/setReadState',
    messageId,
    isRead
  ) as Promise<MessageReadStateUpdate>
}

export async function downloadAttachment(attachmentId: number): Promise<AttachmentDownloadResult> {
  return window.api.messages.downloadAttachment(attachmentId)
}

export function getPlatformName(info?: SystemInfo): string {
  if (!info) return 'Desktop'
  return platformLabel[info.platform] ?? info.platform
}

function toAccountList(accounts: MailAccount[], accountStats: AccountMailboxStats[]): Account[] {
  const statsByAccount = new Map(accountStats.map((stats) => [stats.accountId, stats]))
  const totalUnread = accountStats.reduce((sum, stats) => sum + stats.unreadCount, 0)
  const totalMessages = accountStats.reduce((sum, stats) => sum + stats.totalCount, 0)

  const accountItems = accounts.map((account) => {
    const stats = statsByAccount.get(account.accountId)

    return {
      id: String(account.accountId),
      accountId: account.accountId,
      providerKey: account.providerKey,
      authType: account.authType,
      name: formatAccountName(account),
      address: account.email,
      unread: stats?.unreadCount ?? 0,
      messageCount: stats?.totalCount ?? 0,
      credentialState: account.credentialState,
      status: account.status,
      accent: account.syncEnabled ? 'bg-muted-foreground' : 'bg-muted'
    }
  })

  if (accounts.length <= 2) {
    return accountItems
  }

  return [
    {
      id: 'all',
      providerKey: 'all',
      authType: 'manual',
      name: '全部账号',
      address: '统一收件箱',
      unread: totalUnread,
      messageCount: totalMessages,
      status: accounts.length > 0 ? 'active' : 'empty',
      accent: 'bg-primary'
    },
    ...accountItems
  ]
}

function getDefaultSelectedAccountId(accounts: Account[]): string {
  return accounts.find((account) => account.id === 'all')?.id ?? accounts[0]?.id ?? ''
}

function formatAccountName(account: MailAccount): string {
  const label = account.accountLabel?.trim()
  if (!label || label === account.email) return account.email
  return `${label}(${account.email})`
}

function toMessage(message: MailMessageSummary | MailMessageDetail): Message {
  const detailLoaded = 'attachments' in message
  const body = detailLoaded ? message.body : undefined
  const fromName = normalizeMailDisplayText(message.fromName)
  const fromEmail = normalizeMailDisplayText(message.fromEmail)
  const subject = normalizeMailDisplayText(message.subject) ?? '(无主题)'
  const snippet = normalizeMailDisplayText(message.snippet) ?? ''
  const bodyText = normalizeMailBodyText(body?.bodyText)

  return {
    id: String(message.messageId),
    messageId: message.messageId,
    accountId: message.accountId,
    folderId: message.folderId,
    from: fromName ?? fromEmail ?? '未知发件人',
    fromAddress: fromEmail,
    subject,
    preview: snippet,
    verificationCode: normalizeMailDisplayText(message.verificationCode),
    body: bodyTextToParagraphs(bodyText),
    html: body?.bodyHtmlSanitized,
    bodyStatus: message.bodyStatus,
    bodyLoaded: detailLoaded && message.bodyStatus === 'ready',
    detailLoaded,
    externalImagesBlocked: body?.externalImagesBlocked,
    receivedAt: message.receivedAt,
    time: formatMessageTime(message.receivedAt),
    dateLabel: formatMessageDate(message.receivedAt),
    unread: !message.isRead,
    starred: message.isStarred,
    attachments:
      'attachments' in message
        ? message.attachments
            .filter((attachment) => attachment.filename.trim() && attachment.sizeBytes > 0)
            .map((attachment) => ({
              id: attachment.attachmentId,
              name: normalizeMailDisplayText(attachment.filename) ?? attachment.filename,
              size: formatBytes(attachment.sizeBytes),
              type: attachment.mimeType ?? '附件',
              disposition: attachment.contentDisposition
            }))
        : message.hasAttachments
          ? [{ name: '附件元数据', size: '待加载', type: '附件' }]
          : []
  }
}

function mergeMessageBody(message: Message, body: MailMessageBody): Message {
  const bodyText = normalizeMailBodyText(body.bodyText)

  return {
    ...message,
    body: bodyTextToParagraphs(bodyText),
    html: body.bodyHtmlSanitized,
    bodyStatus: 'ready',
    bodyLoaded: true,
    detailLoaded: true,
    externalImagesBlocked: body.externalImagesBlocked
  }
}

function bodyTextToParagraphs(value?: string): string[] {
  if (!value) return ['邮件正文尚未加载。']
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function formatBytes(value: number): string {
  if (!value) return '未知大小'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatMessageTime(value?: string): string {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function formatMessageDate(value?: string): string {
  if (!value) return '未知日期'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知日期'

  const today = new Date()
  if (date.toDateString() === today.toDateString()) return '今天'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function toMessageQuery(
  selectedAccountId: string,
  filters: MessageFilterTag[],
  pagination?: Pick<MessageListQuery, 'limit' | 'offset'>,
  searchKeyword?: string
): MessageListQuery {
  const keyword = searchKeyword?.trim()

  return {
    accountId: selectedAccountId === 'all' ? undefined : Number(selectedAccountId),
    filters,
    keyword: keyword || undefined,
    limit: pagination?.limit ?? MESSAGE_LIST_PAGE_SIZE,
    offset: pagination?.offset ?? 0
  }
}
