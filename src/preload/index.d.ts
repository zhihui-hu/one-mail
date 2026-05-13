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
  ImapSecurity,
  MailAccount,
  MailboxChangedEvent,
  MailMessageAttachment,
  MailMessageBody,
  MailMessageBodyLoadResult,
  MailMessageDetail,
  MailMessageSummary,
  MessageFilterTag,
  MessageListQuery,
  MessageReadStateUpdate,
  NewMailNotification,
  NewMailNotificationMessage,
  NotificationStatus,
  OAuthAuthorizationMode,
  OneMailApi,
  SettingsUpdateInput,
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
