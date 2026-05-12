import { ipcMain } from 'electron'
import {
  getMessage,
  listAccountMailboxStats,
  listMessages,
  loadMessageBody
} from '../db/repositories/message.repository'
import { downloadAttachment } from '../mail/attachment-downloader'
import { loadMessageBodyFromImap } from '../mail/body-loader'
import { syncMessageReadState } from '../mail/read-state-sync'
import type { MessageListQuery } from './types'

export function registerMessageIpc(): void {
  ipcMain.handle('messages/list', (_event, query?: MessageListQuery) => listMessages(query))
  ipcMain.handle('messages/stats', () => listAccountMailboxStats())
  ipcMain.handle('messages/get', (_event, messageId: number) => getMessage(messageId))
  ipcMain.handle('messages/loadBody', async (_event, messageId: number) => {
    return loadMessageBody(messageId) ?? (await loadMessageBodyFromImap(messageId))
  })
  ipcMain.handle('messages/setReadState', (_event, messageId: number, isRead: boolean) =>
    syncMessageReadState(messageId, isRead)
  )
  ipcMain.handle('messages/downloadAttachment', (_event, attachmentId: number) =>
    downloadAttachment(attachmentId)
  )
}
