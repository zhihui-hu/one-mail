import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, type SqliteParams } from '../db/connection'
import type { MailMessageBody } from '../ipc/types'
import { normalizeMailBodyText, normalizeMailDisplayText } from '../../shared/mail-text'
import { SimpleImapSession } from './imap-session'
import { authenticateImapSession } from './imap-auth'

type MessageLocator = {
  message_id: number
  account_id: number
  folder_path: string
  uid: number
}

type ParsedMimePart = {
  headers: Map<string, string>
  body: string
}

type ParsedMessageBody = {
  text?: string
  html?: string
  attachments: Array<{
    filename: string
    mimeType?: string
    contentDisposition?: 'attachment' | 'inline'
    sizeBytes: number
  }>
}

export type ParsedMessageAttachment = ParsedMessageBody['attachments'][number] & {
  content: Buffer
}

export async function loadMessageBodyFromImap(messageId: number): Promise<MailMessageBody | null> {
  const locator = getMessageLocator(messageId)
  if (!locator) return null

  const account = getAccount(locator.account_id)
  if (!account) {
    throw new Error(`Account not found: ${locator.account_id}`)
  }

  const db = getDatabase()
  db.prepare(
    `
    UPDATE onemail_mail_messages
    SET body_status = 'loading',
        body_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE message_id = :messageId
    `
  ).run({ messageId })

  const client = await SimpleImapSession.connect(account, 'B')

  try {
    await authenticateImapSession(account, client)
    await client.selectMailbox(locator.folder_path)
    const rawMessage = await client.fetchRawMessage(locator.uid)
    const parsed = parseMimeMessage(rawMessage)
    const body = persistMessageBody(messageId, parsed)
    return body
  } catch (error) {
    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET body_status = 'error',
          body_error = :message,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    ).run({
      messageId,
      message: error instanceof Error ? error.message : '加载正文失败。'
    })
    throw error
  } finally {
    await client.logout().catch(() => undefined)
  }
}

function getMessageLocator(messageId: number): MessageLocator | null {
  const row = getDatabase()
    .prepare<MessageLocator>(
      `
      SELECT
        m.message_id,
        m.account_id,
        f.path AS folder_path,
        m.uid
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  return row ?? null
}

function persistMessageBody(messageId: number, parsed: ParsedMessageBody): MailMessageBody {
  const bodyText = normalizeMailBodyText(parsed.text)
  const bodyHtml = sanitizeHtml(parsed.html)
  const db = getDatabase()
  const params: SqliteParams = {
    messageId,
    bodyText: bodyText ?? null,
    bodyHtml: bodyHtml ?? null,
    externalImagesBlocked: 1
  }

  db.prepare(
    `
    INSERT INTO onemail_message_bodies (
      message_id,
      body_text,
      body_html_sanitized,
      external_images_blocked,
      sanitized_at
    )
    VALUES (
      :messageId,
      :bodyText,
      :bodyHtml,
      :externalImagesBlocked,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(message_id) DO UPDATE SET
      body_text = excluded.body_text,
      body_html_sanitized = excluded.body_html_sanitized,
      external_images_blocked = excluded.external_images_blocked,
      sanitized_at = excluded.sanitized_at,
      loaded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `
  ).run(params)

  db.prepare('DELETE FROM onemail_message_attachments WHERE message_id = :messageId').run({
    messageId
  })

  const insertAttachment = db.prepare(
    `
    INSERT INTO onemail_message_attachments (
      message_id,
      filename,
      mime_type,
      content_disposition,
      size_bytes
    )
    VALUES (
      :messageId,
      :filename,
      :mimeType,
      :contentDisposition,
      :sizeBytes
    )
    `
  )

  for (const attachment of parsed.attachments) {
    insertAttachment.run({
      messageId,
      filename: attachment.filename,
      mimeType: attachment.mimeType ?? null,
      contentDisposition: attachment.contentDisposition ?? 'attachment',
      sizeBytes: attachment.sizeBytes
    })
  }

  db.prepare(
    `
    UPDATE onemail_mail_messages
    SET has_attachments = :hasAttachments,
        body_status = 'ready',
        body_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE message_id = :messageId
    `
  ).run({
    messageId,
    hasAttachments: parsed.attachments.length > 0 ? 1 : 0
  })

  updateMessageSearchIndex(messageId, bodyText ?? htmlToSearchText(bodyHtml) ?? '')

  return {
    messageId,
    bodyText,
    bodyHtmlSanitized: bodyHtml,
    externalImagesBlocked: true
  }
}

function updateMessageSearchIndex(messageId: number, bodyText: string): void {
  const db = getDatabase()
  const row = db
    .prepare<{
      account_id: number
      folder_id: number
      subject: string | null
      from_name: string | null
      from_email: string | null
      snippet: string | null
    }>(
      `
      SELECT
        account_id,
        folder_id,
        subject,
        from_name,
        from_email,
        snippet
      FROM onemail_mail_messages
      WHERE message_id = :messageId
      `
    )
    .get({ messageId })

  if (!row) return

  db.prepare('DELETE FROM onemail_message_search WHERE message_id = :messageId').run({
    messageId
  })
  db.prepare(
    `
    INSERT INTO onemail_message_search (
      message_id,
      account_id,
      folder_id,
      subject,
      from_name,
      from_email,
      snippet,
      body_text
    )
    VALUES (
      :messageId,
      :accountId,
      :folderId,
      :subject,
      :fromName,
      :fromEmail,
      :snippet,
      :bodyText
    )
    `
  ).run({
    messageId,
    accountId: row.account_id,
    folderId: row.folder_id,
    subject: row.subject ?? '',
    fromName: row.from_name ?? '',
    fromEmail: row.from_email ?? '',
    snippet: row.snippet ?? '',
    bodyText
  })
}

function htmlToSearchText(value?: string): string | undefined {
  const text = value
    ?.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

  return text || undefined
}

function parseMimeMessage(rawMessage: string): ParsedMessageBody {
  const root = splitHeaderAndBody(rawMessage)
  const parts = flattenMimeParts(root.headers, root.body)
  const textPart = parts.find((part) => getContentType(part.headers).mimeType === 'text/plain')
  const htmlPart = parts.find((part) => getContentType(part.headers).mimeType === 'text/html')
  const attachments = parts
    .map((part) => mapAttachmentPart(part))
    .filter((attachment): attachment is ParsedMessageBody['attachments'][number] =>
      Boolean(attachment)
    )

  return {
    text: textPart ? decodePartBody(textPart) : undefined,
    html: htmlPart ? decodePartBody(htmlPart) : undefined,
    attachments
  }
}

export function parseMimeAttachments(rawMessage: string): ParsedMessageAttachment[] {
  const root = splitHeaderAndBody(rawMessage)
  return flattenMimeParts(root.headers, root.body)
    .map((part) => {
      const attachment = mapAttachmentPart(part)
      return attachment ? { ...attachment, content: decodePartBytes(part) } : null
    })
    .filter((attachment): attachment is ParsedMessageAttachment => Boolean(attachment))
}

function flattenMimeParts(headers: Map<string, string>, body: string): ParsedMimePart[] {
  const { mimeType, boundary } = getContentType(headers)
  if (!mimeType.startsWith('multipart/') || !boundary) {
    return [{ headers, body }]
  }

  return splitMultipartBody(body, boundary).flatMap((part) => {
    const parsedPart = splitHeaderAndBody(part)
    return flattenMimeParts(parsedPart.headers, parsedPart.body)
  })
}

function splitHeaderAndBody(value: string): ParsedMimePart {
  const index = value.search(/\r?\n\r?\n/)
  if (index < 0) {
    return { headers: new Map(), body: value }
  }

  const separator = value.match(/\r?\n\r?\n/)
  const bodyStart = index + (separator?.[0].length ?? 0)
  return {
    headers: parseHeaders(value.slice(0, index)),
    body: value.slice(bodyStart)
  }
}

function parseHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>()
  let currentKey = ''

  for (const line of value.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`.trim())
      continue
    }

    const index = line.indexOf(':')
    if (index <= 0) continue
    currentKey = line.slice(0, index).trim().toLowerCase()
    headers.set(currentKey, line.slice(index + 1).trim())
  }

  return headers
}

function splitMultipartBody(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`
  const parts: string[] = []

  for (const segment of body.split(delimiter).slice(1)) {
    if (segment.startsWith('--')) break
    parts.push(segment.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
  }

  return parts
}

function mapAttachmentPart(part: ParsedMimePart): ParsedMessageBody['attachments'][number] | null {
  const contentType = getContentType(part.headers)
  const disposition = getContentDisposition(part.headers)
  const filename = disposition.filename ?? contentType.name

  if (!filename) return null
  if (disposition.value !== 'attachment' && disposition.value !== 'inline') return null

  return {
    filename,
    mimeType: contentType.mimeType,
    contentDisposition: disposition.value,
    sizeBytes: estimateDecodedSize(part.body, part.headers.get('content-transfer-encoding'))
  }
}

function decodePartBody(part: ParsedMimePart): string {
  return decodeBytes(decodePartBytes(part), getContentType(part.headers).charset)
}

function decodePartBytes(part: ParsedMimePart): Buffer {
  const encoding = part.headers.get('content-transfer-encoding')?.toLowerCase()

  if (encoding === 'base64') {
    return Buffer.from(part.body.replace(/\s+/g, ''), 'base64')
  }

  if (encoding === 'quoted-printable') {
    return Buffer.from(decodeQuotedPrintableBytes(part.body))
  }

  return Buffer.from(part.body, 'utf8')
}

function decodeQuotedPrintableBytes(value: string): Uint8Array {
  const normalized = value.replace(/=\r?\n/g, '')
  const bytes: number[] = []

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const hex = normalized.slice(index + 1, index + 3)
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
      continue
    }

    bytes.push(char.charCodeAt(0) & 0xff)
  }

  return new Uint8Array(bytes)
}

function getContentType(headers: Map<string, string>): {
  mimeType: string
  charset: string
  boundary?: string
  name?: string
} {
  const value = headers.get('content-type') ?? 'text/plain'
  const params = parseHeaderParams(value)
  return {
    mimeType: value.split(';')[0]?.trim().toLowerCase() || 'text/plain',
    charset: params.get('charset') ?? 'utf-8',
    boundary: params.get('boundary'),
    name: normalizeMailDisplayText(params.get('name'))
  }
}

function getContentDisposition(headers: Map<string, string>): {
  value?: 'attachment' | 'inline'
  filename?: string
} {
  const value = headers.get('content-disposition') ?? ''
  const params = parseHeaderParams(value)
  const disposition = value.split(';')[0]?.trim().toLowerCase()

  return {
    value:
      disposition === 'inline' ? 'inline' : disposition === 'attachment' ? 'attachment' : undefined,
    filename:
      normalizeMailDisplayText(params.get('filename*')) ??
      normalizeMailDisplayText(params.get('filename'))
  }
}

function parseHeaderParams(value: string): Map<string, string> {
  const params = new Map<string, string>()

  for (const segment of value.split(';').slice(1)) {
    const index = segment.indexOf('=')
    if (index <= 0) continue

    const key = segment.slice(0, index).trim().toLowerCase()
    const rawValue = segment
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, '')
    params.set(key, decodeRfc2231Value(rawValue))
  }

  return params
}

function decodeRfc2231Value(value: string): string {
  const match = value.match(/^([^']*)''(.+)$/)
  if (!match) return value

  try {
    const decoded = decodeURIComponent(match[2])
    return decodeBytes(Buffer.from(decoded, 'utf8'), match[1] || 'utf-8')
  } catch {
    return value
  }
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const normalized = charset.trim().replace(/^"|"$/g, '').toLowerCase()
  const labels =
    normalized === 'utf8' || normalized === 'utf-8'
      ? ['utf-8']
      : ['gb18030', 'gbk', 'gb2312', 'cp936'].includes(normalized)
        ? ['gb18030', 'gbk', 'utf-8']
        : [normalized, 'utf-8', 'windows-1252']

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      continue
    }
  }

  return Buffer.from(bytes).toString('utf8')
}

function sanitizeHtml(value?: string): string | undefined {
  if (!value) return undefined

  const sanitized = value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s(on[a-z]+)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(src|href)=("|')\s*javascript:[\s\S]*?\2/gi, '')
    .replace(
      /\ssrc=(["'])((?:https?:)?\/\/[^"'\s>]+)\1/gi,
      (_match: string, quote: string, url: string) => ` data-blocked-src=${quote}${url}${quote}`
    )
    .trim()

  return sanitized || undefined
}

function estimateDecodedSize(value: string, encoding?: string): number {
  if (encoding?.toLowerCase() === 'base64') {
    return Buffer.byteLength(value.replace(/\s+/g, ''), 'base64')
  }

  return Buffer.byteLength(value, 'utf8')
}
