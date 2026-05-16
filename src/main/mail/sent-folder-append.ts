import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, toNumber, type SqliteRow } from '../db/connection'
import { authenticateImapSession } from './imap-auth'
import { SimpleImapSession } from './imap-session'

export type SentAppendResult = {
  appended: boolean
  folderId?: number
  warning?: string
}

type SentFolderRow = SqliteRow & {
  folder_id: number
  path: string
}

export async function appendMessageToSentFolder(
  accountId: number,
  rawMime: string
): Promise<SentAppendResult> {
  const account = getAccount(accountId)
  if (!account) return { appended: false, warning: `Account not found: ${accountId}` }

  const sentFolder = findSentFolder(accountId)
  if (!sentFolder) return { appended: false, warning: '未找到 Sent/已发送 文件夹，已跳过远端追加。' }

  let session: SimpleImapSession | undefined

  try {
    session = await SimpleImapSession.connect(account, 'S')
    await authenticateImapSession(account, session)
    await session.appendMessage(sentFolder.path, rawMime, ['Seen'])
    return { appended: true, folderId: toNumber(sentFolder.folder_id) }
  } catch (error) {
    return {
      appended: false,
      folderId: toNumber(sentFolder.folder_id),
      warning: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await session?.logout().catch(() => undefined)
  }
}

function findSentFolder(accountId: number): SentFolderRow | undefined {
  return getDatabase()
    .prepare<SentFolderRow>(
      `
      SELECT folder_id, path
      FROM onemail_mail_folders
      WHERE account_id = :accountId
        AND (
          role = 'sent'
          OR lower(name) IN ('sent', 'sent mail', 'sent messages')
          OR name IN ('已发送', '已发送邮件')
        )
      ORDER BY CASE WHEN role = 'sent' THEN 0 ELSE 1 END, folder_id ASC
      LIMIT 1
      `
    )
    .get({ accountId })
}
