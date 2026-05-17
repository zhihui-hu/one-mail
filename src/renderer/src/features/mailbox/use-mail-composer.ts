import * as React from 'react'
import { toast } from 'sonner'

import type { Account, Message } from '@renderer/components/mail/types'
import {
  createComposeDraft,
  saveComposedDraft,
  sendComposedMessage,
  type ComposeDraft,
  type ComposeKind,
  type OutboxMessage,
  type SendMessageInput
} from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import { getErrorMessage } from './mailbox-utils'

type ComposerState = {
  open: boolean
  draft: ComposeDraft | null
}

type UseMailComposerInput = {
  accounts: Account[]
  selectedAccount: Account
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useMailComposer({ accounts, selectedAccount, setError }: UseMailComposerInput): {
  composerOpen: boolean
  composerDraft: ComposeDraft | null
  composerPending: boolean
  openComposer: (kind: ComposeKind, message?: Message) => Promise<void>
  openOutboxDraft: (outbox: OutboxMessage) => void
  closeComposer: () => void
  sendComposerDraft: (input: SendMessageInput) => Promise<void>
  saveComposerDraft: (input: SendMessageInput) => Promise<void>
  discardComposerDraft: () => void
} {
  const { t } = useI18n()
  const [composer, setComposer] = React.useState<ComposerState>({ open: false, draft: null })
  const [composerPending, setComposerPending] = React.useState(false)

  const openComposer = React.useCallback(
    async (kind: ComposeKind, message?: Message): Promise<void> => {
      const accountId = getComposeAccountId(accounts, selectedAccount, message)
      if (!accountId) {
        toast.error(t('mail.composer.noSendingAccount'))
        return
      }

      setComposerPending(true)
      setError(null)

      try {
        const draft = await createComposeDraft({
          kind,
          accountId,
          relatedMessageId: message?.messageId
        })
        setComposer({
          open: true,
          draft: prepareDraft(draft, kind, accountId, message)
        })
      } catch (composeError) {
        const errorMessage = getErrorMessage(composeError, t('mail.composer.createDraftError'))
        setError(errorMessage)
        toast.error(errorMessage)
      } finally {
        setComposerPending(false)
      }
    },
    [accounts, selectedAccount, setError, t]
  )

  const closeComposer = React.useCallback((): void => {
    if (composerPending) return
    setComposer({ open: false, draft: null })
  }, [composerPending])

  const openOutboxDraft = React.useCallback(
    (outbox: OutboxMessage): void => {
      setError(null)
      setComposer({
        open: true,
        draft: {
          draftId: outbox.outboxId,
          kind: outbox.kind,
          accountId: outbox.accountId,
          relatedMessageId: outbox.relatedMessageId,
          to: outbox.to,
          cc: outbox.cc,
          bcc: outbox.bcc,
          subject: outbox.subject,
          bodyText: outbox.bodyText,
          bodyHtml: outbox.bodyHtml,
          attachments: outbox.attachments,
          forwardAttachments: outbox.attachments.filter((attachment) =>
            Boolean(attachment.sourceAttachmentId)
          ),
          inReplyTo: outbox.inReplyTo,
          references: outbox.references
        }
      })
    },
    [setError]
  )

  const sendComposerDraft = React.useCallback(
    async (input: SendMessageInput): Promise<void> => {
      setComposerPending(true)
      setError(null)

      try {
        const result = await sendComposedMessage(input)
        if (!result.sent) {
          throw new Error(result.warning ?? t('mail.composer.sendFailed'))
        }
        toast.success(
          result.warning
            ? t('mail.composer.sentWithWarning', { warning: result.warning })
            : t('mail.composer.sent')
        )
        setComposer({ open: false, draft: null })
      } catch (sendError) {
        const errorMessage = getErrorMessage(sendError, t('mail.composer.sendError'))
        setError(errorMessage)
        toast.error(errorMessage)
        throw sendError
      } finally {
        setComposerPending(false)
      }
    },
    [setError, t]
  )

  const saveComposerDraft = React.useCallback(
    async (input: SendMessageInput): Promise<void> => {
      setComposerPending(true)
      setError(null)

      try {
        const savedDraft = await saveComposedDraft(input)
        toast.success(t('mail.composer.draftSaved'))
        setComposer({
          open: false,
          draft: {
            draftId: savedDraft.outboxId,
            kind: savedDraft.kind,
            accountId: savedDraft.accountId,
            relatedMessageId: savedDraft.relatedMessageId,
            to: savedDraft.to,
            cc: savedDraft.cc,
            bcc: savedDraft.bcc,
            subject: savedDraft.subject,
            bodyText: savedDraft.bodyText,
            bodyHtml: savedDraft.bodyHtml,
            attachments: savedDraft.attachments,
            forwardAttachments: savedDraft.attachments.filter((attachment) =>
              Boolean(attachment.sourceAttachmentId)
            ),
            inReplyTo: savedDraft.inReplyTo,
            references: savedDraft.references
          }
        })
      } catch (saveError) {
        const errorMessage = getErrorMessage(saveError, t('mail.composer.saveDraftError'))
        setError(errorMessage)
        toast.error(errorMessage)
        throw saveError
      } finally {
        setComposerPending(false)
      }
    },
    [setError, t]
  )

  const discardComposerDraft = React.useCallback((): void => {
    if (composerPending) return
    setComposer({ open: false, draft: null })
  }, [composerPending])

  return {
    composerOpen: composer.open,
    composerDraft: composer.draft,
    composerPending,
    openComposer,
    openOutboxDraft,
    closeComposer,
    sendComposerDraft,
    saveComposerDraft,
    discardComposerDraft
  }
}

function getComposeAccountId(
  accounts: Account[],
  selectedAccount: Account,
  message?: Message
): number | undefined {
  if (message?.accountId) return message.accountId
  if (selectedAccount.accountId) return selectedAccount.accountId
  return accounts.find((account) => account.accountId)?.accountId
}

function prepareDraft(
  draft: ComposeDraft,
  kind: ComposeKind,
  accountId: number,
  message?: Message
): ComposeDraft {
  return {
    ...draft,
    kind,
    accountId,
    relatedMessageId: message?.messageId ?? draft.relatedMessageId,
    to: draft.to.length > 0 ? draft.to : buildRecipients(kind, message),
    cc: draft.cc.length > 0 ? draft.cc : kind === 'reply_all' ? splitAddresses(message?.cc) : [],
    subject: draft.subject || buildSubject(kind, message?.subject),
    bodyText: draft.bodyText || buildBody(kind, message),
    inReplyTo:
      draft.inReplyTo ??
      (kind === 'reply' || kind === 'reply_all' ? message?.messageRfc822Id : undefined),
    references:
      draft.references ??
      (kind === 'reply' || kind === 'reply_all' ? message?.references : undefined)
  }
}

function buildRecipients(kind: ComposeKind, message?: Message): string[] {
  if (!message || kind === 'new' || kind === 'forward') return []
  return splitAddresses(message.replyTo || message.fromAddress || message.from)
}

function buildSubject(kind: ComposeKind, subject = ''): string {
  if (kind === 'new') return ''
  if (kind === 'forward') return /^(fwd?|转发):/i.test(subject) ? subject : `Fwd: ${subject}`
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`
}

function buildBody(kind: ComposeKind, message?: Message): string {
  if (kind !== 'forward' || !message) return ''

  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${message.fromAddress ? `${message.from} <${message.fromAddress}>` : message.from}`,
    message.receivedAt ? `Date: ${message.receivedAt}` : undefined,
    `Subject: ${message.subject}`,
    message.to ? `To: ${message.to}` : undefined,
    message.cc ? `Cc: ${message.cc}` : undefined,
    '',
    ...message.body
  ]

  return lines.filter((line): line is string => line !== undefined).join('\n')
}

function splitAddresses(value?: string): string[] {
  if (!value) return []
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
