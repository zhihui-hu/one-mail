import { getMessageComposeSource, type MessageComposeAddress } from '../db/repositories/message.repository'
import type { MailMessageAttachment } from '../../shared/types'
import { loadMessageBodyFromImap } from './body-loader'
import { normalizeSubjectPrefix } from './message-composer'

export type ForwardAttachmentCandidate = MailMessageAttachment & {
  selected: false
}

export type ForwardDraft = {
  accountId: number
  relatedMessageId: number
  composeKind: 'forward'
  to: []
  cc: []
  bcc: []
  subject: string
  bodyText: string
  attachmentCandidates: ForwardAttachmentCandidate[]
}

export async function createForwardDraft(messageId: number): Promise<ForwardDraft> {
  let source = getMessageComposeSource(messageId)
  if (!source) throw new Error('原邮件不存在或已从远端删除。')

  if (!source.bodyText) {
    await loadMessageBodyFromImap(messageId).catch(() => undefined)
    source = getMessageComposeSource(messageId)
    if (!source) throw new Error('原邮件不存在或已从远端删除。')
  }

  return {
    accountId: source.accountId,
    relatedMessageId: messageId,
    composeKind: 'forward',
    to: [],
    cc: [],
    bcc: [],
    subject: normalizeSubjectPrefix(source.subject, 'Fwd'),
    bodyText: buildForwardBody(source),
    attachmentCandidates: source.attachments.map((attachment) => ({
      ...attachment,
      selected: false
    }))
  }
}

function buildForwardBody(source: NonNullable<ReturnType<typeof getMessageComposeSource>>): string {
  const headerLines = [
    '---------- Forwarded message ----------',
    `From: ${formatAddressList(source.addresses.from, source.fromName, source.fromEmail)}`,
    `Date: ${source.sentAt ?? source.receivedAt ?? ''}`,
    `Subject: ${source.subject ?? ''}`,
    `To: ${formatAddressList(source.addresses.to)}`,
    source.addresses.cc.length > 0 ? `Cc: ${formatAddressList(source.addresses.cc)}` : undefined
  ].filter((line): line is string => Boolean(line))

  const originalBody = source.bodyText ?? source.bodyHtmlSanitized ?? ''
  return `\n\n${headerLines.join('\n')}\n\n${originalBody.trim()}`
}

function formatAddressList(
  addresses: MessageComposeAddress[],
  fallbackName?: string,
  fallbackEmail?: string
): string {
  const list =
    addresses.length > 0
      ? addresses
      : fallbackEmail
        ? [{ name: fallbackName, email: fallbackEmail }]
        : []

  return list
    .map((address) => (address.name ? `${address.name} <${address.email}>` : address.email))
    .join(', ')
}
