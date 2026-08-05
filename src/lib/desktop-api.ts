import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  AccountCreatedEvent,
  AppUpdateStatus,
  BackupImportProgress,
  MailSendResult,
  MailboxChangedEvent,
  NewMailNotification,
  OneMailApi
} from '@renderer/shared/types'

function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(name, args)
}

function subscribe<T>(eventName: string, callback: (payload: T) => void): () => void {
  let cancelled = false
  let unlisten: UnlistenFn | undefined

  void listen<T>(eventName, (event) => callback(event.payload))
    .then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten()
        return
      }
      unlisten = nextUnlisten
    })
    .catch((error) => console.warn(`Failed to subscribe to ${eventName}.`, error))

  return () => {
    cancelled = true
    unlisten?.()
  }
}

export function createDesktopApi(): OneMailApi {
  return {
    accounts: {
      list: () => command('accounts_list'),
      create: (input) => command('accounts_create', { input }),
      discoverFolders: (input) => command('accounts_discover_folders', { input }),
      onCreated: (callback) =>
        subscribe<AccountCreatedEvent>('accounts/created', callback),
      openAddWindow: () => command('accounts_open_add_window'),
      closeAddWindow: () => command('accounts_close_add_window'),
      update: (input) => command('accounts_update', { input }),
      reauthorize: (accountId) => command('accounts_reauthorize', { accountId }),
      disable: (accountId) => command('accounts_disable', { accountId }),
      remove: (accountId) => command('accounts_remove', { accountId })
    },
    logos: {
      get: (domain) => command('logos_get', { domain })
    },
    messages: {
      list: (query) => command('messages_list', { query }),
      stats: () => command('messages_stats'),
      get: (messageId) => command('messages_get', { messageId }),
      loadBody: (messageId) => command('messages_load_body', { messageId }),
      setReadState: (messageId, isRead) =>
        command('messages_set_read_state', { messageId, isRead }),
      bulkSetReadState: (input) => command('messages_bulk_set_read_state', { input }),
      markAllRead: (input) => command('messages_mark_all_read', { input }),
      downloadAttachment: (attachmentId) =>
        command('messages_download_attachment', { attachmentId }),
      delete: (input) => command('messages_delete', { input }),
      bulkDelete: (input) => command('messages_bulk_delete', { input }),
      hideLocal: (messageId) => command('messages_hide_local', { messageId }),
      restore: (messageId) => command('messages_restore', { messageId })
    },
    compose: {
      createReplyDraft: (input) => command('compose_create_reply_draft', { input }),
      createForwardDraft: (input) => command('compose_create_forward_draft', { input }),
      send: (input) => command('compose_send', { input }),
      selectAttachments: () => command('compose_select_attachments'),
      listOutbox: (query) => command('compose_list_outbox', { query }),
      saveDraft: (input) => command('compose_save_draft', { input }),
      deleteDraft: (outboxId) => command('compose_delete_draft', { outboxId }),
      retry: (outboxId) => command('compose_retry', { outboxId }),
      deleteOutbox: (outboxId) => command('compose_delete_outbox', { outboxId }),
      onSent: (callback) => subscribe<MailSendResult>('compose/sent', callback)
    },
    sync: {
      startAll: (mode) => command('sync_start_all', { mode }),
      startAccount: (accountId, mode) =>
        command('sync_start_account', { accountId, mode }),
      status: () => command('sync_status'),
      onMailboxChanged: (callback) =>
        subscribe<MailboxChangedEvent>('sync/mailboxChanged', callback)
    },
    notifications: {
      status: () => command('notifications_status'),
      onNewMail: (callback) =>
        subscribe<NewMailNotification>('notifications/newMail', callback)
    },
    settings: {
      get: () => command('settings_get'),
      update: (input) => command('settings_update', { input }),
      getBackupSync: () => command('settings_get_backup_sync'),
      updateBackupSync: (input) => command('settings_update_backup_sync', { input }),
      testBackupSync: (input) => command('settings_test_backup_sync', { input }),
      uploadBackupSync: () => command('settings_upload_backup_sync'),
      downloadBackupSync: (operationId) =>
        command('settings_download_backup_sync', { operationId }),
      importBackupFromRemote: (input, operationId) =>
        command('settings_import_backup_from_remote', { input, operationId }),
      exportSql: () => command('settings_export_sql'),
      importSql: (operationId) => command('settings_import_sql', { operationId }),
      onBackupImportProgress: (callback) =>
        subscribe<BackupImportProgress>('settings/backupImportProgress', callback)
    },
    ai: {
      getSettings: () => command('ai_settings_get'),
      verifyAndSave: (input) => command('ai_settings_verify_and_save', { input }),
      clear: () => command('ai_settings_clear'),
      chat: (input) => command('ai_chat', { input })
    },
    updates: {
      check: () => command('updates_check'),
      status: () => command('updates_status'),
      install: () => command('updates_install'),
      onStatus: (callback) => subscribe<AppUpdateStatus>('updates/status', callback)
    },
    system: {
      info: () => command('system_info'),
      setTitleBarTheme: (theme) => command('system_set_title_bar_theme', { theme }),
      revealDatabase: () => command('system_reveal_database'),
      revealPath: (path) => command('system_reveal_path', { path }),
      openExternal: (url) => command('system_open_external', { url })
    }
  }
}
