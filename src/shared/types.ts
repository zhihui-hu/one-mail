export type AccountStatus =
  | 'active'
  | 'disabled'
  | 'syncing'
  | 'auth_error'
  | 'sync_error'
  | 'network_error'
export type AuthType = 'oauth2' | 'app_password' | 'password' | 'bridge' | 'manual'
export type ImapSecurity = 'ssl_tls' | 'starttls' | 'none'
export type CredentialState = 'pending' | 'stored' | 'invalid' | 'expired' | 'revoked'
export type OAuthAuthorizationMode = 'internal_browser' | 'copy_link'
export type SyncMode = 'initial' | 'refresh'

export type MailAccount = {
  accountId: number
  providerKey: string
  email: string
  displayName?: string
  accountLabel?: string
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  syncEnabled: boolean
  credentialState: CredentialState
  status: AccountStatus
  lastSyncAt?: string
  lastError?: string
}

export type AccountCreateInput = {
  providerKey: string
  email?: string
  password?: string
  accountLabel?: string
  authType: AuthType
  oauthAuthorizationMode?: OAuthAuthorizationMode
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
}

export type AccountCreatedEvent = {
  account: MailAccount
  requestedSync: boolean
}

export type AccountUpdateInput = Partial<Omit<AccountCreateInput, 'email' | 'password'>> & {
  accountId: number
  displayName?: string
  password?: string
  syncEnabled?: boolean
}

export type MessageFilterTag = 'unread' | 'attachments' | 'starred' | 'today'

export type MessageListQuery = {
  accountId?: number
  folderId?: number
  filters?: MessageFilterTag[]
  keyword?: string
  search?: string
  cursor?: string
  limit?: number
  offset?: number
}

export type MailMessageSummary = {
  messageId: number
  accountId: number
  folderId: number
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  snippet?: string
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  bodyStatus: 'none' | 'loading' | 'ready' | 'error'
  verificationCode?: string
}

export type AccountMailboxStats = {
  accountId: number
  totalCount: number
  unreadCount: number
}

export type MailMessageAttachment = {
  attachmentId: number
  filename: string
  mimeType?: string
  contentDisposition?: 'attachment' | 'inline'
  sizeBytes: number
}

export type AttachmentDownloadResult = {
  downloaded: boolean
  attachmentId: number
  filePath?: string
}

export type MailMessageBody = {
  messageId: number
  bodyText?: string
  bodyHtmlSanitized?: string
  externalImagesBlocked: boolean
}

export type MailMessageBodyLoadResult = {
  body: MailMessageBody | null
  error?: string
}

export type MailMessageDetail = MailMessageSummary & {
  body?: MailMessageBody
  attachments: MailMessageAttachment[]
}

export type MessageReadStateUpdate = {
  messageId: number
  accountId: number
  folderId: number
  isRead: boolean
}

export type SyncStatus = {
  running: boolean
  accountIds: number[]
  lastStartedAt?: string
}

export type MailboxChangedEvent = {
  accountId: number
  reason: 'idle' | 'poll' | 'manual'
  changedAt: string
}

export type NewMailNotificationMessage = {
  messageId: number
  accountId: number
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  snippet?: string
  verificationCode?: string
}

export type NewMailNotification = {
  notificationId: string
  accountId: number
  accountEmail?: string
  accountLabel?: string
  reason: MailboxChangedEvent['reason']
  messageCount: number
  messages: NewMailNotificationMessage[]
  notifiedAt: string
}

export type NotificationStatus = {
  desktopSupported: boolean
}

export type AppSettings = {
  syncIntervalMinutes: number
  syncWindowDays: number
  externalImagesBlocked: boolean
  locale: string
}

export type SettingsUpdateInput = Partial<AppSettings>

export type BackupImportResult = {
  imported: boolean
  filePath?: string
  importedAt?: string
  exportedAt?: number
}

export type SystemInfo = {
  platform: NodeJS.Platform
  appVersion: string
  databasePath: string
  userDataPath: string
}

export type OneMailApi = {
  accounts: {
    list: () => Promise<MailAccount[]>
    create: (input: AccountCreateInput) => Promise<MailAccount>
    onCreated: (callback: (event: AccountCreatedEvent) => void) => () => void
    openAddWindow: () => Promise<boolean>
    closeAddWindow: () => Promise<boolean>
    update: (input: AccountUpdateInput) => Promise<MailAccount>
    disable: (accountId: number) => Promise<MailAccount>
    remove: (accountId: number) => Promise<boolean>
  }
  logos: {
    get: (domain: string) => Promise<string | null>
  }
  messages: {
    list: (query?: MessageListQuery) => Promise<MailMessageSummary[]>
    stats: () => Promise<AccountMailboxStats[]>
    get: (messageId: number) => Promise<MailMessageDetail | null>
    loadBody: (messageId: number) => Promise<MailMessageBodyLoadResult>
    setReadState: (messageId: number, isRead: boolean) => Promise<MessageReadStateUpdate>
    downloadAttachment: (attachmentId: number) => Promise<AttachmentDownloadResult>
  }
  sync: {
    startAll: (mode?: SyncMode) => Promise<SyncStatus>
    startAccount: (accountId: number, mode?: SyncMode) => Promise<SyncStatus>
    status: () => Promise<SyncStatus>
    onMailboxChanged: (callback: (event: MailboxChangedEvent) => void) => () => void
  }
  notifications: {
    status: () => Promise<NotificationStatus>
    onNewMail: (callback: (notification: NewMailNotification) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: SettingsUpdateInput) => Promise<AppSettings>
    exportSql: () => Promise<string | null>
    importSql: () => Promise<BackupImportResult>
  }
  system: {
    info: () => Promise<SystemInfo>
    revealDatabase: () => Promise<boolean>
    revealPath: (path: string) => Promise<boolean>
  }
}
