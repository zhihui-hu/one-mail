import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../connection'
import { basename } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { ComposeAddress, ComposeAttachment } from '../../mail/message-composer'

export type OutboxComposeKind = 'new' | 'reply' | 'reply_all' | 'forward'
export type OutboxStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled'
  | 'deleted'

export type OutboxCreateInput = {
  accountId: number
  relatedMessageId?: number
  composeKind: OutboxComposeKind
  status?: OutboxStatus
  rfc822MessageId: string
  inReplyTo?: string
  referencesHeader?: string
  from: ComposeAddress
  to: ComposeAddress[]
  cc?: ComposeAddress[]
  bcc?: ComposeAddress[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  rawMime?: string
  attachments?: ComposeAttachment[]
}

export type OutboxRecord = OutboxCreateInput & {
  outboxId: number
  status: OutboxStatus
  sentAt?: string
  deletedAt?: string
  lastError?: string
  lastWarning?: string
  createdAt?: string
  updatedAt?: string
}

type OutboxRow = SqliteRow & {
  outbox_id: number
  account_id: number
  related_message_id: number | null
  compose_kind: OutboxComposeKind
  status: OutboxStatus
  rfc822_message_id: string
  in_reply_to: string | null
  references_header: string | null
  from_name: string | null
  from_email: string
  to_json: string
  cc_json: string
  bcc_json: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  raw_mime: string | null
  sent_at: string | null
  deleted_at: string | null
  last_error: string | null
  last_warning: string | null
  created_at: string | null
  updated_at: string | null
}

type OutboxAttachmentRow = SqliteRow & {
  file_path: string | null
  filename: string
  mime_type: string | null
  size_bytes: number
}

export function createOutboxRecord(input: OutboxCreateInput): OutboxRecord {
  const db = getDatabase()
  ensureOutboxTables(db)

  const result = db
    .prepare(
      `
      INSERT INTO onemail_outbox_messages (
        account_id,
        related_message_id,
        compose_kind,
        status,
        rfc822_message_id,
        in_reply_to,
        references_header,
        from_name,
        from_email,
        to_json,
        cc_json,
        bcc_json,
        subject,
        body_text,
        body_html,
        raw_mime
      )
      VALUES (
        :accountId,
        :relatedMessageId,
        :composeKind,
        :status,
        :rfc822MessageId,
        :inReplyTo,
        :referencesHeader,
        :fromName,
        :fromEmail,
        :toJson,
        :ccJson,
        :bccJson,
        :subject,
        :bodyText,
        :bodyHtml,
        :rawMime
      )
      `
    )
    .run({
      accountId: input.accountId,
      relatedMessageId: input.relatedMessageId ?? null,
      composeKind: input.composeKind,
      status: input.status ?? 'sending',
      rfc822MessageId: input.rfc822MessageId,
      inReplyTo: input.inReplyTo ?? null,
      referencesHeader: input.referencesHeader ?? null,
      fromName: input.from.name ?? null,
      fromEmail: input.from.email,
      toJson: JSON.stringify(input.to),
      ccJson: JSON.stringify(input.cc ?? []),
      bccJson: JSON.stringify(input.bcc ?? []),
      subject: input.subject ?? null,
      bodyText: input.bodyText ?? null,
      bodyHtml: input.bodyHtml ?? null,
      rawMime: input.rawMime ?? null
    })
  const outboxId = Number(result.lastInsertRowid)
  replaceOutboxAttachments(outboxId, input.attachments ?? [])

  const created = getOutboxRecord(outboxId)
  if (!created) throw new Error('Outbox insert did not return a row.')
  return created
}

export function updateOutboxRecord(outboxId: number, input: OutboxCreateInput): OutboxRecord {
  ensureOutboxTables()
  const result = getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET account_id = :accountId,
          related_message_id = :relatedMessageId,
          compose_kind = :composeKind,
          status = :status,
          rfc822_message_id = :rfc822MessageId,
          in_reply_to = :inReplyTo,
          references_header = :referencesHeader,
          from_name = :fromName,
          from_email = :fromEmail,
          to_json = :toJson,
          cc_json = :ccJson,
          bcc_json = :bccJson,
          subject = :subject,
          body_text = :bodyText,
          body_html = :bodyHtml,
          raw_mime = COALESCE(:rawMime, raw_mime),
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({
      outboxId,
      accountId: input.accountId,
      relatedMessageId: input.relatedMessageId ?? null,
      composeKind: input.composeKind,
      status: input.status ?? 'draft',
      rfc822MessageId: input.rfc822MessageId,
      inReplyTo: input.inReplyTo ?? null,
      referencesHeader: input.referencesHeader ?? null,
      fromName: input.from.name ?? null,
      fromEmail: input.from.email,
      toJson: JSON.stringify(input.to),
      ccJson: JSON.stringify(input.cc ?? []),
      bccJson: JSON.stringify(input.bcc ?? []),
      subject: input.subject ?? null,
      bodyText: input.bodyText ?? null,
      bodyHtml: input.bodyHtml ?? null,
      rawMime: input.rawMime ?? null
    })

  if (result.changes === 0) throw new Error('Outbox update did not match a row.')
  replaceOutboxAttachments(outboxId, input.attachments ?? [])
  const updated = getOutboxRecord(outboxId)
  if (!updated) throw new Error('Outbox update did not return a row.')
  return updated
}

export function getOutboxRecord(outboxId: number): OutboxRecord | null {
  ensureOutboxTables()
  const row = getDatabase()
    .prepare<OutboxRow>(
      `
      SELECT *
      FROM onemail_outbox_messages
      WHERE outbox_id = :outboxId
      `
    )
    .get({ outboxId })

  return row ? mapOutboxRow(row) : null
}

export function listOutboxRecords(
  input: {
    statuses?: OutboxStatus[]
    limit?: number
  } = {}
): OutboxRecord[] {
  ensureOutboxTables()
  const statuses = input.statuses?.filter((status) => status !== 'deleted')
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
  const statusFilter =
    statuses && statuses.length > 0
      ? `AND status IN (${statuses.map((_, index) => `:status${index}`).join(', ')})`
      : "AND status != 'deleted'"
  const params = Object.fromEntries(
    (statuses ?? []).map((status, index) => [`status${index}`, status])
  )

  const rows = getDatabase()
    .prepare<OutboxRow>(
      `
      SELECT *
      FROM onemail_outbox_messages
      WHERE 1 = 1
        ${statusFilter}
      ORDER BY updated_at DESC, outbox_id DESC
      LIMIT :limit
      `
    )
    .all({ ...params, limit })

  return rows.map(mapOutboxRow)
}

export function markOutboxSending(outboxId: number): void {
  ensureOutboxTables()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET status = 'sending',
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId })
}

export function markOutboxSent(outboxId: number, rawMime?: string): void {
  ensureOutboxTables()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET status = 'sent',
          sent_at = COALESCE(sent_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          raw_mime = COALESCE(:rawMime, raw_mime),
          last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId, rawMime: rawMime ?? null })
}

export function markOutboxFailed(outboxId: number, errorMessage: string): void {
  ensureOutboxTables()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET status = 'failed',
          last_error = :errorMessage,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId, errorMessage })
}

export function updateOutboxWarning(outboxId: number, warningMessage: string): void {
  ensureOutboxTables()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET last_warning = :warningMessage,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId, warningMessage })
}

export function updateOutboxRemoteSentLocation(
  outboxId: number,
  folderId?: number,
  uid?: number
): void {
  ensureOutboxTables()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET remote_sent_folder_id = :folderId,
          remote_sent_uid = :uid,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId, folderId: folderId ?? null, uid: uid ?? null })
}

export function deleteOutboxRecord(outboxId: number): boolean {
  ensureOutboxTables()
  const existing = getOutboxRecord(outboxId)
  if (!existing) return false
  if (existing.status === 'sending') {
    throw new Error('发送中的记录不能直接删除。')
  }

  getDatabase()
    .prepare(
      `
      UPDATE onemail_outbox_messages
      SET status = 'deleted',
          deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE outbox_id = :outboxId
      `
    )
    .run({ outboxId })

  return true
}

export function ensureOutboxTables(db = getDatabase()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS onemail_outbox_messages (
      outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      related_message_id INTEGER,
      compose_kind TEXT NOT NULL CHECK (compose_kind IN ('new', 'reply', 'reply_all', 'forward')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'deleted')),
      rfc822_message_id TEXT NOT NULL,
      in_reply_to TEXT,
      references_header TEXT,
      from_name TEXT,
      from_email TEXT NOT NULL,
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      bcc_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT,
      body_text TEXT,
      body_html TEXT,
      raw_mime TEXT,
      remote_sent_folder_id INTEGER,
      remote_sent_uid INTEGER,
      sent_at TEXT,
      deleted_at TEXT,
      last_error TEXT,
      last_warning TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS onemail_outbox_attachments (
      attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbox_id INTEGER NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('local_file', 'forwarded_attachment')),
      source_message_id INTEGER,
      source_attachment_id INTEGER,
      file_path TEXT,
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      content_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (outbox_id) REFERENCES onemail_outbox_messages(outbox_id) ON DELETE CASCADE
    );
  `)
}

function mapOutboxRow(row: OutboxRow): OutboxRecord {
  return {
    outboxId: toNumber(row.outbox_id),
    accountId: toNumber(row.account_id),
    relatedMessageId:
      row.related_message_id === null ? undefined : toNumber(row.related_message_id),
    composeKind: row.compose_kind,
    status: row.status,
    rfc822MessageId: row.rfc822_message_id,
    inReplyTo: toOptionalString(row.in_reply_to),
    referencesHeader: toOptionalString(row.references_header),
    from: {
      name: toOptionalString(row.from_name),
      email: row.from_email
    },
    to: parseAddressJson(row.to_json),
    cc: parseAddressJson(row.cc_json),
    bcc: parseAddressJson(row.bcc_json),
    subject: toOptionalString(row.subject),
    bodyText: toOptionalString(row.body_text),
    bodyHtml: toOptionalString(row.body_html),
    rawMime: toOptionalString(row.raw_mime),
    attachments: listOutboxAttachments(toNumber(row.outbox_id)),
    sentAt: toOptionalString(row.sent_at),
    deletedAt: toOptionalString(row.deleted_at),
    lastError: toOptionalString(row.last_error),
    lastWarning: toOptionalString(row.last_warning),
    createdAt: toOptionalString(row.created_at),
    updatedAt: toOptionalString(row.updated_at)
  }
}

function listOutboxAttachments(outboxId: number): ComposeAttachment[] {
  const rows = getDatabase()
    .prepare<OutboxAttachmentRow>(
      `
      SELECT file_path, filename, mime_type, size_bytes
      FROM onemail_outbox_attachments
      WHERE outbox_id = :outboxId
      ORDER BY attachment_id ASC
      `
    )
    .all({ outboxId })

  return rows.map((row) => ({
    filePath: toOptionalString(row.file_path),
    filename: row.filename,
    mimeType: toOptionalString(row.mime_type),
    sizeBytes: toNumber(row.size_bytes)
  }))
}

function replaceOutboxAttachments(outboxId: number, attachments: ComposeAttachment[]): void {
  const db = getDatabase()
  db.prepare('DELETE FROM onemail_outbox_attachments WHERE outbox_id = :outboxId').run({ outboxId })

  const insert = db.prepare(
    `
    INSERT INTO onemail_outbox_attachments (
      outbox_id,
      source_kind,
      file_path,
      filename,
      mime_type,
      size_bytes
    )
    VALUES (
      :outboxId,
      'local_file',
      :filePath,
      :filename,
      :mimeType,
      :sizeBytes
    )
    `
  )

  for (const attachment of attachments) {
    if (!attachment.filePath) continue
    const sizeBytes =
      attachment.filePath && existsSync(attachment.filePath)
        ? statSync(attachment.filePath).size
        : 0
    insert.run({
      outboxId,
      filePath: attachment.filePath,
      filename: attachment.filename ?? basename(attachment.filePath),
      mimeType: attachment.mimeType ?? null,
      sizeBytes
    })
  }
}

function parseAddressJson(value: string): ComposeAddress[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => item as Partial<ComposeAddress>)
      .filter(
        (item): item is ComposeAddress => typeof item.email === 'string' && item.email.length > 0
      )
  } catch {
    return []
  }
}
