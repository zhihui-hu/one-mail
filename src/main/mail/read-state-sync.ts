import type { MessageReadStateUpdate } from '../ipc/types'
import { getAccount } from '../db/repositories/account.repository'
import {
  getMessageReadStateTarget,
  updateMessageReadState
} from '../db/repositories/message.repository'
import { authenticateImapSession } from './imap-auth'
import { SimpleImapSession } from './imap-session'

export async function syncMessageReadState(
  messageId: number,
  isRead: boolean
): Promise<MessageReadStateUpdate> {
  const target = getMessageReadStateTarget(messageId)
  if (!target) {
    throw new Error('邮件不存在或已从远端删除。')
  }

  if (target.isRead === isRead) {
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      isRead
    }
  }

  const account = getAccount(target.accountId)
  if (!account) {
    throw new Error(`Account not found: ${target.accountId}`)
  }

  const client = await SimpleImapSession.connect(account, 'R')

  try {
    await authenticateImapSession(account, client)
    await client.identifyClient()
    await client.selectMailbox(target.folderPath)
    await client.setSeenFlag(target.uid, isRead)
  } finally {
    await client.logout().catch(() => undefined)
  }

  return updateMessageReadState(messageId, isRead)
}
