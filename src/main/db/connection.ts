import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { schemaSql } from './schema'
import { upgradeSchema } from './schema-upgrade'

export type SqliteValue = string | number | bigint | Buffer | null
export type SqliteParams = Record<string, SqliteValue> | SqliteValue[]
export type SqliteRow = Record<string, unknown>

export type SqliteStatement<T extends SqliteRow = SqliteRow> = {
  all(params?: SqliteParams): T[]
  get(params?: SqliteParams): T | undefined
  run(params?: SqliteParams): {
    changes: number
    lastInsertRowid: number | bigint
  }
}

export type SqliteDatabaseSync = {
  exec(sql: string): void
  close(): void
  prepare<T extends SqliteRow = SqliteRow>(sql: string): SqliteStatement<T>
}

let database: SqliteDatabaseSync | undefined
let databasePath: string | undefined
let databaseKey: string | undefined

const DATABASE_KEY_PATTERN = /^k\d{10}[0-9a-f]{16}$/
const DATABASE_FILE_NAME = 'onemail.sqlite'
const DATABASE_ENV_FILE = '.env'
const DATABASE_KEY_ENV_NAME = 'ONEMAIL_DATABASE_KEY'
const LEGACY_DATABASE_FILE_PATTERN = /^k\d{10}[0-9a-f]{16}\.sqlite$/
const LEGACY_CURRENT_DATABASE_FILE = 'current-database.txt'

export function getDatabasePath(): string {
  databasePath ??= resolveDatabasePath()
  return databasePath
}

export function getDatabaseKey(): string {
  databaseKey ??= resolveDatabaseKey()
  return databaseKey
}

export function setDatabaseKey(nextDatabaseKey: string): void {
  validateDatabaseKey(nextDatabaseKey)
  databaseKey = nextDatabaseKey
  writeDatabaseKeyFile(nextDatabaseKey)
}

export function setDatabasePath(nextDatabasePath: string): void {
  databasePath = nextDatabasePath
}

export function initializeDatabase(targetDatabasePath = getDatabasePath()): SqliteDatabaseSync {
  if (database) {
    return database
  }

  databasePath = targetDatabasePath
  mkdirSync(dirname(targetDatabasePath), { recursive: true })
  getDatabaseKey()

  const nextDatabase = new DatabaseSync(targetDatabasePath) as SqliteDatabaseSync
  nextDatabase.exec('PRAGMA foreign_keys = ON;')
  nextDatabase.exec('PRAGMA journal_mode = WAL;')
  nextDatabase.exec('PRAGMA busy_timeout = 5000;')

  applySchema(nextDatabase)
  upgradeSchema(nextDatabase)

  database = nextDatabase
  return nextDatabase
}

export function getDatabase(): SqliteDatabaseSync {
  return database ?? initializeDatabase()
}

export function closeDatabase(): void {
  database?.close()
  database = undefined
}

function applySchema(db: SqliteDatabaseSync): void {
  db.exec(schemaSql)
}

export function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function toBoolean(value: unknown): boolean {
  return value === 1 || value === true
}

export function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

export function toNullableParam(value: string | number | boolean | undefined | null): SqliteValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

function resolveDatabasePath(): string {
  const dataDir = getDatabaseDir()
  mkdirSync(dataDir, { recursive: true })

  const nextPath = join(dataDir, DATABASE_FILE_NAME)
  migrateLegacyDatabase(dataDir, nextPath)
  removeLegacyCurrentDatabaseFile(dataDir)
  return nextPath
}

function getDatabaseDir(): string {
  return join(app.getPath('userData'), 'OneMail')
}

function resolveDatabaseKey(): string {
  const storedKey = readDatabaseKeyFile()
  if (storedKey !== undefined) {
    validateDatabaseKey(storedKey)
    return storedKey
  }

  const legacyKey = readLegacyDatabaseKey(getDatabaseDir())
  const nextKey = legacyKey ?? createDatabaseKey()
  writeDatabaseKeyFile(nextKey)
  return nextKey
}

function migrateLegacyDatabase(dataDir: string, nextPath: string): void {
  if (existsSync(nextPath)) return

  const legacyFileName = readLegacyDatabaseFileName(dataDir)
  if (!legacyFileName) return

  const legacyKey = basename(legacyFileName, '.sqlite')
  const storedKey = readDatabaseKeyFile()
  if (storedKey !== undefined) {
    validateDatabaseKey(storedKey)
  } else {
    databaseKey = legacyKey
    writeDatabaseKeyFile(legacyKey)
  }

  const legacyPath = join(dataDir, legacyFileName)
  moveDatabaseFiles(legacyPath, nextPath)
}

function readLegacyDatabaseKey(dataDir: string): string | undefined {
  const legacyFileName = readLegacyDatabaseFileName(dataDir)
  if (legacyFileName) return basename(legacyFileName, '.sqlite')

  return undefined
}

function readLegacyDatabaseFileName(dataDir: string): string | undefined {
  const currentFileName = readLegacyCurrentDatabaseFileName(dataDir)
  if (currentFileName) return currentFileName

  return readdirSync(dataDir)
    .filter((fileName) => LEGACY_DATABASE_FILE_PATTERN.test(fileName))
    .sort()
    .at(-1)
}

function readLegacyCurrentDatabaseFileName(dataDir: string): string | undefined {
  const markerPath = join(dataDir, LEGACY_CURRENT_DATABASE_FILE)
  if (!existsSync(markerPath)) return undefined

  const fileName = readFileSync(markerPath, 'utf8').trim()
  if (!LEGACY_DATABASE_FILE_PATTERN.test(fileName)) return undefined

  return existsSync(join(dataDir, fileName)) ? fileName : undefined
}

function removeLegacyCurrentDatabaseFile(dataDir: string): void {
  const markerPath = join(dataDir, LEGACY_CURRENT_DATABASE_FILE)
  if (existsSync(markerPath)) {
    unlinkSync(markerPath)
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

function readDatabaseKeyFile(): string | undefined {
  const envPath = getDatabaseEnvPath()
  if (!existsSync(envPath)) return undefined

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = /^\s*ONEMAIL_DATABASE_KEY\s*=\s*(.*)\s*$/.exec(line)
    if (match) return parseEnvValue(match[1])
  }

  return undefined
}

function writeDatabaseKeyFile(nextDatabaseKey: string): void {
  validateDatabaseKey(nextDatabaseKey)

  const envPath = getDatabaseEnvPath()
  mkdirSync(dirname(envPath), { recursive: true })

  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : []
  let replaced = false
  const nextLines = lines
    .filter((line, index) => line.length > 0 || index < lines.length - 1)
    .map((line) => {
      if (/^\s*ONEMAIL_DATABASE_KEY\s*=/.test(line)) {
        replaced = true
        return `${DATABASE_KEY_ENV_NAME}=${nextDatabaseKey}`
      }
      return line
    })

  if (!replaced) {
    nextLines.push(`${DATABASE_KEY_ENV_NAME}=${nextDatabaseKey}`)
  }

  writeFileSync(envPath, `${nextLines.join('\n')}\n`, 'utf8')
}

function getDatabaseEnvPath(): string {
  return join(getDatabaseDir(), DATABASE_ENV_FILE)
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function validateDatabaseKey(key: string): void {
  if (!DATABASE_KEY_PATTERN.test(key)) {
    throw new Error('数据库密钥格式无效。')
  }
}

function createDatabaseKey(): string {
  const key = `k${Math.floor(Date.now() / 1000)}${randomBytes(8).toString('hex')}`
  if (!DATABASE_KEY_PATTERN.test(key)) {
    throw new Error('生成数据库名称失败。')
  }
  return key
}
