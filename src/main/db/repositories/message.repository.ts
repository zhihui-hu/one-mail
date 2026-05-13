import { getDatabase, toBoolean, toNumber, toOptionalString, type SqliteRow } from '../connection'
import type {
  AccountMailboxStats,
  MailMessageBody,
  MailMessageAttachment,
  MailMessageDetail,
  MailMessageSummary,
  MessageReadStateUpdate,
  NewMailNotificationMessage,
  MessageListQuery
} from '../../ipc/types'
import { extractVerificationCode } from '../../../shared/verification-code'

type MessageRow = SqliteRow & {
  message_id: number
  account_id: number
  folder_id: number
  subject: string | null
  from_name: string | null
  from_email: string | null
  received_at: string | null
  snippet: string | null
  is_read: number
  is_starred: number
  has_attachments: number
  body_status: MailMessageSummary['bodyStatus']
  body_text?: string | null
  body_html_sanitized?: string | null
  external_images_blocked?: number
}

type AttachmentRow = SqliteRow & {
  attachment_id: number
  filename: string
  mime_type: string | null
  content_disposition: MailMessageAttachment['contentDisposition'] | null
  size_bytes: number
}

type AccountMailboxStatsRow = SqliteRow & {
  account_id: number
  total_count: number
  unread_count: number
}

export type MessageReadStateTarget = {
  messageId: number
  accountId: number
  folderId: number
  folderPath: string
  uid: number
  isRead: boolean
}

export function listMessages(query?: MessageListQuery): MailMessageSummary[] {
  const where: string[] = ['m.remote_deleted = 0']
  const params: Record<string, string | number> = {
    limit: Math.min(Math.max(query?.limit ?? 50, 1), 200),
    offset: Math.max(query?.offset ?? 0, 0)
  }

  if (query?.accountId !== undefined) {
    where.push('m.account_id = :accountId')
    params.accountId = query.accountId
  }

  if (query?.folderId !== undefined) {
    where.push('m.folder_id = :folderId')
    params.folderId = query.folderId
  }

  const filters = new Set(query?.filters ?? [])
  if (filters.has('unread')) where.push('m.is_read = 0')
  if (filters.has('attachments')) where.push('m.has_attachments = 1')
  if (filters.has('starred')) where.push('m.is_starred = 1')
  if (filters.has('today')) {
    where.push("date(COALESCE(m.received_at, m.internal_date)) = date('now', 'localtime')")
  }

  const keyword = normalizeSearchKeyword(query?.keyword ?? query?.search)
  if (keyword) {
    const searchClauses = [
      "m.subject LIKE :likeKeyword ESCAPE '\\'",
      "m.from_name LIKE :likeKeyword ESCAPE '\\'",
      "m.from_email LIKE :likeKeyword ESCAPE '\\'",
      "m.snippet LIKE :likeKeyword ESCAPE '\\'",
      "b.body_text LIKE :likeKeyword ESCAPE '\\'"
    ]
    const ftsKeyword = toFtsQuery(keyword)

    if (ftsKeyword) {
      searchClauses.unshift(
        `m.message_id IN (
          SELECT message_id
          FROM onemail_message_search
          WHERE onemail_message_search MATCH :ftsKeyword
        )`
      )
      params.ftsKeyword = ftsKeyword
    }

    where.push(`(${searchClauses.join(' OR ')})`)
    params.likeKeyword = `%${escapeLikeKeyword(keyword)}%`
  }

  const rows = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized
      FROM onemail_mail_messages m
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(m.received_at, m.internal_date, m.created_at) DESC, m.message_id DESC
      LIMIT :limit OFFSET :offset
      `
    )
    .all(params)

  return rows.map(mapMessageSummaryRow)
}

function normalizeSearchKeyword(value?: string): string | undefined {
  const keyword = value?.replace(/\s+/g, ' ').trim()
  return keyword || undefined
}

function escapeLikeKeyword(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function toFtsQuery(value: string): string {
  return (
    value
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((term) => term.replace(/"/g, '""'))
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(' AND ') ?? ''
  )
}

export function listAccountMailboxStats(): AccountMailboxStats[] {
  const rows = getDatabase()
    .prepare<AccountMailboxStatsRow>(
      `
      SELECT
        account_id,
        SUM(total_count) AS total_count,
        SUM(unread_count) AS unread_count
      FROM (
        SELECT
          f.account_id,
          f.total_count,
          f.unread_count
        FROM onemail_mail_folders f
        WHERE f.sync_enabled = 1
          AND (f.total_count > 0 OR f.unread_count > 0)
        UNION ALL
        SELECT
          m.account_id,
          COUNT(*) AS total_count,
          SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END) AS unread_count
        FROM onemail_mail_messages m
        WHERE m.remote_deleted = 0
          AND NOT EXISTS (
            SELECT 1
            FROM onemail_mail_folders f
            WHERE f.account_id = m.account_id
              AND f.sync_enabled = 1
              AND (f.total_count > 0 OR f.unread_count > 0)
          )
        GROUP BY m.account_id
      )
      GROUP BY account_id
      `
    )
    .all()

  return rows.map((row) => ({
    accountId: toNumber(row.account_id),
    totalCount: toNumber(row.total_count),
    unreadCount: toNumber(row.unread_count)
  }))
}

export function listRecentNotificationMessages(
  accountId: number,
  limit: number
): NewMailNotificationMessage[] {
  const rows = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized
      FROM onemail_mail_messages m
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.account_id = :accountId
        AND m.remote_deleted = 0
      ORDER BY m.message_id DESC
      LIMIT :limit
      `
    )
    .all({ accountId, limit: Math.min(Math.max(limit, 1), 10) })

  return rows.map((row) => ({
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    subject: toOptionalString(row.subject),
    fromName: toOptionalString(row.from_name),
    fromEmail: toOptionalString(row.from_email),
    receivedAt: toOptionalString(row.received_at),
    snippet: toOptionalString(row.snippet),
    verificationCode: extractVerificationCode(
      row.subject,
      row.snippet,
      row.body_text,
      row.body_html_sanitized
    )
  }))
}

export function getMessage(messageId: number): MailMessageDetail | null {
  const db = getDatabase()
  const row = db
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized,
        b.external_images_blocked
      FROM onemail_mail_messages m
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    ...mapMessageSummaryRow(row),
    body: mapBodyRow(row),
    attachments: listAttachments(messageId, db)
  }
}

export function loadMessageBody(messageId: number): MailMessageBody | null {
  const row = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized,
        b.external_images_blocked
      FROM onemail_mail_messages m
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  return row ? (mapBodyRow(row) ?? null) : null
}

export function getMessageReadStateTarget(messageId: number): MessageReadStateTarget | null {
  const row = getDatabase()
    .prepare<
      SqliteRow & {
        message_id: number
        account_id: number
        folder_id: number
        folder_path: string
        uid: number
        is_read: number
      }
    >(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.path AS folder_path,
        m.uid,
        m.is_read
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE m.message_id = :messageId
        AND m.remote_deleted = 0
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    folderPath: row.folder_path,
    uid: toNumber(row.uid),
    isRead: toBoolean(row.is_read)
  }
}

export function updateMessageReadState(messageId: number, isRead: boolean): MessageReadStateUpdate {
  const db = getDatabase()
  const target = getMessageReadStateTarget(messageId)
  if (!target) {
    throw new Error('邮件不存在或已从远端删除。')
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET is_read = :isRead,
          flags_json = :flagsJson,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    ).run({
      messageId,
      isRead: isRead ? 1 : 0,
      flagsJson: updateFlagsJsonForReadState(isRead, messageId)
    })

    refreshFolderUnreadCount(target.folderId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return {
    messageId,
    accountId: target.accountId,
    folderId: target.folderId,
    isRead
  }
}

function mapMessageSummaryRow(row: MessageRow): MailMessageSummary {
  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    subject: toOptionalString(row.subject),
    fromName: toOptionalString(row.from_name),
    fromEmail: toOptionalString(row.from_email),
    receivedAt: toOptionalString(row.received_at),
    snippet: toOptionalString(row.snippet),
    isRead: toBoolean(row.is_read),
    isStarred: toBoolean(row.is_starred),
    hasAttachments: toBoolean(row.has_attachments),
    bodyStatus: row.body_status,
    verificationCode: extractVerificationCode(
      row.subject,
      row.snippet,
      row.body_text,
      row.body_html_sanitized
    )
  }
}

function updateFlagsJsonForReadState(nextIsRead: boolean, messageId: number): string {
  const current = getDatabase()
    .prepare<{
      flags_json: string
    }>('SELECT flags_json FROM onemail_mail_messages WHERE message_id = :messageId')
    .get({ messageId })
  const flags = parseFlagsJson(current?.flags_json)
  deleteFlag(flags, 'Seen')

  if (nextIsRead) {
    flags.add('Seen')
  }

  return JSON.stringify(Array.from(flags))
}

function parseFlagsJson(value?: string): Set<string> {
  if (!value) return new Set()

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    )
  } catch {
    return new Set()
  }
}

function deleteFlag(flags: Set<string>, flagName: string): void {
  for (const flag of flags) {
    if (flag.toLowerCase() === flagName.toLowerCase()) {
      flags.delete(flag)
    }
  }
}

function refreshFolderUnreadCount(folderId: number): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_folders
      SET unread_count = (
            SELECT COUNT(*)
            FROM onemail_mail_messages
            WHERE folder_id = :folderId
              AND remote_deleted = 0
              AND is_read = 0
          ),
          total_count = (
            SELECT COUNT(*)
            FROM onemail_mail_messages
            WHERE folder_id = :folderId
              AND remote_deleted = 0
          ),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE folder_id = :folderId
      `
    )
    .run({ folderId })
}

function listAttachments(messageId: number, db = getDatabase()): MailMessageAttachment[] {
  const rows = db
    .prepare<AttachmentRow>(
      `
      SELECT
        attachment_id,
        filename,
        mime_type,
        content_disposition,
        size_bytes
      FROM onemail_message_attachments
      WHERE message_id = :messageId
      ORDER BY attachment_id ASC
      `
    )
    .all({ messageId })

  return rows.map((row) => ({
    attachmentId: toNumber(row.attachment_id),
    filename: row.filename,
    mimeType: toOptionalString(row.mime_type),
    contentDisposition: row.content_disposition ?? undefined,
    sizeBytes: toNumber(row.size_bytes)
  }))
}

function mapBodyRow(row: MessageRow): MailMessageBody | undefined {
  if (!row.body_text && !row.body_html_sanitized) return undefined

  return {
    messageId: toNumber(row.message_id),
    bodyText: toOptionalString(row.body_text),
    bodyHtmlSanitized: toOptionalString(row.body_html_sanitized),
    externalImagesBlocked:
      row.external_images_blocked === undefined ? true : toBoolean(row.external_images_blocked)
  }
}
