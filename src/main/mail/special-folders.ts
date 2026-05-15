import { getDatabase, toBoolean, toNumber, toOptionalString, type SqliteRow } from '../db/connection'

export type SpecialFolderRole = 'inbox' | 'junk' | 'sent' | 'drafts' | 'trash' | 'archive'

export type SpecialFolder = {
  folderId: number
  accountId: number
  path: string
  name: string
  delimiter?: string
  role: SpecialFolderRole | 'all_mail' | 'important' | 'starred' | 'custom'
  attributes: string[]
  selectable: boolean
}

type FolderRow = SqliteRow & {
  folder_id: number
  account_id: number
  path: string
  name: string
  delimiter: string | null
  role: SpecialFolder['role']
  attributes_json: string
  is_selectable: number
}

const ATTRIBUTE_ROLE_MAP: Record<string, SpecialFolderRole | 'all_mail'> = {
  inbox: 'inbox',
  junk: 'junk',
  spam: 'junk',
  sent: 'sent',
  drafts: 'drafts',
  trash: 'trash',
  archive: 'archive',
  all: 'all_mail',
  allmail: 'all_mail'
}

const ROLE_NAMES: Record<SpecialFolderRole, string[]> = {
  inbox: ['inbox', '收件箱'],
  junk: ['junk', 'spam', 'bulk mail', 'bulk', 'junk email', 'junk e-mail', '垃圾邮件', '垃圾邮件箱', '垃圾邮箱'],
  sent: ['sent', 'sent messages', 'sent mail', '已发送', '已发送邮件', '寄件备份', '寄件匣'],
  drafts: ['drafts', 'draft', '草稿', '草稿箱'],
  trash: ['trash', 'deleted messages', 'deleted items', 'deleted', 'bin', '废纸篓', '已删除', '已删除邮件', '垃圾桶'],
  archive: ['archive', 'archives', 'all mail', 'all', '归档', '所有邮件']
}

export function detectSpecialFolderRole(
  path: string,
  attributes: string[] = []
): SpecialFolder['role'] {
  for (const attribute of attributes) {
    const role = ATTRIBUTE_ROLE_MAP[normalizeAttribute(attribute)]
    if (role) return role
  }

  const normalizedPath = normalizeMailboxPath(path)
  if (normalizedPath === 'inbox') return 'inbox'

  for (const role of Object.keys(ROLE_NAMES) as SpecialFolderRole[]) {
    if (matchesRoleName(normalizedPath, role)) return role
  }

  return 'custom'
}

export function isFolderRole(
  folder: Pick<SpecialFolder, 'path' | 'name' | 'attributes' | 'role'>,
  role: SpecialFolderRole
): boolean {
  return folder.role === role || detectSpecialFolderRole(folder.path || folder.name, folder.attributes) === role
}

export function findFolderByRole(
  accountId: number,
  role: SpecialFolderRole
): SpecialFolder | null {
  const rows = getDatabase()
    .prepare<FolderRow>(
      `
      SELECT
        folder_id,
        account_id,
        path,
        name,
        delimiter,
        role,
        attributes_json,
        is_selectable
      FROM onemail_mail_folders
      WHERE account_id = :accountId
      ORDER BY
        CASE role
          WHEN :role THEN 0
          WHEN 'custom' THEN 2
          ELSE 1
        END,
        sort_order ASC,
        folder_id ASC
      `
    )
    .all({ accountId, role })

  for (const row of rows) {
    const folder = mapFolderRow(row)
    if (isFolderRole(folder, role)) return folder
  }

  return null
}

function matchesRoleName(normalizedPath: string, role: SpecialFolderRole): boolean {
  return ROLE_NAMES[role].some((name) => {
    const normalizedName = normalizeMailboxPath(name)
    return normalizedPath === normalizedName || normalizedPath.endsWith(`/${normalizedName}`)
  })
}

function normalizeAttribute(value: string): string {
  return value.replace(/^\\/, '').replace(/[\s_-]/g, '').toLowerCase()
}

function normalizeMailboxPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .toLowerCase()
}

function mapFolderRow(row: FolderRow): SpecialFolder {
  return {
    folderId: toNumber(row.folder_id),
    accountId: toNumber(row.account_id),
    path: row.path,
    name: row.name,
    delimiter: toOptionalString(row.delimiter),
    role: row.role,
    attributes: parseAttributes(row.attributes_json),
    selectable: toBoolean(row.is_selectable)
  }
}

function parseAttributes(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
