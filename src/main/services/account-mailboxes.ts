import type { AccountMailFolder } from '../../shared/types'
import { getDatabase, toBoolean, type SqliteRow } from '../db/connection'
import { getAccount } from '../db/repositories/account.repository'
import { authenticateImapSession } from '../mail/imap-auth'
import { SimpleImapSession } from '../mail/imap-session'
import type { ImapMailbox } from '../mail/imap-mailboxes'

type StoredFolderRow = SqliteRow & {
  folder_id: number
  path: string
  sync_enabled: number
}

export async function discoverAccountMailFolders(accountId: number): Promise<AccountMailFolder[]> {
  const mailboxes = await listRemoteMailboxes(accountId)
  return applyStoredSelection(accountId, mailboxes)
}

export async function updateAccountFolderSelection(
  accountId: number,
  selectedFolderPaths: string[]
): Promise<AccountMailFolder[]> {
  const mailboxes = await listRemoteMailboxes(accountId)
  const selectable = mailboxes.filter((mailbox) => mailbox.selectable)
  const pathsByKey = new Map(
    selectable.map((mailbox) => [normalizePath(mailbox.path), mailbox.path])
  )
  const requestedKeys = new Set(selectedFolderPaths.map(normalizePath).filter(Boolean))
  const inbox = selectable.find((mailbox) => mailbox.role === 'inbox')

  if (!inbox) throw new Error('IMAP 服务器未返回可选择的 INBOX。')
  requestedKeys.add(normalizePath(inbox.path))

  for (const key of requestedKeys) {
    if (!pathsByKey.has(key)) throw new Error(`文件夹已不存在或不可选择：${key}`)
  }

  persistFolderSelection(accountId, mailboxes, requestedKeys)
  return applyStoredSelection(accountId, mailboxes)
}

export function getSelectedFolderPathKeys(accountId: number): Set<string> {
  const rows = getDatabase()
    .prepare<{ path: string }>(
      `
      SELECT path
      FROM onemail_mail_folders
      WHERE account_id = :accountId AND sync_enabled = 1
      `
    )
    .all({ accountId })

  return new Set(rows.map((row) => normalizePath(row.path)))
}

async function listRemoteMailboxes(accountId: number): Promise<ImapMailbox[]> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  const session = await SimpleImapSession.connect(account, 'F')
  try {
    await authenticateImapSession(account, session)
    return (await session.listMailboxes()).sort(compareMailboxes)
  } finally {
    await session.logout().catch(() => undefined)
  }
}

function applyStoredSelection(accountId: number, mailboxes: ImapMailbox[]): AccountMailFolder[] {
  const storedRows = getDatabase()
    .prepare<StoredFolderRow>(
      `
      SELECT folder_id, path, sync_enabled
      FROM onemail_mail_folders
      WHERE account_id = :accountId
      `
    )
    .all({ accountId })
  const selectedKeys = new Set(
    storedRows.filter((row) => toBoolean(row.sync_enabled)).map((row) => normalizePath(row.path))
  )
  const hasSelection = selectedKeys.size > 0

  return mailboxes.map((mailbox) => ({
    ...mailbox,
    selected:
      mailbox.selectable &&
      (mailbox.role === 'inbox' || (hasSelection && selectedKeys.has(normalizePath(mailbox.path))))
  }))
}

function persistFolderSelection(
  accountId: number,
  mailboxes: ImapMailbox[],
  selectedKeys: Set<string>
): void {
  const db = getDatabase()
  const existingRows = db
    .prepare<StoredFolderRow>(
      `SELECT folder_id, path, sync_enabled FROM onemail_mail_folders WHERE account_id = :accountId`
    )
    .all({ accountId })
  const existingByKey = new Map(existingRows.map((row) => [normalizePath(row.path), row]))
  const remoteKeys = new Set(mailboxes.map((mailbox) => normalizePath(mailbox.path)))

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of existingRows) {
      if (!remoteKeys.has(normalizePath(row.path))) {
        db.prepare('DELETE FROM onemail_mail_folders WHERE folder_id = :folderId').run({
          folderId: row.folder_id
        })
      }
    }

    for (const [index, mailbox] of mailboxes.entries()) {
      const key = normalizePath(mailbox.path)
      const selected = mailbox.selectable && selectedKeys.has(key)
      const existing = existingByKey.get(key)
      const values = {
        accountId,
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter ?? null,
        role: mailbox.role,
        attributesJson: JSON.stringify(mailbox.attributes),
        selectable: mailbox.selectable ? 1 : 0,
        syncEnabled: selected ? 1 : 0,
        sortOrder: folderSortOrder(mailbox.role, index)
      }

      if (existing) {
        db.prepare(
          `
          UPDATE onemail_mail_folders
          SET path = :path,
              name = :name,
              delimiter = :delimiter,
              role = :role,
              attributes_json = :attributesJson,
              is_selectable = :selectable,
              sync_enabled = :syncEnabled,
              total_count = CASE WHEN :syncEnabled = 0 THEN 0 ELSE total_count END,
              unread_count = CASE WHEN :syncEnabled = 0 THEN 0 ELSE unread_count END,
              sort_order = :sortOrder,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE folder_id = :folderId
          `
        ).run({ ...values, folderId: existing.folder_id })

        if (!selected) clearFolderCache(existing.folder_id)
        continue
      }

      db.prepare(
        `
        INSERT INTO onemail_mail_folders (
          account_id, path, name, delimiter, role, attributes_json,
          is_selectable, sync_enabled, sort_order
        )
        VALUES (
          :accountId, :path, :name, :delimiter, :role, :attributesJson,
          :selectable, :syncEnabled, :sortOrder
        )
        `
      ).run(values)
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function clearFolderCache(folderId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM onemail_mail_messages WHERE folder_id = :folderId').run({ folderId })
  db.prepare('DELETE FROM onemail_folder_sync_states WHERE folder_id = :folderId').run({ folderId })
}

function compareMailboxes(left: ImapMailbox, right: ImapMailbox): number {
  const order = folderSortOrder(left.role, 0) - folderSortOrder(right.role, 0)
  return order || left.name.localeCompare(right.name)
}

function folderSortOrder(role: ImapMailbox['role'], index: number): number {
  const roleOrder: Partial<Record<ImapMailbox['role'], number>> = {
    inbox: 10,
    starred: 20,
    important: 30,
    sent: 40,
    drafts: 50,
    archive: 60,
    all_mail: 70,
    junk: 80,
    trash: 90
  }
  return roleOrder[role] ?? 100 + index
}

function normalizePath(path: string): string {
  return path.trim().toLocaleLowerCase('en-US')
}
