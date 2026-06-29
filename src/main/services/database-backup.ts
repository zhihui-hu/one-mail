import { app, dialog } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  closeDatabase,
  getDatabase,
  getDatabaseKey,
  getDatabasePath,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import type { BackupImportProgress, BackupImportResult, BackupImportSource } from '../ipc/types'

type BackupFileInfo = {
  key: string
  exportedAt: number
}

export type DatabaseSqlBackup = BackupFileInfo & {
  fileName: string
  sql: string
}

export type BackupImportProgressReporter = (
  progress: Omit<BackupImportProgress, 'operationId'>
) => void

const DATABASE_KEY_PATTERN = /^k(\d{10})([0-9a-f]{16})$/
const BACKUP_FILE_PATTERN = /^(k\d{10}[0-9a-f]{16})_(\d{10})\.sql$/
const MAX_BACKUP_CLOCK_SKEW_SECONDS = 5 * 60

export async function exportDatabaseSqlBackup(): Promise<string | null> {
  const backup = createDatabaseSqlBackup()
  const saveResult = await dialog.showSaveDialog({
    title: '导出 SQL 备份',
    defaultPath: join(app.getPath('documents'), backup.fileName),
    filters: [{ name: 'OneMail SQL Backup', extensions: ['sql'] }]
  })

  if (saveResult.canceled || !saveResult.filePath) return null

  writeFileSync(saveResult.filePath, backup.sql, 'utf8')
  return saveResult.filePath
}

export function createDatabaseSqlBackup(): DatabaseSqlBackup {
  const exportedAt = getUnixTimestamp()
  const key = getDatabaseKey()

  return {
    key,
    exportedAt,
    fileName: `${key}_${exportedAt}.sql`,
    sql: dumpDatabaseSql(exportedAt)
  }
}

export async function importDatabaseSqlBackup(
  reportProgress?: BackupImportProgressReporter
): Promise<BackupImportResult> {
  reportBackupImportProgress(reportProgress, 'local', 'selecting_file', 5)

  const openResult = await dialog.showOpenDialog({
    title: '导入 SQL 备份',
    properties: ['openFile'],
    filters: [{ name: 'OneMail SQL Backup', extensions: ['sql'] }]
  })

  if (openResult.canceled || !openResult.filePaths[0]) {
    return { imported: false }
  }

  const filePath = openResult.filePaths[0]
  reportBackupImportProgress(reportProgress, 'local', 'reading_file', 20, { filePath })
  const sql = readBackupSql(filePath)
  reportBackupImportProgress(reportProgress, 'local', 'validating_backup', 35, { filePath })
  const fileInfo = resolveBackupFileInfo(sql, filePath)

  validateSqlBackup(sql, fileInfo)
  reportBackupImportProgress(reportProgress, 'local', 'restoring_database', 55, { filePath })
  restoreDatabaseSql(sql, fileInfo.key)
  reportBackupImportProgress(reportProgress, 'local', 'loading_stats', 90, { filePath })
  const stats = getRestoredDatabaseStats()
  reportBackupImportProgress(reportProgress, 'local', 'completed', 100, { filePath })

  return {
    imported: true,
    filePath,
    importedAt: new Date().toISOString(),
    exportedAt: fileInfo.exportedAt,
    ...stats
  }
}

export function importDatabaseSqlBackupContent(
  sql: string,
  sourceName?: string,
  options: {
    source?: BackupImportSource
    remotePath?: string
    reportProgress?: BackupImportProgressReporter
  } = {}
): BackupImportResult {
  const source = options.source ?? 'local'
  reportBackupImportProgress(options.reportProgress, source, 'validating_backup', 35, {
    remotePath: options.remotePath,
    sourceName
  })
  const fileInfo = resolveBackupFileInfo(sql, sourceName)

  validateSqlBackup(sql, fileInfo)
  reportBackupImportProgress(options.reportProgress, source, 'restoring_database', 55, {
    remotePath: options.remotePath,
    sourceName
  })
  restoreDatabaseSql(sql, fileInfo.key)
  reportBackupImportProgress(options.reportProgress, source, 'loading_stats', 90, {
    remotePath: options.remotePath,
    sourceName
  })
  const stats = getRestoredDatabaseStats()
  reportBackupImportProgress(options.reportProgress, source, 'completed', 100, {
    remotePath: options.remotePath,
    sourceName
  })

  return {
    imported: true,
    filePath: sourceName,
    importedAt: new Date().toISOString(),
    exportedAt: fileInfo.exportedAt,
    ...stats
  }
}

function reportBackupImportProgress(
  reportProgress: BackupImportProgressReporter | undefined,
  source: BackupImportSource,
  stage: BackupImportProgress['stage'],
  percent: number,
  extras: Pick<BackupImportProgress, 'filePath' | 'remotePath' | 'sourceName'> = {}
): void {
  reportProgress?.({
    source,
    stage,
    percent,
    ...extras
  })
}

function getRestoredDatabaseStats(): Pick<BackupImportResult, 'accountCount' | 'messageCount'> {
  const db = getDatabase()
  const accountRow = db
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM onemail_mail_accounts')
    .get()
  const messageRow = db
    .prepare<{ count: number }>('SELECT COUNT(*) AS count FROM onemail_mail_messages')
    .get()

  return {
    accountCount: Number(accountRow?.count ?? 0),
    messageCount: Number(messageRow?.count ?? 0)
  }
}

function dumpDatabaseSql(exportedAt: number): string {
  const db = getDatabase()
  const rows = db
    .prepare<{ sql: string }>(
      `
      SELECT sql
      FROM sqlite_schema
      WHERE sql IS NOT NULL
        AND type IN ('table', 'index', 'trigger', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'onemail_message_search_%'
      ORDER BY
        CASE type
          WHEN 'table' THEN 0
          WHEN 'index' THEN 1
          WHEN 'trigger' THEN 2
          ELSE 3
        END,
        name
      `
    )
    .all()

  const tableNames = db
    .prepare<{ name: string }>(
      `
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'onemail_message_search_%'
      ORDER BY name
      `
    )
    .all()
    .map((row) => row.name)

  const statements = [
    '-- OneMail SQL Backup',
    `-- key: ${getDatabaseKey()}`,
    `-- exported_at: ${exportedAt}`,
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;',
    ...rows.map((row) => `${row.sql};`)
  ]

  for (const tableName of tableNames) {
    const tableRows = db
      .prepare<Record<string, unknown>>(`SELECT * FROM "${escapeIdentifier(tableName)}"`)
      .all()

    for (const row of tableRows) {
      statements.push(formatInsertStatement(tableName, row))
    }
  }

  statements.push('COMMIT;', 'PRAGMA foreign_keys = ON;')

  return `${statements.join('\n')}\n`
}

function restoreDatabaseSql(sql: string, key: string): void {
  const databaseDir = dirname(getDatabasePath())
  const nextDatabasePath = getDatabasePath()
  const tempDatabasePath = join(databaseDir, 'onemail.importing.sqlite')
  const rollbackDatabasePath = join(databaseDir, 'onemail.rollback.sqlite')
  const previousDatabasePath = getDatabasePath()
  const previousKey = getDatabaseKey()
  let replacedDatabase = false
  closeDatabase()

  try {
    removeDatabaseFiles(tempDatabasePath)
    removeDatabaseFiles(rollbackDatabasePath)
    setDatabasePath(tempDatabasePath)
    const restoreDb = initializeDatabase(tempDatabasePath)
    restoreDb.exec('PRAGMA foreign_keys = OFF;')
    dropExistingObjects()
    restoreDb.exec(sql)
    restoreDb.exec('PRAGMA foreign_keys = ON;')
    closeDatabase()

    moveDatabaseFiles(nextDatabasePath, rollbackDatabasePath)
    moveDatabaseFiles(tempDatabasePath, nextDatabasePath)
    replacedDatabase = true
    setDatabaseKey(key)
    setDatabasePath(nextDatabasePath)
    initializeDatabase(nextDatabasePath)
    removeDatabaseFiles(rollbackDatabasePath)
  } catch (error) {
    closeDatabase()
    removeDatabaseFiles(tempDatabasePath)
    if (existsSync(rollbackDatabasePath)) {
      removeDatabaseFiles(previousDatabasePath)
      moveDatabaseFiles(rollbackDatabasePath, previousDatabasePath)
    } else if (replacedDatabase) {
      removeDatabaseFiles(previousDatabasePath)
    } else {
      removeDatabaseFiles(rollbackDatabasePath)
    }
    setDatabaseKey(previousKey)
    setDatabasePath(previousDatabasePath)
    initializeDatabase(previousDatabasePath)
    throw error
  }
}

function removeDatabaseFiles(databasePath: string): void {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }
}

function moveDatabaseFiles(fromPath: string, toPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const sourcePath = `${fromPath}${suffix}`
    if (existsSync(sourcePath)) {
      renameSync(sourcePath, `${toPath}${suffix}`)
    }
  }
}

function dropExistingObjects(): void {
  const db = getDatabase()
  const rows = db
    .prepare<{ type: string; name: string }>(
      `
      SELECT type, name
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
        AND type IN ('table', 'view', 'trigger', 'index')
      ORDER BY
        CASE type
          WHEN 'trigger' THEN 0
          WHEN 'view' THEN 1
          WHEN 'index' THEN 2
          WHEN 'table' THEN 3
          ELSE 4
        END
      `
    )
    .all()

  for (const row of rows) {
    db.exec(`DROP ${row.type.toUpperCase()} IF EXISTS "${escapeIdentifier(row.name)}";`)
  }
}

function parseBackupFileName(filePath: string, throwOnError = true): BackupFileInfo | undefined {
  const fileName = basename(filePath)
  const match = BACKUP_FILE_PATTERN.exec(fileName)
  if (!match) {
    if (!throwOnError) return undefined
    throw new Error('备份文件名无效，应为 密钥_linux时间戳.sql。')
  }

  const key = match[1]
  const exportedAt = Number(match[2])

  validateKeyAndTimestamp(key, exportedAt)

  return { key, exportedAt }
}

function resolveBackupFileInfo(sql: string, sourceName?: string): BackupFileInfo {
  const fileInfo = sourceName ? parseBackupFileName(sourceName, false) : undefined
  const header = parseSqlBackupHeader(sql)

  if (!header) {
    if (fileInfo) return fileInfo
    throw new Error('备份 SQL 缺少密钥或导出时间。')
  }

  if (fileInfo && (header.key !== fileInfo.key || header.exportedAt !== fileInfo.exportedAt)) {
    throw new Error('备份 SQL 头部信息与文件名不一致。')
  }

  return header
}

function readBackupSql(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`备份文件不存在：${basename(filePath)}`)
  }

  return readFileSync(filePath, 'utf8')
}

function validateSqlBackup(sql: string, fileInfo: BackupFileInfo): void {
  if (!hasCreateTableStatement(sql, 'onemail_mail_accounts')) {
    throw new Error('备份 SQL 缺少 OneMail 账号表。')
  }

  if (!/encrypted_password/i.test(sql)) {
    throw new Error('备份 SQL 缺少账号密码密文字段。')
  }

  if (!hasCreateTableStatement(sql, 'onemail_app_settings')) {
    throw new Error('备份 SQL 缺少 OneMail 设置表。')
  }

  if (containsDatabaseAttachmentStatement(sql)) {
    throw new Error('备份 SQL 包含不允许的数据库附加语句。')
  }

  if (/\bonemail_(crypto_keys|account_credentials)\b/i.test(sql)) {
    throw new Error('备份 SQL 包含旧版凭据表，请使用新库重新导出。')
  }

  const header = parseSqlBackupHeader(sql)
  if (!header) {
    throw new Error('备份 SQL 缺少密钥或导出时间。')
  }

  if (header.key !== fileInfo.key || header.exportedAt !== fileInfo.exportedAt) {
    throw new Error('备份 SQL 头部信息与文件名不一致。')
  }
}

function containsDatabaseAttachmentStatement(sql: string): boolean {
  const executableSql = maskSqlCommentsAndQuotedContent(sql)

  return /(?:^|;)\s*(?:EXPLAIN(?:\s+QUERY\s+PLAN)?\s+)?(?:ATTACH|DETACH)\b/i.test(executableSql)
}

function maskSqlCommentsAndQuotedContent(sql: string): string {
  let result = ''
  let index = 0

  while (index < sql.length) {
    const character = sql[index]
    const nextCharacter = sql[index + 1]

    if (character === '-' && nextCharacter === '-') {
      const lineEnd = sql.indexOf('\n', index + 2)
      if (lineEnd === -1) return `${result}${' '.repeat(sql.length - index)}`
      result += `${' '.repeat(lineEnd - index)}\n`
      index = lineEnd + 1
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      const commentEnd = sql.indexOf('*/', index + 2)
      const endIndex = commentEnd === -1 ? sql.length : commentEnd + 2
      result += maskSqlFragment(sql.slice(index, endIndex))
      index = endIndex
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      const endIndex = findQuotedSqlContentEnd(sql, index, character)
      result += maskSqlFragment(sql.slice(index, endIndex))
      index = endIndex
      continue
    }

    if (character === '[') {
      const closingBracket = sql.indexOf(']', index + 1)
      const endIndex = closingBracket === -1 ? sql.length : closingBracket + 1
      result += maskSqlFragment(sql.slice(index, endIndex))
      index = endIndex
      continue
    }

    result += character
    index += 1
  }

  return result
}

function findQuotedSqlContentEnd(sql: string, startIndex: number, quote: string): number {
  let index = startIndex + 1

  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1
      continue
    }

    if (sql[index + 1] === quote) {
      index += 2
      continue
    }

    return index + 1
  }

  return sql.length
}

function maskSqlFragment(fragment: string): string {
  return fragment.replace(/[^\r\n]/g, ' ')
}

function hasCreateTableStatement(sql: string, tableName: string): boolean {
  const tableNamePattern = buildSqlIdentifierPattern(tableName)
  const createTablePattern = new RegExp(
    `\\bCREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tableNamePattern}\\s*\\(`,
    'i'
  )

  return createTablePattern.test(sql)
}

function buildSqlIdentifierPattern(identifier: string): string {
  const escapedIdentifier = escapeRegExp(identifier)

  return `(?:"${escapedIdentifier}"|\\[${escapedIdentifier}\\]|\`${escapedIdentifier}\`|${escapedIdentifier})`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseSqlBackupHeader(sql: string): BackupFileInfo | undefined {
  const keyMatch = /^-- key: (.+)$/m.exec(sql)
  const exportedAtMatch = /^-- exported_at: (.+)$/m.exec(sql)
  if (!keyMatch || !exportedAtMatch) return undefined

  const key = keyMatch[1].trim()
  const exportedAt = Number(exportedAtMatch[1].trim())
  if (!validateKeyAndTimestamp(key, exportedAt, false)) return undefined

  return { key, exportedAt }
}

function formatInsertStatement(tableName: string, row: Record<string, unknown>): string {
  const entries = Object.entries(row)
  const columns = entries.map(([key]) => `"${escapeIdentifier(key)}"`).join(', ')
  const values = entries.map(([, value]) => formatSqlValue(value)).join(', ')

  return `INSERT INTO "${escapeIdentifier(tableName)}" (${columns}) VALUES (${values});`
}

function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`

  return `'${String(value).replace(/'/g, "''")}'`
}

function escapeIdentifier(value: string): string {
  return value.replace(/"/g, '""')
}

function getUnixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

function validateKeyAndTimestamp(key: string, exportedAt: number, throwOnError = true): boolean {
  const keyMatch = DATABASE_KEY_PATTERN.exec(key)
  const createdAt = keyMatch ? Number(keyMatch[1]) : NaN
  const now = getUnixTimestamp()
  const valid =
    Boolean(keyMatch) &&
    Number.isSafeInteger(createdAt) &&
    Number.isSafeInteger(exportedAt) &&
    createdAt > 0 &&
    exportedAt >= createdAt &&
    exportedAt <= now + MAX_BACKUP_CLOCK_SKEW_SECONDS

  if (valid) return true
  if (!throwOnError) return false

  if (!keyMatch) {
    throw new Error('备份文件名中的密钥无效。')
  }
  throw new Error('备份文件名中的 Linux 时间戳无效或超出允许范围。')
}
