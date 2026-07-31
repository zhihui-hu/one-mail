use rusqlite::{Connection, OpenFlags};

use crate::state::AppState;

const SCHEMA_SQL: &str = include_str!("db/schema.sql");

pub fn initialize(state: &AppState) -> Result<(), String> {
    let connection = open(state)?;
    connection
        .execute_batch(SCHEMA_SQL)
        .map_err(|error| format!("初始化数据库失败：{error}"))
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
