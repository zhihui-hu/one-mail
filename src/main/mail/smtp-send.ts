import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../db/connection'
import {
  createMessageOperation,
  updateMessageOperationStatus
} from '../db/repositories/message-operation.repository'
import {
  createOutboxRecord,
  getOutboxRecord,
  markOutboxSending,
  markOutboxFailed,
  markOutboxSent,
  updateOutboxWarning,
  type OutboxComposeKind
} from '../db/repositories/outbox.repository'
import { getMessageComposeSource, markMessageAnswered } from '../db/repositories/message.repository'
import { readAccountPassword } from '../services/credential-store'
import { getMicrosoftAccessToken } from '../services/microsoft-oauth'
import {
  composePlainTextMessage,
  type ComposeAddress,
  type ComposeAttachment,
  type ComposedMessage
} from './message-composer'
import { appendMessageToSentFolder } from './sent-folder-append'
import { SimpleImapSession } from './imap-session'
import { loadAttachmentContent } from './attachment-downloader'
import { authenticateImapSession } from './imap-auth'

export type SmtpSecurity = 'ssl_tls' | 'starttls' | 'none'

export type SmtpSendInput = {
  outboxId?: number
  accountId: number
  composeKind?: OutboxComposeKind
  relatedMessageId?: number
  from?: ComposeAddress
  to: ComposeAddress[]
  cc?: ComposeAddress[]
  bcc?: ComposeAddress[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  references?: string
  attachments?: ComposeAttachment[]
  messageId?: string
}

export type SmtpSendResult = ComposedMessage & {
  outboxId?: number
  envelopeId?: string
  warning?: string
}

type SmtpDeliveryInput = SmtpSendInput & {
  rawMime: string
}

type SmtpAccountRow = SqliteRow & {
  email: string
  display_name: string | null
  auth_type: string
  imap_host: string
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_security?: SmtpSecurity | null
  smtp_auth_type?: string | null
  smtp_enabled?: number | null
  preset_smtp_host?: string | null
  preset_smtp_port?: number | null
  preset_smtp_security?: SmtpSecurity | null
  preset_smtp_auth_type?: string | null
}

type NodemailerModule = {
  default?: {
    createTransport: (options: unknown) => SmtpTransport
  }
  createTransport?: (options: unknown) => SmtpTransport
}

type SmtpTransport = {
  sendMail: (message: {
    envelope: {
      from: string
      to: string[]
    }
    raw: string
  }) => Promise<{
    messageId?: string
    response?: string
  }>
}

export async function sendPlainTextEmail(input: SmtpSendInput): Promise<SmtpSendResult> {
  const from = resolveFromAddress(input.accountId, input.from)
  const attachments = await materializeForwardedAttachments(input.attachments)
  const composed = composePlainTextMessage({ ...input, attachments, from })
  const outbox = input.outboxId
    ? prepareExistingOutbox(input.outboxId, input.accountId)
    : createOutboxRecord({
        accountId: input.accountId,
        relatedMessageId: input.relatedMessageId,
        composeKind: input.composeKind ?? 'new',
        status: 'sending',
        rfc822MessageId: composed.messageId,
        inReplyTo: input.inReplyTo,
        referencesHeader: input.references,
        from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        attachments,
        rawMime: composed.rawMime
      })
  const operation = createMessageOperation({
    accountId: input.accountId,
    messageId: input.relatedMessageId,
    outboxId: outbox.outboxId,
    operationKind: toSendOperationKind(input.composeKind),
    status: 'running',
    remoteAction: 'smtp_send'
  })

  try {
    const sent = await deliverRawEmail({ ...input, rawMime: composed.rawMime, from })
    markOutboxSent(outbox.outboxId, composed.rawMime)
    updateMessageOperationStatus(operation.operationId, 'success')

    const appendResult = await appendMessageToSentFolder(input.accountId, composed.rawMime)
    if (appendResult.warning) {
      updateOutboxWarning(outbox.outboxId, appendResult.warning)
    }

    if (input.relatedMessageId && isReplyKind(input.composeKind)) {
      const warning = await markAnsweredBestEffort(input.relatedMessageId)
      if (warning) updateOutboxWarning(outbox.outboxId, warning)
      if (!appendResult.warning && warning) {
        return { ...composed, outboxId: outbox.outboxId, envelopeId: sent.envelopeId, warning }
      }
    }

    return {
      ...composed,
      outboxId: outbox.outboxId,
      envelopeId: sent.envelopeId,
      warning: appendResult.warning
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markOutboxFailed(outbox.outboxId, message)
    updateMessageOperationStatus(operation.operationId, 'failed', message)
    throw error
  }
}

export async function retryOutboxEmail(outboxId: number): Promise<SmtpSendResult> {
  const outbox = getOutboxRecord(outboxId)
  if (!outbox) throw new Error('发送记录不存在。')
  if (outbox.status === 'sending') throw new Error('邮件仍在发送中。')
  if (outbox.status === 'sent') throw new Error('邮件已经发送成功。')
  if (outbox.status === 'deleted') throw new Error('发送记录已删除。')

  return sendPlainTextEmail({
    outboxId: outbox.outboxId,
    accountId: outbox.accountId,
    composeKind: outbox.composeKind,
    relatedMessageId: outbox.relatedMessageId,
    from: outbox.from,
    to: outbox.to,
    cc: outbox.cc,
    bcc: outbox.bcc,
    subject: outbox.subject,
    bodyText: outbox.bodyText,
    bodyHtml: outbox.bodyHtml,
    inReplyTo: outbox.inReplyTo,
    references: outbox.referencesHeader,
    attachments: outbox.attachments,
    messageId: outbox.rfc822MessageId
  })
}

function prepareExistingOutbox(outboxId: number, accountId: number): { outboxId: number } {
  const existing = getOutboxRecord(outboxId)
  if (!existing) throw new Error('发送记录不存在。')
  if (existing.accountId !== accountId) throw new Error('发送记录与账号不匹配。')
  if (existing.status === 'sending') throw new Error('邮件仍在发送中。')
  if (existing.status === 'sent') throw new Error('邮件已经发送成功。')
  if (existing.status === 'deleted') throw new Error('发送记录已删除。')

  markOutboxSending(outboxId)
  return { outboxId }
}

async function deliverRawEmail(input: SmtpDeliveryInput): Promise<{ envelopeId?: string }> {
  const account = getAccount(input.accountId)
  if (!account) throw new Error(`Account not found: ${input.accountId}`)

  const smtpAccount = getSmtpAccount(input.accountId)
  const smtpConfig = resolveSmtpConfig(smtpAccount)
  const from = input.from ?? resolveFromAddress(input.accountId)
  const auth = await resolveSmtpAuth(account, smtpAccount)
  const nodemailer = await loadNodemailer()
  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.security === 'ssl_tls',
    requireTLS: smtpConfig.security === 'starttls',
    auth
  })

  const result = await transport.sendMail({
    envelope: {
      from: from.email,
      to: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])].map((address) => address.email)
    },
    raw: input.rawMime
  })

  return {
    envelopeId: result.messageId ?? result.response
  }
}

async function resolveSmtpAuth(
  account: NonNullable<ReturnType<typeof getAccount>>,
  smtpAccount: SmtpAccountRow
): Promise<Record<string, string | number | undefined>> {
  const authType = smtpAccount.smtp_auth_type ?? account.authType

  if (authType === 'oauth2') {
    const token = await getMicrosoftAccessToken(account.accountId)
    return {
      type: 'OAuth2',
      user: account.email,
      accessToken: token.accessToken
    }
  }

  if (authType === 'password' || authType === 'app_password') {
    return {
      user: account.email,
      pass: readAccountPassword(account.accountId)
    }
  }

  throw new Error('当前账号缺少可用的 SMTP 发信认证方式。')
}

function resolveFromAddress(accountId: number, from?: ComposeAddress): ComposeAddress {
  if (from) return from
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  return {
    name: account.displayName ?? account.accountLabel,
    email: account.email
  }
}

function isReplyKind(kind?: OutboxComposeKind): boolean {
  return kind === 'reply' || kind === 'reply_all'
}

function toSendOperationKind(kind?: OutboxComposeKind): 'send' | 'reply' | 'reply_all' | 'forward' {
  return kind && kind !== 'new' ? kind : 'send'
}

async function markAnsweredBestEffort(messageId: number): Promise<string | undefined> {
  markMessageAnswered(messageId)
  const source = getMessageComposeSource(messageId)
  if (!source) return '原邮件本地已标记为已回复，但未找到远端邮件定位信息。'

  const account = getAccount(source.accountId)
  if (!account) return `Account not found: ${source.accountId}`

  let session: SimpleImapSession | undefined
  try {
    session = await SimpleImapSession.connect(account, 'A')
    await authenticateImapSession(account, session)
    await session.selectMailbox(source.folderPath)
    await session.setAnsweredFlag(source.uid, true)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    await session?.logout().catch(() => undefined)
  }
}

function getSmtpAccount(accountId: number): SmtpAccountRow {
  const accountColumns = getTableColumns('onemail_mail_accounts')
  const presetColumns = getTableColumns('onemail_provider_presets')
  const accountSmtp = {
    smtpHost: optionalColumn(accountColumns, 'a.smtp_host', 'NULL'),
    smtpPort: optionalColumn(accountColumns, 'a.smtp_port', 'NULL'),
    smtpSecurity: optionalColumn(accountColumns, 'a.smtp_security', 'NULL'),
    smtpAuthType: optionalColumn(accountColumns, 'a.smtp_auth_type', 'NULL'),
    smtpEnabled: optionalColumn(accountColumns, 'a.smtp_enabled', '1')
  }
  const presetSmtp = {
    smtpHost: optionalColumn(presetColumns, 'p.smtp_host', 'NULL'),
    smtpPort: optionalColumn(presetColumns, 'p.smtp_port', 'NULL'),
    smtpSecurity: optionalColumn(presetColumns, 'p.smtp_security', 'NULL'),
    smtpAuthType: optionalColumn(presetColumns, 'p.smtp_auth_type', 'NULL')
  }

  const row = getDatabase()
    .prepare<SmtpAccountRow>(
      `
      SELECT
        a.email,
        a.display_name,
        a.auth_type,
        a.imap_host,
        ${accountSmtp.smtpHost} AS smtp_host,
        ${accountSmtp.smtpPort} AS smtp_port,
        ${accountSmtp.smtpSecurity} AS smtp_security,
        ${accountSmtp.smtpAuthType} AS smtp_auth_type,
        ${accountSmtp.smtpEnabled} AS smtp_enabled,
        ${presetSmtp.smtpHost} AS preset_smtp_host,
        ${presetSmtp.smtpPort} AS preset_smtp_port,
        ${presetSmtp.smtpSecurity} AS preset_smtp_security,
        ${presetSmtp.smtpAuthType} AS preset_smtp_auth_type
      FROM onemail_mail_accounts a
      LEFT JOIN onemail_provider_presets p ON p.provider_key = a.provider_key
      WHERE a.account_id = :accountId
      `
    )
    .get({ accountId })

  if (!row) throw new Error(`Account not found: ${accountId}`)
  return row
}

function resolveSmtpConfig(row: SmtpAccountRow): {
  host: string
  port: number
  security: SmtpSecurity
} {
  if (row.smtp_enabled === 0 && row.smtp_auth_type !== 'oauth2' && row.auth_type !== 'oauth2') {
    throw new Error('此账号未启用 SMTP 发信。')
  }

  const host =
    toOptionalString(row.smtp_host) ??
    toOptionalString(row.preset_smtp_host) ??
    inferSmtpHost(row.imap_host)
  const security = row.smtp_security ?? row.preset_smtp_security ?? 'ssl_tls'
  const port = toNumber(row.smtp_port ?? row.preset_smtp_port ?? defaultSmtpPort(security))

  if (!host) throw new Error('账号缺少 SMTP 服务器配置。')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('账号 SMTP 端口无效。')
  }

  return { host, port, security }
}

function inferSmtpHost(imapHost: string): string | undefined {
  if (/^imap[.-]/i.test(imapHost)) return imapHost.replace(/^imap/i, 'smtp')
  return undefined
}

function defaultSmtpPort(security: SmtpSecurity): number {
  if (security === 'ssl_tls') return 465
  if (security === 'starttls') return 587
  return 25
}

function getTableColumns(tableName: string): Set<string> {
  const rows = getDatabase().prepare<SqliteRow>(`PRAGMA table_info(${tableName})`).all()
  return new Set(rows.map((row) => String(row.name)))
}

function optionalColumn(columns: Set<string>, column: string, fallback: string): string {
  return columns.has(column.split('.').at(-1) ?? column) ? column : fallback
}

async function loadNodemailer(): Promise<Required<Pick<NodemailerModule, 'createTransport'>>> {
  try {
    const mod = (await import('nodemailer')) as NodemailerModule
    const createTransport = mod.createTransport ?? mod.default?.createTransport
    if (!createTransport) throw new Error('nodemailer createTransport 不可用。')
    return { createTransport }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`缺少 SMTP 发送依赖 nodemailer，请先安装 nodemailer。原始错误：${message}`)
  }
}

async function materializeForwardedAttachments(
  attachments?: ComposeAttachment[]
): Promise<ComposeAttachment[] | undefined> {
  if (!attachments || attachments.length === 0) return attachments

  const materialized: ComposeAttachment[] = []

  for (const attachment of attachments) {
    if (attachment.content || attachment.filePath || !attachment.sourceAttachmentId) {
      materialized.push(attachment)
      continue
    }

    const loaded = await loadAttachmentContent(attachment.sourceAttachmentId)
    materialized.push({
      ...attachment,
      filename: attachment.filename ?? loaded.filename,
      mimeType: attachment.mimeType ?? loaded.mimeType,
      content: loaded.content,
      sizeBytes: loaded.content.length
    })
  }

  return materialized
}
