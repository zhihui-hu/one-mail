import type { MailFolderRole } from '../../shared/types'

export type ImapMailbox = {
  path: string
  name: string
  delimiter?: string
  role: MailFolderRole
  attributes: string[]
  selectable: boolean
}

export function parseImapMailboxList(response: string): ImapMailbox[] {
  const mailboxes: ImapMailbox[] = []

  for (const line of response.split(/\r?\n/)) {
    const mailbox = parseListLine(line.trim())
    if (mailbox) mailboxes.push(mailbox)
  }

  return uniqueMailboxes(mailboxes)
}

function parseListLine(line: string): ImapMailbox | null {
  const match = /^\* LIST \(([^)]*)\) (?:(NIL)|"([^"]*)") (.+)$/i.exec(line)
  if (!match) return null

  const path = parseImapString(match[4])
  if (!path) return null

  const displayPath = decodeModifiedUtf7(path)
  const attributes = match[1]
    .split(/\s+/)
    .map((value) => value.replace(/^\\/, ''))
    .filter(Boolean)
  const role = detectMailboxRole(displayPath, attributes)

  return {
    path,
    name: getMailboxDisplayName(displayPath, match[3]),
    delimiter: match[2] ? undefined : (match[3] ?? undefined),
    attributes,
    role,
    selectable: !hasAttribute(attributes, 'Noselect')
  }
}

function detectMailboxRole(path: string, attributes: string[]): MailFolderRole {
  const attributeRoles: Record<string, MailFolderRole> = {
    inbox: 'inbox',
    junk: 'junk',
    spam: 'junk',
    sent: 'sent',
    drafts: 'drafts',
    trash: 'trash',
    archive: 'archive',
    all: 'all_mail',
    allmail: 'all_mail',
    important: 'important',
    flagged: 'starred',
    starred: 'starred'
  }

  for (const attribute of attributes) {
    const role = attributeRoles[normalizeAttribute(attribute)]
    if (role) return role
  }

  const normalizedPath = normalizeMailboxPath(path)
  const roleNames: Partial<Record<MailFolderRole, string[]>> = {
    inbox: ['inbox', '收件箱'],
    junk: ['junk', 'spam', 'bulk mail', 'junk email', 'junk e-mail', '垃圾邮件', '垃圾邮箱'],
    sent: ['sent', 'sent mail', 'sent messages', '已发送', '已发送邮件', '寄件备份'],
    drafts: ['drafts', 'draft', '草稿', '草稿箱'],
    trash: ['trash', 'deleted messages', 'deleted items', 'deleted', 'bin', '废纸篓', '已删除'],
    archive: ['archive', 'archives', '归档'],
    all_mail: ['all mail', 'all', '所有邮件'],
    important: ['important', '重要'],
    starred: ['starred', 'flagged', '星标']
  }

  for (const [role, names] of Object.entries(roleNames) as Array<[MailFolderRole, string[]]>) {
    if (
      names.some(
        (name) =>
          normalizedPath === name ||
          normalizedPath.endsWith(`/${name}`) ||
          normalizedPath.endsWith(`.${name}`)
      )
    ) {
      return role
    }
  }

  return 'custom'
}

function getMailboxDisplayName(path: string, delimiter?: string): string {
  const parts = delimiter ? path.split(delimiter) : path.split(/[/.]/)
  return parts.filter(Boolean).at(-1)?.trim() || path
}

function parseImapString(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || /^NIL$/i.test(trimmed)) return undefined
  if (!trimmed.startsWith('"')) return trimmed

  let result = ''
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '"') return result
    if (char === '\\' && index + 1 < trimmed.length) {
      index += 1
      result += trimmed[index]
      continue
    }
    result += char
  }

  return result
}

function hasAttribute(attributes: string[], attributeName: string): boolean {
  return attributes.some((attribute) => attribute.toLowerCase() === attributeName.toLowerCase())
}

function normalizeAttribute(value: string): string {
  return value
    .replace(/^\\/, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase()
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

function uniqueMailboxes(mailboxes: ImapMailbox[]): ImapMailbox[] {
  const seen = new Set<string>()
  return mailboxes.filter((mailbox) => {
    const key = mailbox.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function decodeModifiedUtf7(value: string): string {
  return value.replace(/&([^-]*)-/g, (match, encoded: string) => {
    if (encoded === '') return '&'

    try {
      return decodeUtf16BigEndian(Buffer.from(encoded.replace(/,/g, '/'), 'base64'))
    } catch {
      return match
    }
  })
}

function decodeUtf16BigEndian(buffer: Buffer): string {
  if (buffer.length % 2 !== 0) return ''

  let result = ''
  for (let index = 0; index < buffer.length; index += 2) {
    result += String.fromCharCode(buffer.readUInt16BE(index))
  }
  return result
}
