import type { SqliteDatabaseSync, SqliteRow } from './connection'

type TableColumnRow = SqliteRow & {
  name: string
}

type ColumnDefinition = {
  name: string
  definition: string
}

const TABLE_COLUMN_UPGRADES: Record<string, ColumnDefinition[]> = {
  onemail_provider_presets: [
    { name: 'smtp_host', definition: 'smtp_host TEXT' },
    { name: 'smtp_port', definition: 'smtp_port INTEGER' },
    {
      name: 'smtp_security',
      definition: "smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none'))"
    },
    {
      name: 'smtp_auth_type',
      definition:
        "smtp_auth_type TEXT CHECK (smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual'))"
    },
    {
      name: 'smtp_requires_auth',
      definition: 'smtp_requires_auth INTEGER NOT NULL DEFAULT 1 CHECK (smtp_requires_auth IN (0, 1))'
    }
  ],
  onemail_mail_accounts: [
    { name: 'smtp_host', definition: 'smtp_host TEXT' },
    {
      name: 'smtp_port',
      definition: 'smtp_port INTEGER CHECK (smtp_port IS NULL OR (smtp_port > 0 AND smtp_port <= 65535))'
    },
    {
      name: 'smtp_security',
      definition: "smtp_security TEXT CHECK (smtp_security IN ('ssl_tls', 'starttls', 'none'))"
    },
    {
      name: 'smtp_auth_type',
      definition:
        "smtp_auth_type TEXT CHECK (smtp_auth_type IN ('oauth2', 'app_password', 'password', 'bridge', 'manual'))"
    },
    {
      name: 'smtp_enabled',
      definition: 'smtp_enabled INTEGER NOT NULL DEFAULT 1 CHECK (smtp_enabled IN (0, 1))'
    }
  ],
  onemail_mail_messages: [
    {
      name: 'user_deleted',
      definition: 'user_deleted INTEGER NOT NULL DEFAULT 0 CHECK (user_deleted IN (0, 1))'
    },
    {
      name: 'user_hidden',
      definition: 'user_hidden INTEGER NOT NULL DEFAULT 0 CHECK (user_hidden IN (0, 1))'
    },
    { name: 'deleted_at', definition: 'deleted_at TEXT' },
    { name: 'delete_error', definition: 'delete_error TEXT' },
    { name: 'last_operation_at', definition: 'last_operation_at TEXT' }
  ]
}

export function upgradeSchema(db: SqliteDatabaseSync): void {
  for (const [tableName, columns] of Object.entries(TABLE_COLUMN_UPGRADES)) {
    addMissingColumns(db, tableName, columns)
  }
}

function addMissingColumns(
  db: SqliteDatabaseSync,
  tableName: string,
  columns: ColumnDefinition[]
): void {
  const existingColumns = getTableColumns(db, tableName)

  for (const column of columns) {
    if (!existingColumns.has(column.name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.definition};`)
    }
  }
}

function getTableColumns(db: SqliteDatabaseSync, tableName: string): Set<string> {
  return new Set(
    db
      .prepare<TableColumnRow>(`PRAGMA table_info(${tableName});`)
      .all()
      .map((row) => row.name)
  )
}
