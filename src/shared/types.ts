export type AccountStatus =
  | 'active'
  | 'disabled'
  | 'syncing'
  | 'auth_error'
  | 'sync_error'
  | 'network_error'
export type AuthType = 'oauth2' | 'app_password' | 'password' | 'bridge' | 'manual'
export type ImapSecurity = 'ssl_tls' | 'starttls' | 'none'
export type SmtpSecurity = 'ssl_tls' | 'starttls' | 'none'
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
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled: boolean
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
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled?: boolean
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

export type MessageFilterTag = 'unread' | 'starred' | 'today' | 'yesterday' | 'last7'

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
  folderRole?: string
  folderName?: string
  subject?: string
  fromName?: string
  fromEmail?: string
  to?: string
  cc?: string
  replyTo?: string
  messageRfc822Id?: string
  references?: string
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

export type MailAddressInput = {
  name?: string
  email: string
}

export type MailComposeMode = 'new' | 'reply' | 'reply_all' | 'forward'

export type MailAttachmentInput = {
  filePath?: string
  filename?: string
  mimeType?: string
  sizeBytes?: number
  sourceMessageId?: number
  sourceAttachmentId?: number
}

export type MailSendInput = {
  outboxId?: number
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc?: MailAddressInput[]
  bcc?: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  attachments?: MailAttachmentInput[]
  inReplyTo?: string
  referencesHeader?: string
}

export type MailSendResult = {
  outboxId: number
  accountId: number
  status: OutboxMessage['status']
  rfc822MessageId: string
  sentAt?: string
  warning?: string
  error?: string
}

export type ReplyDraftInput = {
  messageId: number
  mode: Extract<MailComposeMode, 'reply' | 'reply_all'>
}

export type ForwardDraftInput = {
  messageId: number
}

export type ForwardAttachmentCandidate = {
  attachmentId: number
  filename: string
  mimeType?: string
  sizeBytes: number
  selected: boolean
}

export type ComposeDraft = {
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  forwardAttachments?: ForwardAttachmentCandidate[]
}

export type OutboxMessage = {
  outboxId: number
  accountId: number
  relatedMessageId?: number
  composeKind: MailComposeMode
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'deleted'
  rfc822MessageId: string
  from?: MailAddressInput
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  attachments?: MailAttachmentInput[]
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  sentAt?: string
  deletedAt?: string
  lastError?: string
  lastWarning?: string
  createdAt: string
  updatedAt: string
}

export type OutboxListQuery = {
  statuses?: OutboxMessage['status'][]
  limit?: number
}

export type MessageDeleteMode = 'trash' | 'permanent' | 'local_hide'

export type MessageDeleteInput = {
  messageId: number
  mode?: MessageDeleteMode
  allowLocalHide?: boolean
}

export type MessageDeleteResult = {
  messageId: number
  accountId?: number
  mode: MessageDeleteMode
  deleted: boolean
  localOnly: boolean
  error?: string
}

export type MessageBulkDeleteInput = {
  messageIds: number[]
  mode?: MessageDeleteMode
  allowLocalHide?: boolean
}

export type MessageBulkDeleteFailure = {
  messageId: number
  accountId?: number
  error: string
}

export type MessageBulkDeleteResult = {
  mode: MessageDeleteMode
  succeededMessageIds: number[]
  failedItems: MessageBulkDeleteFailure[]
  deletedCount: number
  failedCount: number
  operationBatchId?: string
}

export type MessageRestoreResult = {
  messageId: number
  accountId?: number
  restored: boolean
  localOnly: boolean
  error?: string
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

export type AccountSyncRunResult = SyncStatus & {
  accountId: number
  scannedCount: number
  insertedCount: number
  updatedCount: number
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
  openAtLogin: boolean
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

export type AppUpdateCheckResult = {
  status: 'unsupported' | 'available' | 'not_available' | 'error'
  currentVersion: string
  latestVersion?: string
  message: string
}

export type OneMailApi = {
  accounts: {
    list: () => Promise<MailAccount[]>
    create: (input: AccountCreateInput) => Promise<MailAccount>
    onCreated: (callback: (event: AccountCreatedEvent) => void) => () => void
    openAddWindow: () => Promise<boolean>
    closeAddWindow: () => Promise<boolean>
    update: (input: AccountUpdateInput) => Promise<MailAccount>
    reauthorize: (accountId: number) => Promise<MailAccount>
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
    delete: (input: MessageDeleteInput) => Promise<MessageDeleteResult>
    bulkDelete: (input: MessageBulkDeleteInput) => Promise<MessageBulkDeleteResult>
    hideLocal: (messageId: number) => Promise<MessageDeleteResult>
    restore: (messageId: number) => Promise<MessageRestoreResult>
  }
  compose: {
    createReplyDraft: (input: ReplyDraftInput) => Promise<ComposeDraft>
    createForwardDraft: (input: ForwardDraftInput) => Promise<ComposeDraft>
    send: (input: MailSendInput) => Promise<MailSendResult>
    selectAttachments: () => Promise<MailAttachmentInput[]>
    listOutbox: (query?: OutboxListQuery) => Promise<OutboxMessage[]>
    saveDraft: (input: MailSendInput) => Promise<OutboxMessage>
    deleteDraft: (outboxId: number) => Promise<boolean>
    retry: (outboxId: number) => Promise<MailSendResult>
    deleteOutbox: (outboxId: number) => Promise<boolean>
    onSent: (callback: (result: MailSendResult) => void) => () => void
  }
  sync: {
    startAll: (mode?: SyncMode) => Promise<SyncStatus>
    startAccount: (accountId: number, mode?: SyncMode) => Promise<AccountSyncRunResult>
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
  updates: {
    check: () => Promise<AppUpdateCheckResult>
  }
  system: {
    info: () => Promise<SystemInfo>
    revealDatabase: () => Promise<boolean>
    revealPath: (path: string) => Promise<boolean>
    openExternal: (url: string) => Promise<boolean>
  }
}
