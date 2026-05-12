import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, type SqliteParams } from '../db/connection'
import { normalizeMailDisplayText } from '../../shared/mail-text'
import { authenticateImapSession } from './imap-auth'

type TestSocket = Socket | TLSSocket

type ImapAccount = NonNullable<ReturnType<typeof getAccount>>

type FetchedHeader = {
  uid: number
  flags: string
  internalDate?: string
  sizeBytes: number
  header: string
}

type FetchedFlags = {
  uid: number
  flags: string
}

type KnownMessageUidRow = {
  uid: number
}

type ParsedHeader = {
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  rfc822MessageId?: string
}

type MailboxStatus = {
  totalCount?: number
  unreadCount?: number
  uidNext?: number
  uidValidity?: string
}

type SyncCursor = {
  folderId: number
  lastInternalDate?: string
}

const CONNECTION_TIMEOUT_MS = 15000
const HEADER_FETCH_BATCH_SIZE = 100

export async function syncAccountMailbox(accountId: number): Promise<{
  scannedCount: number
  insertedCount: number
  updatedCount: number
}> {
  const account = getAccount(accountId)
  if (!account) {
    throw new Error(`Account not found: ${accountId}`)
  }

  const client = await ImapSession.connect(account)

  try {
    await authenticateImapSession(account, client)
    await client.identifyClient()
    const mailboxStatus = await client.statusInbox().catch(() => null)
    if (mailboxStatus) persistMailboxStatus(account.accountId, mailboxStatus)

    await client.selectInbox()
    const cursor = getInboxSyncCursor(account.accountId)
    const isIncremental = Boolean(cursor.lastInternalDate)
    const uids = cursor.lastInternalDate
      ? await client.searchSince(new Date(cursor.lastInternalDate))
      : await client.searchAll()
    const existingUids = getExistingUids(account.accountId, cursor.folderId, uids)
    const newUids = uids.filter((uid) => !existingUids.has(uid))
    const headers = await fetchHeadersInBatches(client, newUids)
    const knownUids = getKnownMessageUids(account.accountId, cursor.folderId)
    const flags = await fetchFlagsInBatches(client, knownUids)
    if (newUids.length > 0 && headers.length === 0) {
      throw new Error('IMAP 已找到邮件，但邮件头解析失败，未写入本地列表。')
    }

    return persistFetchedHeaders(account, headers, flags, uids, isIncremental, mailboxStatus)
  } finally {
    await client.logout().catch(() => undefined)
  }
}

class ImapSession {
  private tagIndex = 1

  private constructor(private socket: TestSocket) {}

  static async connect(account: ImapAccount): Promise<ImapSession> {
    const socket =
      account.imapSecurity === 'ssl_tls'
        ? connectTls({
            host: account.imapHost,
            port: account.imapPort,
            servername: account.imapHost,
            rejectUnauthorized: true
          })
        : connectTcp({
            host: account.imapHost,
            port: account.imapPort
          })

    const session = new ImapSession(socket)
    await session.waitForGreeting()

    if (account.imapSecurity === 'starttls' && socket instanceof Socket) {
      await session.command('STARTTLS')
      session.socket = await upgradeToTls(socket, account.imapHost)
    }

    return session
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quoteAtom(username)} ${quoteAtom(password)}`)
  }

  async authenticateXOAuth2(username: string, accessToken: string): Promise<void> {
    await this.command(`AUTHENTICATE XOAUTH2 ${formatXOAuth2Payload(username, accessToken)}`)
  }

  async identifyClient(): Promise<void> {
    await this.command(formatImapIdCommand()).catch(() => undefined)
  }

  async selectInbox(): Promise<void> {
    await this.command('SELECT "INBOX"')
  }

  async statusInbox(): Promise<MailboxStatus> {
    const response = await this.command('STATUS "INBOX" (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)')
    return parseStatusResponse(response)
  }

  async searchSince(date: Date): Promise<number[]> {
    const response = await this.command(`UID SEARCH SINCE ${formatImapDate(date)}`)
    return parseSearchUids(response)
  }

  async searchAll(): Promise<number[]> {
    const response = await this.command('UID SEARCH ALL')
    return parseSearchUids(response)
  }

  async fetchFlags(uids: number[]): Promise<FetchedFlags[]> {
    if (uids.length === 0) return []

    const uidSet = uids.join(',')
    const response = await this.command(`UID FETCH ${uidSet} (UID FLAGS)`)
    return parseFlagsResponse(response)
  }

  async fetchHeaders(uids: number[]): Promise<FetchedHeader[]> {
    if (uids.length === 0) return []

    const uidSet = uids.join(',')
    const response = await this.command(
      `UID FETCH ${uidSet} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID FROM SUBJECT DATE)])`
    )

    return parseFetchResponse(response)
  }

  async logout(): Promise<void> {
    await this.command('LOGOUT')
    this.socket.destroy()
  }

  private async waitForGreeting(): Promise<void> {
    await waitForLine(this.socket, (line) => {
      if (/^\*\s+OK\b/i.test(line)) return true
      if (/^\*\s+(NO|BAD|BYE)\b/i.test(line)) {
        throw new Error(`IMAP 服务器拒绝连接：${line}`)
      }
      return false
    })
  }

  private async command(command: string): Promise<string> {
    const tag = `A${String(this.tagIndex++).padStart(4, '0')}`
    await writeLine(this.socket, `${tag} ${command}`)
    const response = await readUntilTagged(this.socket, tag)
    const lastLine = response
      .trimEnd()
      .split(/\r?\n/)
      .findLast((line) => line.trimStart().startsWith(tag))

    if (!lastLine || !new RegExp(`^${tag}\\s+OK\\b`, 'i').test(lastLine.trimStart())) {
      throw new Error(formatImapCommandError(lastLine ?? command))
    }

    return response
  }
}

async function fetchHeadersInBatches(
  client: ImapSession,
  uids: number[]
): Promise<FetchedHeader[]> {
  const headers: FetchedHeader[] = []

  for (let index = uids.length; index > 0; index -= HEADER_FETCH_BATCH_SIZE) {
    const start = Math.max(0, index - HEADER_FETCH_BATCH_SIZE)
    const batch = uids.slice(start, index)
    headers.unshift(...(await client.fetchHeaders(batch)))
  }

  return headers
}

async function fetchFlagsInBatches(client: ImapSession, uids: number[]): Promise<FetchedFlags[]> {
  const flags: FetchedFlags[] = []

  for (let index = uids.length; index > 0; index -= HEADER_FETCH_BATCH_SIZE) {
    const start = Math.max(0, index - HEADER_FETCH_BATCH_SIZE)
    const batch = uids.slice(start, index)
    flags.unshift(...(await client.fetchFlags(batch)))
  }

  return flags
}

const CLIENT_ID = {
  name: 'OneMail',
  version: '1.0.0',
  vendor: 'OneMail',
  'support-email': 'support@onemail.local'
}

function formatImapIdCommand(): string {
  const values = Object.entries(CLIENT_ID).flatMap(([key, value]) => [key, value])
  return `ID (${values.map(quoteAtom).join(' ')})`
}

function formatImapCommandError(line: string): string {
  if (/Unsafe Login/i.test(line)) {
    return 'IMAP 命令失败：网易邮箱要求客户端发送 IMAP ID 身份信息，请重试或确认已开启 IMAP/SMTP 服务并使用授权码。'
  }

  return `IMAP 命令失败：${sanitizeImapResponse(line)}`
}

function parseSearchUids(response: string): number[] {
  const match = response.match(/^\* SEARCH\s+(.+)$/im)
  if (!match?.[1]) return []

  return match[1]
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
}

function parseFlagsResponse(response: string): FetchedFlags[] {
  const results: FetchedFlags[] = []

  for (const block of getFetchBlocks(response)) {
    const uid = Number(block.match(/\bUID\s+(\d+)/i)?.[1])
    if (!Number.isInteger(uid) || uid <= 0) continue

    results.push({
      uid,
      flags: block.match(/\bFLAGS\s+\(([^)]*)\)/i)?.[1] ?? ''
    })
  }

  return results
}

function parseStatusResponse(response: string): MailboxStatus {
  const match = response.match(/^\* STATUS\s+(?:"[^"]+"|\S+)\s+\(([^)]*)\)/im)
  const values = match?.[1] ?? ''

  return {
    totalCount: readStatusNumber(values, 'MESSAGES'),
    unreadCount: readStatusNumber(values, 'UNSEEN'),
    uidNext: readStatusNumber(values, 'UIDNEXT'),
    uidValidity: readStatusNumber(values, 'UIDVALIDITY')?.toString()
  }
}

function readStatusNumber(values: string, key: string): number | undefined {
  const match = new RegExp(`\\b${key}\\s+(\\d+)`, 'i').exec(values)
  const value = Number(match?.[1])
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

function sanitizeImapResponse(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function persistFetchedHeaders(
  account: ImapAccount,
  headers: FetchedHeader[],
  flags: FetchedFlags[],
  scannedUids: number[],
  isIncremental: boolean,
  mailboxStatus?: MailboxStatus | null
): { scannedCount: number; insertedCount: number; updatedCount: number } {
  const db = getDatabase()
  const folderId = ensureInboxFolder(account.accountId)
  let insertedCount = 0
  let updatedCount = 0

  const insertMessage = db.prepare(
    `
    INSERT INTO onemail_mail_messages (
      account_id,
      folder_id,
      uid,
      rfc822_message_id,
      subject,
      from_name,
      from_email,
      received_at,
      internal_date,
      snippet,
      size_bytes,
      is_read,
      is_starred,
      flags_json,
      body_status
    )
    VALUES (
      :accountId,
      :folderId,
      :uid,
      :rfc822MessageId,
      :subject,
      :fromName,
      :fromEmail,
      :receivedAt,
      :internalDate,
      :snippet,
      :sizeBytes,
      :isRead,
      :isStarred,
      :flagsJson,
      'none'
    )
    ON CONFLICT(account_id, folder_id, uid) DO UPDATE SET
      rfc822_message_id = excluded.rfc822_message_id,
      subject = excluded.subject,
      from_name = excluded.from_name,
      from_email = excluded.from_email,
      received_at = excluded.received_at,
      internal_date = excluded.internal_date,
      snippet = excluded.snippet,
      size_bytes = excluded.size_bytes,
      is_read = excluded.is_read,
      is_starred = excluded.is_starred,
      flags_json = excluded.flags_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `
  )

  const ensureSearch = db.prepare(
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
      ''
    )
    `
  )

  const deleteSearch = db.prepare(
    'DELETE FROM onemail_message_search WHERE message_id = :messageId'
  )
  const restoreMessage = db.prepare(
    `
    UPDATE onemail_mail_messages
    SET remote_deleted = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid AND remote_deleted = 1
    `
  )
  const updateFlags = db.prepare(
    `
    UPDATE onemail_mail_messages
    SET is_read = :isRead,
        is_starred = :isStarred,
        flags_json = :flagsJson,
        remote_deleted = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid
    `
  )

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const item of headers) {
      const existing = db
        .prepare<{ message_id: number }>(
          `
          SELECT message_id
          FROM onemail_mail_messages
          WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid
          `
        )
        .get({ accountId: account.accountId, folderId, uid: item.uid })?.message_id
      const parsed = parseHeader(item.header)
      const flags = parseFlags(item.flags)
      const params: SqliteParams = {
        accountId: account.accountId,
        folderId,
        uid: item.uid,
        rfc822MessageId: parsed.rfc822MessageId ?? null,
        subject: parsed.subject ?? null,
        fromName: parsed.fromName ?? null,
        fromEmail: parsed.fromEmail ?? null,
        receivedAt: parsed.receivedAt ?? item.internalDate ?? null,
        internalDate: item.internalDate ?? null,
        snippet: parsed.subject ?? '',
        sizeBytes: item.sizeBytes,
        isRead: hasFlag(flags, 'Seen') ? 1 : 0,
        isStarred: hasFlag(flags, 'Flagged') ? 1 : 0,
        flagsJson: JSON.stringify(Array.from(flags))
      }

      insertMessage.run(params)
      const messageId =
        existing ??
        db
          .prepare<{ message_id: number }>(
            `
            SELECT message_id
            FROM onemail_mail_messages
            WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid
            `
          )
          .get({ accountId: account.accountId, folderId, uid: item.uid })?.message_id

      if (messageId !== undefined) {
        deleteSearch.run({ messageId })
        ensureSearch.run({
          messageId,
          accountId: account.accountId,
          folderId,
          subject: parsed.subject ?? '',
          fromName: parsed.fromName ?? '',
          fromEmail: parsed.fromEmail ?? '',
          snippet: parsed.subject ?? ''
        })
      }

      restoreMessage.run({ accountId: account.accountId, folderId, uid: item.uid })

      if (existing) {
        updatedCount += 1
      } else {
        insertedCount += 1
      }
    }

    for (const item of flags) {
      const parsedFlags = parseFlags(item.flags)
      const result = updateFlags.run({
        accountId: account.accountId,
        folderId,
        uid: item.uid,
        isRead: hasFlag(parsedFlags, 'Seen') ? 1 : 0,
        isStarred: hasFlag(parsedFlags, 'Flagged') ? 1 : 0,
        flagsJson: JSON.stringify(Array.from(parsedFlags))
      })
      if (result.changes > 0) updatedCount += 1
    }

    if (!isIncremental) {
      markMissingMessagesDeleted(account.accountId, folderId, scannedUids)
    }
    refreshInboxSyncState(account.accountId, folderId, mailboxStatus)

    db.prepare(
      `
      UPDATE onemail_mail_accounts
      SET last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          last_error = NULL,
          status = 'active',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
      `
    ).run({ accountId: account.accountId })

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { scannedCount: scannedUids.length, insertedCount, updatedCount }
}

function persistMailboxStatus(accountId: number, status: MailboxStatus): void {
  const db = getDatabase()
  const folderId = ensureInboxFolder(accountId)

  db.prepare(
    `
    UPDATE onemail_mail_folders
    SET total_count = COALESCE(:totalCount, total_count),
        unread_count = COALESCE(:unreadCount, unread_count),
        uid_next = COALESCE(:uidNext, uid_next),
        uid_validity = COALESCE(:uidValidity, uid_validity),
        last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE folder_id = :folderId
    `
  ).run({
    folderId,
    totalCount: status.totalCount ?? null,
    unreadCount: status.unreadCount ?? null,
    uidNext: status.uidNext ?? null,
    uidValidity: status.uidValidity ?? null
  })
}

function getInboxSyncCursor(accountId: number): SyncCursor {
  const folderId = ensureInboxFolder(accountId)
  const row = getDatabase()
    .prepare<{ last_internal_date: string | null }>(
      `
      SELECT last_internal_date
      FROM onemail_folder_sync_states
      WHERE folder_id = :folderId
      `
    )
    .get({ folderId })

  return {
    folderId,
    lastInternalDate: row?.last_internal_date ?? undefined
  }
}

function getExistingUids(accountId: number, folderId: number, uids: number[]): Set<number> {
  const existing = new Set<number>()
  const db = getDatabase()

  for (const batch of chunkNumbers(uids, 900)) {
    const uidValues = batch.join(',')
    const rows = db
      .prepare<{ uid: number }>(
        `
        SELECT uid
        FROM onemail_mail_messages
        WHERE account_id = :accountId
          AND folder_id = :folderId
          AND uid IN (${uidValues})
        `
      )
      .all({ accountId, folderId })

    for (const row of rows) {
      existing.add(Number(row.uid))
    }
  }

  return existing
}

function getKnownMessageUids(accountId: number, folderId: number): number[] {
  const rows = getDatabase()
    .prepare<KnownMessageUidRow>(
      `
      SELECT uid
      FROM onemail_mail_messages
      WHERE account_id = :accountId
        AND folder_id = :folderId
        AND remote_deleted = 0
      ORDER BY uid ASC
      `
    )
    .all({ accountId, folderId })

  return rows.map((row) => Number(row.uid)).filter((uid) => Number.isInteger(uid) && uid > 0)
}

function chunkNumbers(values: number[], size: number): number[][] {
  const chunks: number[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

function markMissingMessagesDeleted(
  accountId: number,
  folderId: number,
  existingUids: number[]
): void {
  const db = getDatabase()

  db.exec('CREATE TEMP TABLE IF NOT EXISTS current_imap_uids (uid INTEGER PRIMARY KEY)')
  db.exec('DELETE FROM current_imap_uids')

  if (existingUids.length === 0) {
    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET remote_deleted = 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
        AND folder_id = :folderId
        AND remote_deleted = 0
      `
    ).run({ accountId, folderId })
    return
  }

  const insertUid = db.prepare('INSERT OR IGNORE INTO current_imap_uids (uid) VALUES (:uid)')
  for (const uid of existingUids) {
    insertUid.run({ uid })
  }

  db.prepare(
    `
    UPDATE onemail_mail_messages
    SET remote_deleted = 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE account_id = :accountId
      AND folder_id = :folderId
      AND remote_deleted = 0
      AND NOT EXISTS (
        SELECT 1
        FROM current_imap_uids
        WHERE current_imap_uids.uid = onemail_mail_messages.uid
      )
    `
  ).run({ accountId, folderId })
}

function refreshInboxSyncState(
  accountId: number,
  folderId: number,
  mailboxStatus?: MailboxStatus | null
): void {
  const db = getDatabase()
  const stats = db
    .prepare<{
      total_count: number
      unread_count: number
      last_uid: number | null
      last_internal_date: string | null
    }>(
      `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
        MAX(uid) AS last_uid,
        MAX(internal_date) AS last_internal_date
      FROM onemail_mail_messages
      WHERE account_id = :accountId
        AND folder_id = :folderId
        AND remote_deleted = 0
      `
    )
    .get({ accountId, folderId })

  const totalCount = mailboxStatus?.totalCount ?? Number(stats?.total_count ?? 0)
  const unreadCount = mailboxStatus?.unreadCount ?? Number(stats?.unread_count ?? 0)
  const lastUid = Number(stats?.last_uid ?? 0)

  db.prepare(
    `
    UPDATE onemail_mail_folders
    SET total_count = :totalCount,
        unread_count = :unreadCount,
        uid_next = COALESCE(:uidNext, uid_next),
        uid_validity = COALESCE(:uidValidity, uid_validity),
        last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE folder_id = :folderId
    `
  ).run({
    folderId,
    totalCount,
    unreadCount,
    uidNext: mailboxStatus?.uidNext ?? null,
    uidValidity: mailboxStatus?.uidValidity ?? null
  })

  db.prepare(
    `
    INSERT INTO onemail_folder_sync_states (
      folder_id,
      account_id,
      last_uid,
      last_internal_date,
      uid_validity,
      last_full_scan_at,
      last_success_at,
      status
    )
    VALUES (
      :folderId,
      :accountId,
      :lastUid,
      :lastInternalDate,
      :uidValidity,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      'idle'
    )
    ON CONFLICT(folder_id) DO UPDATE SET
      last_uid = excluded.last_uid,
      last_internal_date = excluded.last_internal_date,
      uid_validity = COALESCE(excluded.uid_validity, uid_validity),
      last_full_scan_at = excluded.last_full_scan_at,
      last_success_at = excluded.last_success_at,
      last_error = NULL,
      status = 'idle',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `
  ).run({
    folderId,
    accountId,
    lastUid,
    lastInternalDate: stats?.last_internal_date ?? null,
    uidValidity: mailboxStatus?.uidValidity ?? null
  })
}

function ensureInboxFolder(accountId: number): number {
  const db = getDatabase()
  const existing = db
    .prepare<{ folder_id: number }>(
      `
      SELECT folder_id
      FROM onemail_mail_folders
      WHERE account_id = :accountId AND path = 'INBOX'
      `
    )
    .get({ accountId })

  if (existing) return Number(existing.folder_id)

  const result = db
    .prepare(
      `
      INSERT INTO onemail_mail_folders (
        account_id,
        path,
        name,
        role,
        sync_enabled
      )
      VALUES (
        :accountId,
        'INBOX',
        '收件箱',
        'inbox',
        1
      )
      `
    )
    .run({ accountId })

  return Number(result.lastInsertRowid)
}

function parseFetchResponse(response: string): FetchedHeader[] {
  const results: FetchedHeader[] = []

  for (const block of getFetchBlocks(response)) {
    const header = extractHeaderLiteral(block)
    const uid = Number(block.match(/\bUID\s+(\d+)/i)?.[1])
    if (!Number.isInteger(uid) || uid <= 0) continue
    if (!header) continue

    results.push({
      uid,
      flags: block.match(/\bFLAGS\s+\(([^)]*)\)/i)?.[1] ?? '',
      internalDate: parseImapInternalDate(block.match(/\bINTERNALDATE\s+"([^"]+)"/i)?.[1]),
      sizeBytes: Number(block.match(/\bRFC822\.SIZE\s+(\d+)/i)?.[1] ?? 0),
      header
    })
  }

  return results
}

function getFetchBlocks(response: string): string[] {
  const starts: number[] = []
  const pattern = /(?:^|\r?\n)\* \d+ FETCH \(/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(response))) {
    const linePrefixLength = match[0].startsWith('\r\n') ? 2 : match[0].startsWith('\n') ? 1 : 0
    starts.push(match.index + linePrefixLength)
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? findTaggedLineIndex(response, start)
    return response.slice(start, end).trimEnd()
  })
}

function findTaggedLineIndex(response: string, start: number): number {
  const match = /\r?\nA\d+\s+(OK|NO|BAD)\b/i.exec(response.slice(start))
  return match ? start + match.index : response.length
}

function extractHeaderLiteral(fetchBlock: string): string {
  const literalPattern =
    /BODY\[[^\]]*HEADER(?:\.FIELDS(?:\.NOT)?[^\]]*)?\](?:<\d+>)?\s+\{(\d+)\}\r?\n/i
  const match = literalPattern.exec(fetchBlock)
  const byteLength = Number(match?.[1])
  if (!match || !Number.isInteger(byteLength) || byteLength < 0) return ''

  const headerStart = match.index + match[0].length
  const header = sliceUtf8Literal(fetchBlock, headerStart, byteLength)
  if (header) return header

  const closingIndex = fetchBlock.indexOf('\r\n)', headerStart)
  return fetchBlock.slice(headerStart, closingIndex === -1 ? undefined : closingIndex)
}

function sliceUtf8Literal(value: string, start: number, byteLength: number): string {
  let end = start
  let remainingBytes = byteLength

  while (end < value.length && remainingBytes > 0) {
    const codePoint = value.codePointAt(end)
    if (codePoint === undefined) break

    const char = String.fromCodePoint(codePoint)
    const charByteLength = Buffer.byteLength(char, 'utf8')
    if (charByteLength > remainingBytes) break

    remainingBytes -= charByteLength
    end += char.length
  }

  return value.slice(start, end)
}

function parseHeader(header: string): ParsedHeader {
  const headers = new Map<string, string>()
  let currentKey = ''

  for (const line of header.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`.trim())
      continue
    }

    const index = line.indexOf(':')
    if (index <= 0) continue

    currentKey = line.slice(0, index).trim().toLowerCase()
    headers.set(currentKey, line.slice(index + 1).trim())
  }

  const from = parseAddress(headers.get('from'))
  const date = headers.get('date')

  return {
    subject: normalizeMailDisplayText(headers.get('subject')),
    fromName: from.name,
    fromEmail: from.email,
    receivedAt: date ? parseDateHeader(date) : undefined,
    rfc822MessageId: headers.get('message-id')
  }
}

function parseAddress(value?: string): { name?: string; email?: string } {
  const decodedValue = normalizeMailDisplayText(value)
  if (!decodedValue) return {}

  const match = decodedValue.match(/^(.*?)<([^>]+)>/)
  if (!match) {
    return { email: decodedValue.trim() }
  }

  const name = match[1]?.trim().replace(/^"|"$/g, '')
  const email = match[2]?.trim()

  return {
    name: name || email,
    email
  }
}

function parseFlags(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map((flag) => flag.replace(/^\\/, ''))
      .filter(Boolean)
  )
}

function hasFlag(flags: Set<string>, flagName: string): boolean {
  for (const flag of flags) {
    if (flag.toLowerCase() === flagName.toLowerCase()) return true
  }

  return false
}

function parseDateHeader(value: string): string | undefined {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function parseImapInternalDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatImapDate(date: Date): string {
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ][date.getUTCMonth()]
  return `${date.getUTCDate()}-${month}-${date.getUTCFullYear()}`
}

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatXOAuth2Payload(username: string, accessToken: string): string {
  return Buffer.from(`user=${username}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8').toString(
    'base64'
  )
}

function upgradeToTls(socket: Socket, servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = connectTls({ socket, servername, rejectUnauthorized: true })
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('STARTTLS 握手超时，请检查服务器安全模式。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      tlsSocket.off('secureConnect', handleSecureConnect)
      tlsSocket.off('error', handleError)
    }

    function handleSecureConnect(): void {
      cleanup()
      resolve(tlsSocket)
    }

    function handleError(error: Error): void {
      cleanup()
      reject(error)
    }

    tlsSocket.once('secureConnect', handleSecureConnect)
    tlsSocket.once('error', handleError)
  })
}

function waitForLine(socket: TestSocket, isDone: (line: string) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器未返回有效响应。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      try {
        for (const line of lines) {
          if (isDone(line.trim())) {
            cleanup()
            resolve()
            return
          }
        }
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error('IMAP 响应解析失败。'))
      }
    }

    function handleError(error: Error): void {
      cleanup()
      reject(error)
    }

    function handleClose(): void {
      cleanup()
      reject(new Error('IMAP 连接已断开。'))
    }

    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function readUntilTagged(socket: TestSocket, tag: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器响应超时。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')

      if (new RegExp(`(^|\\r?\\n)${tag}\\s+(OK|NO|BAD)\\b`, 'i').test(buffer)) {
        cleanup()
        resolve(buffer)
      }
    }

    function handleError(error: Error): void {
      cleanup()
      reject(error)
    }

    function handleClose(): void {
      cleanup()
      reject(new Error('IMAP 连接已断开。'))
    }

    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function writeLine(socket: TestSocket, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
