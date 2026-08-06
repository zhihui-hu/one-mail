use rusqlite::{Connection, OpenFlags};

use crate::state::AppState;

const SCHEMA_SQL: &str = include_str!("db/schema.sql");

pub fn initialize(state: &AppState) -> Result<(), String> {
    let connection = open(state)?;
    connection
        .execute_batch(SCHEMA_SQL)
        .map_err(|error| format!("初始化数据库失败：{error}"))?;
    ensure_compatibility(&connection)
}

fn ensure_compatibility(connection: &Connection) -> Result<(), String> {
    add_column_if_missing(connection, "onemail_provider_presets", "smtp_host", "TEXT")?;
    add_column_if_missing(
        connection,
        "onemail_provider_presets",
        "smtp_port",
        "INTEGER",
    )?;
    add_column_if_missing(
        connection,
        "onemail_provider_presets",
        "smtp_security",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "onemail_provider_presets",
        "smtp_auth_type",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "onemail_provider_presets",
        "smtp_requires_auth",
        "INTEGER NOT NULL DEFAULT 1",
    )?;

    add_column_if_missing(connection, "onemail_mail_accounts", "smtp_host", "TEXT")?;
    add_column_if_missing(connection, "onemail_mail_accounts", "smtp_port", "INTEGER")?;
    add_column_if_missing(connection, "onemail_mail_accounts", "smtp_security", "TEXT")?;
    add_column_if_missing(
        connection,
        "onemail_mail_accounts",
        "smtp_auth_type",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "onemail_mail_accounts",
        "smtp_enabled",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    add_column_if_missing(
        connection,
        "onemail_mail_accounts",
        "encrypted_password",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "onemail_mail_accounts",
        "connection_state",
        "TEXT NOT NULL DEFAULT 'connected'",
    )?;

    add_column_if_missing(
        connection,
        "onemail_mail_messages",
        "user_deleted",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        connection,
        "onemail_mail_messages",
        "user_hidden",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(connection, "onemail_mail_messages", "deleted_at", "TEXT")?;
    add_column_if_missing(connection, "onemail_mail_messages", "delete_error", "TEXT")?;
    add_column_if_missing(
        connection,
        "onemail_mail_messages",
        "last_operation_at",
        "TEXT",
    )?;

    add_column_if_missing(connection, "onemail_outbox_messages", "raw_mime", "TEXT")?;
    add_column_if_missing(
        connection,
        "onemail_outbox_messages",
        "remote_sent_folder_id",
        "INTEGER",
    )?;
    add_column_if_missing(
        connection,
        "onemail_outbox_messages",
        "remote_sent_uid",
        "INTEGER",
    )?;
    add_column_if_missing(connection, "onemail_outbox_messages", "deleted_at", "TEXT")?;
    add_column_if_missing(
        connection,
        "onemail_outbox_messages",
        "last_warning",
        "TEXT",
    )?;

    connection
        .execute(
            "UPDATE onemail_mail_accounts
             SET connection_state='reauthorize'
             WHERE status='auth_error' AND connection_state='connected'",
            [],
        )
        .map_err(|error| format!("迁移账号认证状态失败：{error}"))?;

    Ok(())
}

fn add_column_if_missing(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    if !table_exists(connection, table_name)? || column_exists(connection, table_name, column_name)?
    {
        return Ok(());
    }

    let sql = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}");
    connection
        .execute(&sql, [])
        .map(|_| ())
        .map_err(|error| format!("升级数据库字段 {table_name}.{column_name} 失败：{error}"))
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS (
               SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1
             )",
            [table_name],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("读取数据库表结构失败：{error}"))
}

fn column_exists(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("读取数据库字段结构失败：{error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取数据库字段结构失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取数据库字段结构失败：{error}"))?;
    Ok(columns.iter().any(|name| name == column_name))
}

pub fn open(state: &AppState) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(
        &state.database_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("打开数据库失败：{error}"))?;

    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("配置数据库超时失败：{error}"))?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|error| format!("配置数据库失败：{error}"))?;
    Ok(connection)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::{ensure_compatibility, SCHEMA_SQL};
    use rusqlite::Connection;

    #[test]
    fn schema_initializes_in_bundled_sqlite() {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(SCHEMA_SQL)
            .expect("initialize OneMail schema");

        let account_table: String = connection
            .query_row(
                "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'onemail_mail_accounts'",
                [],
                |row| row.get(0),
            )
            .expect("accounts table exists");
        assert_eq!(account_table, "onemail_mail_accounts");
    }

    #[test]
    fn compatibility_adds_columns_used_by_current_refresh_paths() {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(
                "
                CREATE TABLE onemail_provider_presets (
                  provider_key TEXT PRIMARY KEY,
                  display_name TEXT NOT NULL,
                  domains_json TEXT NOT NULL DEFAULT '[]',
                  auth_type TEXT NOT NULL,
                  imap_host TEXT,
                  imap_port INTEGER,
                  imap_security TEXT,
                  oauth_provider TEXT,
                  oauth_scopes_json TEXT NOT NULL DEFAULT '[]',
                  requires_enable_imap INTEGER NOT NULL DEFAULT 1,
                  requires_app_password INTEGER NOT NULL DEFAULT 0,
                  requires_bridge INTEGER NOT NULL DEFAULT 0,
                  setup_help_url TEXT,
                  notes TEXT,
                  is_builtin INTEGER NOT NULL DEFAULT 1,
                  is_active INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE TABLE onemail_mail_accounts (
                  account_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  provider_key TEXT NOT NULL,
                  email TEXT NOT NULL,
                  normalized_email TEXT NOT NULL,
                  display_name TEXT,
                  account_label TEXT,
                  avatar_text TEXT,
                  color_key TEXT,
                  auth_type TEXT NOT NULL,
                  imap_host TEXT NOT NULL,
                  imap_port INTEGER NOT NULL,
                  imap_security TEXT NOT NULL,
                  sync_enabled INTEGER NOT NULL DEFAULT 1,
                  sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
                  sync_window_days INTEGER NOT NULL DEFAULT 90,
                  credential_state TEXT NOT NULL DEFAULT 'pending',
                  status TEXT NOT NULL DEFAULT 'active',
                  sort_order INTEGER NOT NULL DEFAULT 0,
                  last_sync_at TEXT,
                  last_error TEXT,
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  UNIQUE(provider_key, normalized_email)
                );
                CREATE TABLE onemail_mail_messages (
                  message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  account_id INTEGER NOT NULL,
                  folder_id INTEGER NOT NULL,
                  uid INTEGER NOT NULL,
                  remote_deleted INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE TABLE onemail_outbox_messages (
                  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  account_id INTEGER NOT NULL,
                  compose_kind TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'draft',
                  rfc822_message_id TEXT NOT NULL,
                  from_email TEXT NOT NULL,
                  to_json TEXT NOT NULL DEFAULT '[]',
                  cc_json TEXT NOT NULL DEFAULT '[]',
                  bcc_json TEXT NOT NULL DEFAULT '[]',
                  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                ",
            )
            .expect("create old schema");

        connection
            .execute_batch(SCHEMA_SQL)
            .expect("run current schema against old database");
        ensure_compatibility(&connection).expect("upgrade old schema");

        connection
            .prepare(
                "SELECT smtp_host,smtp_port,smtp_security,smtp_auth_type,smtp_enabled,
                        encrypted_password,connection_state
                 FROM onemail_mail_accounts",
            )
            .expect("account refresh query columns exist");
        connection
            .prepare(
                "SELECT COUNT(*) FROM onemail_mail_messages
                 WHERE remote_deleted=0 AND user_hidden=0",
            )
            .expect("message refresh filter columns exist");
        connection
            .prepare(
                "SELECT raw_mime,remote_sent_folder_id,remote_sent_uid,deleted_at,last_warning
                 FROM onemail_outbox_messages",
            )
            .expect("outbox columns exist");
        connection
            .prepare(
                "SELECT smtp_host,smtp_port,smtp_security,smtp_auth_type,smtp_requires_auth
                 FROM onemail_provider_presets",
            )
            .expect("provider smtp columns exist");
    }
}
