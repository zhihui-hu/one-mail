import type { Attachment, Message } from '@renderer/components/mail/types'
import type { TranslationKey } from '@renderer/lib/i18n'

export const ATTACHMENT_METADATA_PENDING_SIZE = '__pending__'

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

export function getDisplaySubject(message: Message, t: Translate): string {
  return message.subject.trim() || t('common.noSubject')
}

export function getDisplaySender(message: Message, t: Translate): string {
  return message.from.trim() || message.fromAddress?.trim() || t('common.unknownSender')
}

export function getDisplayPreview(message: Message, t: Translate): string {
  return message.preview.trim() || t('mail.list.noPreview')
}

export function getDisplayBodyParagraphs(message: Message, t: Translate): string[] {
  return message.body.length > 0 ? message.body : [t('common.bodyNotLoaded')]
}

export function getDisplayAttachmentName(attachment: Attachment, t: Translate): string {
  return attachment.name.trim() || t('common.attachment')
}

export function getDisplayAttachmentSize(attachment: Attachment, t: Translate): string {
  return attachment.size === ATTACHMENT_METADATA_PENDING_SIZE ? t('common.loading') : attachment.size
}

export function getDisplayAttachmentType(attachment: Attachment, t: Translate): string {
  return attachment.type.trim() || t('common.attachment')
}
