import { ipcMain } from 'electron'
import {
  bulkDelete,
  hideMessageLocally,
  permanentlyDeleteMessage,
  restoreMessage
} from '../mail/message-delete'
import type {
  MessageBulkDeleteInput,
  MessageBulkDeleteResult,
  MessageDeleteInput,
  MessageDeleteMode,
  MessageDeleteResult,
  MessageRestoreResult
} from './types'

export function registerMessageActionIpc(): void {
  ipcMain.handle('messages/delete', async (_event, input: MessageDeleteInput) => {
    return deleteOneMessage(input)
  })
  ipcMain.handle('messages/bulkDelete', async (_event, input: MessageBulkDeleteInput) => {
    const mode = input.mode === 'local_hide' ? 'local_hide' : 'permanent'
    const result = await bulkDelete(input.messageIds, {
      localOnly: mode === 'local_hide'
    })

    return {
      mode,
      succeededMessageIds: result.succeededMessageIds,
      failedItems: result.failedItems,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount
    } satisfies MessageBulkDeleteResult
  })
  ipcMain.handle('messages/hideLocal', (_event, messageId: number) => {
    const result = hideMessageLocally(messageId)
    return toDeleteResult(result.messageId, result.accountId, 'local_hide', true, true)
  })
  ipcMain.handle('messages/restore', async (_event, messageId: number) => {
    const result = await restoreMessage(messageId)
    return {
      messageId: result.messageId,
      accountId: result.accountId,
      restored: true,
      localOnly: Boolean(result.localOnly)
    } satisfies MessageRestoreResult
  })
}

async function deleteOneMessage(input: MessageDeleteInput): Promise<MessageDeleteResult> {
  const mode = input.mode === 'local_hide' ? 'local_hide' : 'permanent'

  if (mode === 'local_hide') {
    const result = hideMessageLocally(input.messageId)
    return toDeleteResult(result.messageId, result.accountId, mode, true, true)
  }

  const result = await permanentlyDeleteMessage(input.messageId)

  return toDeleteResult(result.messageId, result.accountId, mode, true, false)
}

function toDeleteResult(
  messageId: number,
  accountId: number | undefined,
  mode: MessageDeleteMode,
  deleted: boolean,
  localOnly: boolean
): MessageDeleteResult {
  return {
    messageId,
    accountId,
    mode,
    deleted,
    localOnly
  }
}
