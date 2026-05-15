import { getAccount } from '../db/repositories/account.repository'
import { getMessageComposeSource, type MessageComposeSource } from '../db/repositories/message.repository'
import { loadMessageBodyFromImap } from './body-loader'
import {
  buildReferencesHeader,
  dedupeAddresses,
  normalizeEmail,
  normalizeMessageId,
  normalizeSubjectPrefix,
  type ComposeAddress
} from './message-composer'

export type ReplyMode = 'reply' | 'reply_all'

export type ReplyDraft = {
  accountId: number
  relatedMessageId: number
  composeKind: ReplyMode
  to: ComposeAddress[]
  cc: ComposeAddress[]
  bcc: ComposeAddress[]
  subject: string
  bodyText: string
  inReplyTo?: string
  references?: string
}

export async function createReplyDraft(
  messageId: number,
  mode: ReplyMode = 'reply'
): Promise<ReplyDraft> {
  let source = getMessageComposeSource(messageId)
  if (!source) throw new Error('原邮件不存在或已从远端删除。')

  if (!source.bodyText) {
    await loadMessageBodyFromImap(messageId).catch(() => undefined)
    source = getMessageComposeSource(messageId)
    if (!source) throw new Error('原邮件不存在或已从远端删除。')
  }

  const account = getAccount(source.accountId)
  if (!account) throw new Error(`Account not found: ${source.accountId}`)

  const ownEmail = normalizeEmail(account.email)
  const to =
    mode === 'reply'
      ? replyRecipients(source, ownEmail)
      : replyAllRecipients(source, ownEmail).to
  const cc = mode === 'reply_all' ? replyAllRecipients(source, ownEmail).cc : []
  const parentMessageId = normalizeMessageId(source.rfc822MessageId)

  return {
    accountId: source.accountId,
    relatedMessageId: messageId,
    composeKind: mode,
    to,
    cc,
    bcc: [],
    subject: normalizeSubjectPrefix(source.subject, 'Re'),
    bodyText: buildReplyBody(source),
    inReplyTo: parentMessageId,
    references: buildReferencesHeader(source.referencesHeader, parentMessageId)
  }
}

function replyRecipients(source: MessageComposeSource, ownEmail: string): ComposeAddress[] {
  const preferred = source.addresses.reply_to.length > 0 ? source.addresses.reply_to : fromAddress(source)
  return dedupeAddresses(preferred).filter((address) => normalizeEmail(address.email) !== ownEmail)
}

function replyAllRecipients(
  source: MessageComposeSource,
  ownEmail: string
): { to: ComposeAddress[]; cc: ComposeAddress[] } {
  const primary = replyRecipients(source, ownEmail)
  const to = dedupeAddresses([...primary, ...source.addresses.to]).filter(
    (address) => normalizeEmail(address.email) !== ownEmail
  )
  const toSet = new Set(to.map((address) => normalizeEmail(address.email)))
  const cc = dedupeAddresses(source.addresses.cc).filter((address) => {
    const email = normalizeEmail(address.email)
    return email !== ownEmail && !toSet.has(email)
  })

  return { to, cc }
}

function fromAddress(source: MessageComposeSource): ComposeAddress[] {
  if (source.addresses.from.length > 0) return source.addresses.from
  return source.fromEmail
    ? [
        {
          name: source.fromName,
          email: source.fromEmail
        }
      ]
    : []
}

function buildReplyBody(source: MessageComposeSource): string {
  const author = formatAddressLine(fromAddress(source)[0])
  const date = source.sentAt ?? source.receivedAt ?? ''
  const intro = [date, author].filter(Boolean).join(', ')
  const quotedBody = quoteText(source.bodyText ?? source.bodyHtmlSanitized ?? source.rawHeaders ?? '')

  return `\n\nOn ${intro || 'the original message'} wrote:\n${quotedBody}`
}

function quoteText(value: string): string {
  const text = value.replace(/\r?\n/g, '\n').trim()
  if (!text) return '>'
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function formatAddressLine(address?: ComposeAddress): string {
  if (!address) return ''
  return address.name ? `${address.name} <${address.email}>` : address.email
}
