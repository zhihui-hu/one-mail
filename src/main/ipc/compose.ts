import { statSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { getAccount } from '../db/repositories/account.repository'
import {
  createOutboxRecord,
  deleteOutboxRecord,
  getOutboxRecord,
  listOutboxRecords,
  updateOutboxRecord,
  type OutboxRecord
} from '../db/repositories/outbox.repository'
import { createForwardDraft } from '../mail/forward-draft'
import { createMessageId } from '../mail/message-composer'
import { createReplyDraft } from '../mail/reply-draft'
import { retryOutboxEmail, sendPlainTextEmail } from '../mail/smtp-send'
import type {
  ComposeDraft,
  ForwardDraftInput,
  MailAttachmentInput,
  MailSendInput,
  MailSendResult,
  OutboxListQuery,
  OutboxMessage,
  ReplyDraftInput
} from './types'

export function registerComposeIpc(): void {
  ipcMain.handle('compose/createReplyDraft', async (_event, input: ReplyDraftInput) => {
    const draft = await createReplyDraft(input.messageId, input.mode)
    return {
      accountId: draft.accountId,
      mode: draft.composeKind,
      relatedMessageId: draft.relatedMessageId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyText: draft.bodyText,
      inReplyTo: draft.inReplyTo,
      referencesHeader: draft.references
    } satisfies ComposeDraft
  })

  ipcMain.handle('compose/createForwardDraft', async (_event, input: ForwardDraftInput) => {
    const draft = await createForwardDraft(input.messageId)
    return {
      accountId: draft.accountId,
      mode: draft.composeKind,
      relatedMessageId: draft.relatedMessageId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyText: draft.bodyText,
      forwardAttachments: draft.attachmentCandidates.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        selected: attachment.selected
      }))
    } satisfies ComposeDraft
  })

  ipcMain.handle('compose/send', async (_event, input: MailSendInput): Promise<MailSendResult> => {
    const result = await sendPlainTextEmail({
      outboxId: input.outboxId,
      accountId: input.accountId,
      composeKind: input.mode,
      relatedMessageId: input.relatedMessageId,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
      inReplyTo: input.inReplyTo,
      references: input.referencesHeader,
      attachments: input.attachments?.map((attachment) => ({
        filePath: attachment.filePath,
        filename: attachment.filename,
        mimeType: attachment.mimeType
      }))
    })
    const sentAt = result.date.toISOString()

    const payload: MailSendResult = {
      outboxId: result.outboxId ?? 0,
      accountId: input.accountId,
      status: 'sent',
      rfc822MessageId: result.messageId,
      sentAt,
      warning: result.warning
    }
    broadcastSent(payload)
    return payload
  })

  ipcMain.handle('compose/selectAttachments', async (event): Promise<MailAttachmentInput[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []

    return result.filePaths.map((filePath) => {
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        throw new Error(`附件不是普通文件：${filePath}`)
      }

      return {
        filePath,
        filename: basename(filePath),
        sizeBytes: stat.size
      } satisfies MailAttachmentInput
    })
  })

  ipcMain.handle('compose/listOutbox', (_event, query?: OutboxListQuery): OutboxMessage[] =>
    listOutboxRecords({
      statuses: query?.statuses,
      limit: query?.limit
    }).map(toOutboxMessage)
  )

  ipcMain.handle('compose/saveDraft', (_event, input: MailSendInput): OutboxMessage => {
    const account = getAccount(input.accountId)
    if (!account) throw new Error(`Account not found: ${input.accountId}`)

    const draftInput = {
      accountId: input.accountId,
      relatedMessageId: input.relatedMessageId,
      composeKind: input.mode,
      status: 'draft' as const,
      rfc822MessageId: createMessageId(account.email),
      inReplyTo: input.inReplyTo,
      referencesHeader: input.referencesHeader,
      from: {
        name: account.displayName ?? account.accountLabel,
        email: account.email
      },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      attachments: input.attachments?.map((attachment) => ({
        filePath: attachment.filePath,
        filename: attachment.filename,
        mimeType: attachment.mimeType
      }))
    }
    const record = input.outboxId
      ? updateOutboxRecord(input.outboxId, draftInput)
      : createOutboxRecord(draftInput)

    return toOutboxMessage(record)
  })
  ipcMain.handle('compose/deleteDraft', (_event, outboxId: number) => {
    const record = requireOutboxRecord(outboxId)
    if (record.status !== 'draft') throw new Error('只能删除草稿记录。')
    return deleteOutboxRecord(outboxId)
  })
  ipcMain.handle('compose/retry', async (_event, outboxId: number): Promise<MailSendResult> => {
    const result = await retryOutboxEmail(outboxId)
    const record = requireOutboxRecord(outboxId)
    const payload: MailSendResult = {
      outboxId,
      accountId: record.accountId,
      status: 'sent',
      rfc822MessageId: result.messageId,
      sentAt: result.date.toISOString(),
      warning: result.warning
    }
    broadcastSent(payload)
    return payload
  })
  ipcMain.handle('compose/deleteOutbox', (_event, outboxId: number) => {
    const record = requireOutboxRecord(outboxId)
    if (record.status === 'sending') throw new Error('发送中的记录不能直接删除。')
    return deleteOutboxRecord(outboxId)
  })
}

function broadcastSent(result: MailSendResult): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('compose/sent', result)
    }
  }
}

function requireOutboxRecord(outboxId: number): OutboxRecord {
  const record = getOutboxRecord(outboxId)
  if (!record) throw new Error('发送记录不存在。')
  return record
}

function toOutboxMessage(record: OutboxRecord): OutboxMessage {
  return {
    outboxId: record.outboxId,
    accountId: record.accountId,
    relatedMessageId: record.relatedMessageId,
    composeKind: record.composeKind,
    status: record.status,
    rfc822MessageId: record.rfc822MessageId,
    from: record.from,
    subject: record.subject,
    bodyText: record.bodyText,
    bodyHtml: record.bodyHtml,
    inReplyTo: record.inReplyTo,
    referencesHeader: record.referencesHeader,
    attachments: record.attachments?.map((attachment) => ({
      filePath: attachment.filePath,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes
    })),
    to: record.to,
    cc: record.cc ?? [],
    bcc: record.bcc ?? [],
    sentAt: record.sentAt,
    deletedAt: record.deletedAt,
    lastError: record.lastError,
    lastWarning: record.lastWarning,
    createdAt: record.createdAt ?? '',
    updatedAt: record.updatedAt ?? ''
  }
}
