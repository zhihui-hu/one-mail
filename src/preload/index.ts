import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts/list'),
    create: (input) => ipcRenderer.invoke('accounts/create', input),
    update: (input) => ipcRenderer.invoke('accounts/update', input),
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
      ipcRenderer.invoke('messages/downloadAttachment', attachmentId)
  },
  sync: {
    startAll: () => ipcRenderer.invoke('sync/startAll'),
    startAccount: (accountId) => ipcRenderer.invoke('sync/startAccount', accountId),
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
