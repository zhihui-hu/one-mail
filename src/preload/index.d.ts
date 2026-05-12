import { ElectronAPI } from '@electron-toolkit/preload'
import type { OneMailApi } from '../shared/types'

export type {
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
  MailMessageDetail,
  MailMessageSummary,
  MessageFilterTag,
  MessageListQuery,
  MessageReadStateUpdate,
  NewMailNotification,
  NewMailNotificationMessage,
  NotificationStatus,
  OneMailApi,
  SettingsUpdateInput,
  SyncStatus,
  SystemInfo
} from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: OneMailApi
  }
}
