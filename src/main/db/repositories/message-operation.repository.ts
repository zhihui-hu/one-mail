import { randomUUID } from 'node:crypto'
import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../connection'

export type MessageOperationKind =
  | 'send'
  | 'reply'
  | 'reply_all'
  | 'forward'
  | 'delete'
  | 'restore'
  | 'permanent_delete'
  | 'append_sent'
  | 'mark_answered'

export type MessageOperationStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export type MessageOperationInput = {
  operationBatchId?: string
  messageId?: number
  outboxId?: number
  accountId: number
  operationKind: MessageOperationKind
  status?: MessageOperationStatus
  remoteAction?: string
  errorMessage?: string
}

export type MessageOperationRecord = Required<Omit<MessageOperationInput, 'messageId' | 'outboxId' | 'remoteAction' | 'errorMessage'>> & {
  operationId: number
  messageId?: number
  outboxId?: number
  remoteAction?: string
  errorMessage?: string
  createdAt?: string
  updatedAt?: string
}

type OperationRow = SqliteRow & {
  operation_id: number
  operation_batch_id: string
  message_id: number | null
  outbox_id: number | null
  account_id: number
  operation_kind: MessageOperationKind
  status: MessageOperationStatus
  remote_action: string | null
  error_message: string | null
  created_at: string | null
  updated_at: string | null
}

export function createMessageOperation(input: MessageOperationInput): MessageOperationRecord {
  ensureMessageOperationTable()
  const operationBatchId = input.operationBatchId ?? randomUUID()
  const result = getDatabase()
    .prepare(
      `
      INSERT INTO onemail_message_operations (
        operation_batch_id,
        message_id,
        outbox_id,
        account_id,
        operation_kind,
        status,
        remote_action,
        error_message
      )
      VALUES (
        :operationBatchId,
        :messageId,
        :outboxId,
        :accountId,
        :operationKind,
        :status,
        :remoteAction,
        :errorMessage
      )
      `
    )
    .run({
      operationBatchId,
      messageId: input.messageId ?? null,
      outboxId: input.outboxId ?? null,
      accountId: input.accountId,
      operationKind: input.operationKind,
      status: input.status ?? 'pending',
      remoteAction: input.remoteAction ?? null,
      errorMessage: input.errorMessage ?? null
    })

  const row = getMessageOperation(Number(result.lastInsertRowid))
  if (!row) throw new Error('Message operation insert did not return a row.')
  return row
}

export function updateMessageOperationStatus(
  operationId: number,
  status: MessageOperationStatus,
  errorMessage?: string
): void {
  ensureMessageOperationTable()
  getDatabase()
    .prepare(
      `
      UPDATE onemail_message_operations
      SET status = :status,
          error_message = :errorMessage,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE operation_id = :operationId
      `
    )
    .run({ operationId, status, errorMessage: errorMessage ?? null })
}

export function getMessageOperation(operationId: number): MessageOperationRecord | null {
  ensureMessageOperationTable()
  const row = getDatabase()
    .prepare<OperationRow>(
      `
      SELECT *
      FROM onemail_message_operations
      WHERE operation_id = :operationId
      `
    )
    .get({ operationId })

  return row ? mapOperationRow(row) : null
}

export function ensureMessageOperationTable(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS onemail_message_operations (
      operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_batch_id TEXT NOT NULL,
      message_id INTEGER,
      outbox_id INTEGER,
      account_id INTEGER NOT NULL,
      operation_kind TEXT NOT NULL CHECK (operation_kind IN ('send', 'reply', 'reply_all', 'forward', 'delete', 'restore', 'permanent_delete', 'append_sent', 'mark_answered')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
      remote_action TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)
}

function mapOperationRow(row: OperationRow): MessageOperationRecord {
  return {
    operationId: toNumber(row.operation_id),
    operationBatchId: row.operation_batch_id,
    messageId: row.message_id === null ? undefined : toNumber(row.message_id),
    outboxId: row.outbox_id === null ? undefined : toNumber(row.outbox_id),
    accountId: toNumber(row.account_id),
    operationKind: row.operation_kind,
    status: row.status,
    remoteAction: toOptionalString(row.remote_action),
    errorMessage: toOptionalString(row.error_message),
    createdAt: toOptionalString(row.created_at),
    updatedAt: toOptionalString(row.updated_at)
  }
}
