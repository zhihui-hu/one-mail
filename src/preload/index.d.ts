import { ElectronAPI } from '@electron-toolkit/preload'
import type { OneMailApi } from '../shared/types'

export type {
  AccountCreatedEvent,
  AccountCreateInput,
  AccountStatus,
  AccountMailboxStats,
  AccountUpdateInput,
  AppSettings,
  AttachmentDownloadResult,
  AuthType,
  BackupImportResult,
  ComposeDraft,
  ImapSecurity,
  ForwardAttachmentCandidate,
  ForwardDraftInput,
  MailAccount,
  MailAddressInput,
  MailAttachmentInput,
  MailboxChangedEvent,
  MailComposeMode,
  MailMessageAttachment,
  MailMessageBody,
  MailMessageBodyLoadResult,
  MailMessageDetail,
  MailMessageSummary,
  MailSendInput,
  MailSendResult,
  MessageBulkDeleteFailure,
  MessageBulkDeleteInput,
  MessageBulkDeleteResult,
  MessageDeleteInput,
  MessageDeleteMode,
  MessageDeleteResult,
  MessageFilterTag,
  MessageListQuery,
  MessageReadStateUpdate,
  MessageRestoreResult,
  NewMailNotification,
  NewMailNotificationMessage,
  NotificationStatus,
  OAuthAuthorizationMode,
  OneMailApi,
  OutboxMessage,
  ReplyDraftInput,
  SettingsUpdateInput,
  SmtpSecurity,
  SyncMode,
  SyncStatus,
  SystemInfo
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: OneMailApi
  }
}
