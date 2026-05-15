import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts/list'),
    create: (input) => ipcRenderer.invoke('accounts/create', input),
    onCreated: (callback): (() => void) => {
      const listener = (_event, event): void => callback(event)
      ipcRenderer.on('accounts/created', listener)
      return () => ipcRenderer.off('accounts/created', listener)
    },
    openAddWindow: () => ipcRenderer.invoke('accounts/openAddWindow'),
    closeAddWindow: () => ipcRenderer.invoke('accounts/closeAddWindow'),
    update: (input) => ipcRenderer.invoke('accounts/update', input),
    reauthorize: (accountId) => ipcRenderer.invoke('accounts/reauthorize', accountId),
    disable: (accountId) => ipcRenderer.invoke('accounts/disable', accountId),
    remove: (accountId) => ipcRenderer.invoke('accounts/remove', accountId)
  },
  logos: {
    get: (domain) => ipcRenderer.invoke('logos/get', domain)
  },
  messages: {
    list: (query) => ipcRenderer.invoke('messages/list', query),
    stats: () => ipcRenderer.invoke('messages/stats'),
    get: (messageId) => ipcRenderer.invoke('messages/get', messageId),
    loadBody: (messageId) => ipcRenderer.invoke('messages/loadBody', messageId),
    setReadState: (messageId, isRead) =>
      ipcRenderer.invoke('messages/setReadState', messageId, isRead),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke('messages/downloadAttachment', attachmentId),
    delete: (input) => ipcRenderer.invoke('messages/delete', input),
    bulkDelete: (input) => ipcRenderer.invoke('messages/bulkDelete', input),
    hideLocal: (messageId) => ipcRenderer.invoke('messages/hideLocal', messageId),
    restore: (messageId) => ipcRenderer.invoke('messages/restore', messageId)
  },
  compose: {
    createReplyDraft: (input) => ipcRenderer.invoke('compose/createReplyDraft', input),
    createForwardDraft: (input) => ipcRenderer.invoke('compose/createForwardDraft', input),
    send: (input) => ipcRenderer.invoke('compose/send', input),
    selectAttachments: () => ipcRenderer.invoke('compose/selectAttachments'),
    listOutbox: (query) => ipcRenderer.invoke('compose/listOutbox', query),
    saveDraft: (input) => ipcRenderer.invoke('compose/saveDraft', input),
    deleteDraft: (outboxId) => ipcRenderer.invoke('compose/deleteDraft', outboxId),
    retry: (outboxId) => ipcRenderer.invoke('compose/retry', outboxId),
    deleteOutbox: (outboxId) => ipcRenderer.invoke('compose/deleteOutbox', outboxId),
    onSent: (callback): (() => void) => {
      const listener = (_event, result): void => callback(result)
      ipcRenderer.on('compose/sent', listener)
      return () => ipcRenderer.off('compose/sent', listener)
    }
  },
  sync: {
    startAll: (mode) => ipcRenderer.invoke('sync/startAll', mode),
    startAccount: (accountId, mode) => ipcRenderer.invoke('sync/startAccount', accountId, mode),
    status: () => ipcRenderer.invoke('sync/status'),
    onMailboxChanged: (callback): (() => void) => {
      const listener = (_event, event): void => callback(event)
      ipcRenderer.on('sync/mailboxChanged', listener)
      return () => ipcRenderer.off('sync/mailboxChanged', listener)
    }
  },
  notifications: {
    status: () => ipcRenderer.invoke('notifications/status'),
    onNewMail: (callback): (() => void) => {
      const listener = (_event, notification): void => callback(notification)
      ipcRenderer.on('notifications/newMail', listener)
      return () => ipcRenderer.off('notifications/newMail', listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings/get'),
    update: (input) => ipcRenderer.invoke('settings/update', input),
    exportSql: () => ipcRenderer.invoke('settings/exportSql'),
    importSql: () => ipcRenderer.invoke('settings/importSql')
  },
  system: {
    info: () => ipcRenderer.invoke('system/info'),
    revealDatabase: () => ipcRenderer.invoke('system/revealDatabase'),
    revealPath: (path) => ipcRenderer.invoke('system/revealPath', path)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
