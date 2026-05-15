import { basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

export type ComposeAddress = {
  name?: string
  email: string
}

export type ComposeAttachment = {
  filename?: string
  mimeType?: string
  contentId?: string
  filePath?: string
  content?: Buffer
  sizeBytes?: number
}

export type PlainTextMessageInput = {
  from: ComposeAddress
  to: ComposeAddress[]
  cc?: ComposeAddress[]
  bcc?: ComposeAddress[]
  subject?: string
  bodyText?: string
  messageId?: string
  date?: Date
  inReplyTo?: string
  references?: string
  attachments?: ComposeAttachment[]
}

export type ComposedMessage = {
  messageId: string
  date: Date
  rawMime: string
}

const MAX_HEADER_LINE_LENGTH = 76
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

export function composePlainTextMessage(input: PlainTextMessageInput): ComposedMessage {
  validateAddressList('To', input.to)
  validateAddressList('Cc', input.cc ?? [])
  validateAddressList('Bcc', input.bcc ?? [])

  if (!input.from.email.trim()) {
    throw new Error('发件人邮箱不能为空。')
  }

  const date = input.date ?? new Date()
  const messageId = input.messageId ?? createMessageId(input.from.email)
  const attachments = materializeAttachments(input.attachments ?? [])
  const headers: Array<[string, string]> = [
    ['Message-ID', sanitizeHeaderValue(messageId)],
    ['Date', date.toUTCString()],
    ['From', formatAddress(input.from)],
    ['To', formatAddressList(input.to)],
    ...optionalAddressHeader('Cc', input.cc),
    ...optionalAddressHeader('Bcc', input.bcc),
    ['Subject', encodeHeaderValue(input.subject?.trim() || '(no subject)')],
    ...optionalHeader('In-Reply-To', input.inReplyTo),
    ...optionalHeader('References', input.references),
    ['MIME-Version', '1.0']
  ]

  if (attachments.length === 0) {
    headers.push(['Content-Type', 'text/plain; charset=utf-8'])
    headers.push(['Content-Transfer-Encoding', 'quoted-printable'])

    return {
      messageId,
      date,
      rawMime: `${formatHeaders(headers)}\r\n${encodeQuotedPrintable(input.bodyText ?? '')}`
    }
  }

  const boundary = `onemail-${randomBytes(18).toString('hex')}`
  headers.push(['Content-Type', `multipart/mixed; boundary="${boundary}"`])

  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      encodeQuotedPrintable(input.bodyText ?? '')
    ].join('\r\n'),
    ...attachments.map((attachment) => formatAttachmentPart(boundary, attachment)),
    `--${boundary}--`
  ]

  return {
    messageId,
    date,
    rawMime: `${formatHeaders(headers)}\r\n${parts.join('\r\n')}`
  }
}

export function createMessageId(email: string): string {
  const domain = email.split('@').at(1)?.replace(/[<>\s]/g, '') || 'onemail.local'
  return `<${Date.now()}.${randomBytes(12).toString('hex')}@${domain}>`
}

export function normalizeSubjectPrefix(subject: string | undefined, prefix: 'Re' | 'Fwd'): string {
  const value = subject?.trim() || '(no subject)'
  const pattern = prefix === 'Re' ? /^(re)\s*:/i : /^(fwd|fw)\s*:/i
  return pattern.test(value) ? value : `${prefix}: ${value}`
}

export function normalizeMessageId(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const withoutBreaks = sanitizeHeaderValue(trimmed)
  return withoutBreaks.startsWith('<') && withoutBreaks.endsWith('>')
    ? withoutBreaks
    : `<${withoutBreaks.replace(/^<|>$/g, '')}>`
}

export function buildReferencesHeader(
  existingReferences?: string | null,
  parentMessageId?: string | null
): string | undefined {
  const values = [...parseMessageIdList(existingReferences), normalizeMessageId(parentMessageId)]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.findIndex((item) => item === value) === index)

  const tail = values.slice(-20)
  return tail.length > 0 ? tail.join(' ') : undefined
}

export function dedupeAddresses(addresses: ComposeAddress[]): ComposeAddress[] {
  const seen = new Set<string>()
  const result: ComposeAddress[] = []

  for (const address of addresses) {
    const normalized = normalizeEmail(address.email)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push({ name: address.name?.trim() || undefined, email: address.email.trim() })
  }

  return result
}

export function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function validateAddressList(label: string, addresses: ComposeAddress[]): void {
  for (const address of addresses) {
    if (!address.email.trim()) throw new Error(`${label} 包含空邮箱地址。`)
    sanitizeHeaderValue(address.email)
    if (address.name) sanitizeHeaderValue(address.name)
  }
}

function optionalAddressHeader(
  name: string,
  addresses?: ComposeAddress[]
): Array<[string, string]> {
  return addresses && addresses.length > 0 ? [[name, formatAddressList(addresses)]] : []
}

function optionalHeader(name: string, value?: string): Array<[string, string]> {
  const normalized = sanitizeHeaderValue(value ?? '')
  return normalized ? [[name, normalized]] : []
}

function formatHeaders(headers: Array<[string, string]>): string {
  return `${headers.map(([name, value]) => foldHeader(`${name}: ${value}`)).join('\r\n')}\r\n`
}

function formatAddressList(addresses: ComposeAddress[]): string {
  return dedupeAddresses(addresses).map(formatAddress).join(', ')
}

function formatAddress(address: ComposeAddress): string {
  const email = sanitizeHeaderValue(address.email.trim())
  const name = address.name?.trim()
  if (!name) return `<${email}>`
  return `${encodeHeaderValue(name)} <${email}>`
}

function sanitizeHeaderValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error('邮件头包含非法换行字符。')
  }

  return value.trim()
}

function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderValue(value)
  if (/^[\x20-\x7e]*$/.test(clean)) return clean
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

function foldHeader(line: string): string {
  if (line.length <= MAX_HEADER_LINE_LENGTH) return line

  const chunks: string[] = []
  let remaining = line
  while (remaining.length > MAX_HEADER_LINE_LENGTH) {
    let splitAt = remaining.lastIndexOf(' ', MAX_HEADER_LINE_LENGTH)
    if (splitAt <= 0) splitAt = MAX_HEADER_LINE_LENGTH
    chunks.push(remaining.slice(0, splitAt))
    remaining = ` ${remaining.slice(splitAt).trimStart()}`
  }
  chunks.push(remaining)
  return chunks.join('\r\n')
}

function encodeQuotedPrintable(value: string): string {
  return value
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map(encodeQuotedPrintableLine)
    .join('\r\n')
}

function encodeQuotedPrintableLine(line: string): string {
  let encoded = ''
  for (const byte of Buffer.from(line, 'utf8')) {
    if ((byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126)) {
      encoded += String.fromCharCode(byte)
    } else if (byte === 9 || byte === 32) {
      encoded += String.fromCharCode(byte)
    } else {
      encoded += `=${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }

  encoded = encoded.replace(/[ \t]$/g, (char) =>
    `=${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  )

  const chunks: string[] = []
  let remaining = encoded
  while (remaining.length > 76) {
    chunks.push(`${remaining.slice(0, 75)}=`)
    remaining = remaining.slice(75)
  }
  chunks.push(remaining)
  return chunks.join('\r\n')
}

function materializeAttachments(attachments: ComposeAttachment[]): Required<ComposeAttachment>[] {
  const materialized = attachments.map((attachment) => {
    const content = attachment.content ?? readAttachmentFile(attachment)
    const filename = sanitizeHeaderValue(attachment.filename ?? basename(attachment.filePath ?? 'attachment'))

    return {
      filename,
      mimeType: sanitizeHeaderValue(attachment.mimeType ?? 'application/octet-stream'),
      contentId: sanitizeHeaderValue(attachment.contentId ?? ''),
      filePath: attachment.filePath ?? '',
      content,
      sizeBytes: content.length
    }
  })
  const totalBytes = materialized.reduce((sum, attachment) => sum + attachment.content.length, 0)
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('附件总大小超过 25MB，请减少附件后再发送。')
  }

  return materialized
}

function readAttachmentFile(attachment: ComposeAttachment): Buffer {
  if (!attachment.filePath) throw new Error('附件缺少文件路径。')
  const stat = statSync(attachment.filePath)
  if (!stat.isFile()) throw new Error(`附件不是普通文件：${attachment.filePath}`)
  return readFileSync(attachment.filePath)
}

function formatAttachmentPart(
  boundary: string,
  attachment: Required<ComposeAttachment>
): string {
  const encodedName = encodeHeaderValue(attachment.filename)
  const headers = [
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}; name="${encodedName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${encodedName}"`,
    ...(attachment.contentId ? [`Content-ID: <${attachment.contentId.replace(/^<|>$/g, '')}>`] : []),
    '',
    attachment.content.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd()
  ]

  return headers.join('\r\n')
}

function parseMessageIdList(value?: string | null): string[] {
  if (!value) return []
  return Array.from(value.matchAll(/<[^<>\s]+>/g), (match) => normalizeMessageId(match[0]))
    .filter((item): item is string => Boolean(item))
}
