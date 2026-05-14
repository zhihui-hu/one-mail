import { app, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../db/connection'
import type { AttachmentDownloadResult } from '../ipc/types'
import { SimpleImapSession } from './imap-session'
import { parseMimeAttachments, type ParsedMessageAttachment } from './body-loader'
import { authenticateImapSession } from './imap-auth'

type AttachmentDownloadRow = SqliteRow & {
  attachment_id: number
  message_id: number
  account_id: number
  folder_path: string
  uid: number
  filename: string
  mime_type: string | null
  size_bytes: number
}

export async function downloadAttachment(attachmentId: number): Promise<AttachmentDownloadResult> {
  const locator = getAttachmentDownloadLocator(attachmentId)
  if (!locator) throw new Error(`Attachment not found: ${attachmentId}`)

  const saveResult = await dialog.showSaveDialog({
    title: '下载附件',
    defaultPath: join(app.getPath('downloads'), sanitizeFileName(locator.filename)),
    filters: [{ name: '附件', extensions: [getFileExtension(locator.filename) ?? '*'] }]
  })

  if (saveResult.canceled || !saveResult.filePath) {
    return { downloaded: false, attachmentId }
  }

  const account = getAccount(locator.account_id)
  if (!account) throw new Error(`Account not found: ${locator.account_id}`)

  const client = await SimpleImapSession.connect(account, 'D')
  try {
    await authenticateImapSession(account, client)
    await client.selectMailbox(locator.folder_path)

    const rawMessage = await client.fetchRawMessage(locator.uid)
    const attachment = findMatchingAttachment(parseMimeAttachments(rawMessage), locator)
    if (!attachment) throw new Error('未找到可下载的附件内容。')

    writeFileSync(saveResult.filePath, attachment.content)

    return {
      downloaded: true,
      attachmentId,
      filePath: saveResult.filePath
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

function getAttachmentDownloadLocator(attachmentId: number): AttachmentDownloadRow | null {
  const row = getDatabase()
    .prepare<AttachmentDownloadRow>(
      `
      SELECT
        a.attachment_id,
        a.message_id,
        m.account_id,
        f.path AS folder_path,
        m.uid,
        a.filename,
        a.mime_type,
        a.size_bytes
      FROM onemail_message_attachments a
      JOIN onemail_mail_messages m ON m.message_id = a.message_id
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE a.attachment_id = :attachmentId
      `
    )
    .get({ attachmentId })

  return row ?? null
}

function findMatchingAttachment(
  attachments: ParsedMessageAttachment[],
  locator: AttachmentDownloadRow
): ParsedMessageAttachment | undefined {
  const filename = toOptionalString(locator.filename)
  const mimeType = toOptionalString(locator.mime_type)
  const sizeBytes = toNumber(locator.size_bytes)

  return (
    attachments.find(
      (attachment) =>
        attachment.filename === filename &&
        attachment.mimeType === mimeType &&
        attachment.sizeBytes === sizeBytes
    ) ??
    attachments.find(
      (attachment) => attachment.filename === filename && attachment.sizeBytes === sizeBytes
    ) ??
    attachments.find((attachment) => attachment.filename === filename)
  )
}

function sanitizeFileName(value: string): string {
  const fileName = basename(value)
    .split('')
    .map((char) => (isUnsafeFileNameChar(char) ? '_' : char))
    .join('')
    .trim()
  return fileName || 'attachment'
}

function isUnsafeFileNameChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char)
}

function getFileExtension(value: string): string | undefined {
  const fileName = basename(value)
  const extension = fileName.includes('.') ? fileName.split('.').at(-1) : undefined
  return extension && /^[a-z0-9]+$/i.test(extension) ? extension : undefined
}
