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
    let has_connection_state = connection
        .prepare("PRAGMA table_info(onemail_mail_accounts)")
        .map_err(|error| format!("读取数据库结构失败：{error}"))?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("读取数据库结构失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取数据库结构失败：{error}"))?
        .iter()
        .any(|name| name == "connection_state");

    if !has_connection_state {
        connection
            .execute(
                "ALTER TABLE onemail_mail_accounts ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'connected'",
                [],
            )
            .map_err(|error| format!("升级账号连接状态字段失败：{error}"))?;
    }

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
    use super::SCHEMA_SQL;
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
}
