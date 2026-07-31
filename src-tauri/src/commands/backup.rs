use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use rusqlite::{types::ValueRef, Connection};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    db,
    state::{is_valid_database_key, AppState},
};

const MAX_BACKUP_CLOCK_SKEW_SECONDS: u64 = 5 * 60;

#[derive(Clone)]
struct BackupInfo {
    key: String,
    exported_at: u64,
}

#[tauri::command]
pub async fn settings_import_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    operation_id: Option<String>,
) -> Result<Value, String> {
    emit_progress(&app, operation_id.as_deref(), "selecting_file", 5, None);
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("OneMail SQL Backup", &["sql"])
        .set_title("导入 SQL 备份")
        .blocking_pick_file()
    else {
        return Ok(json!({ "imported": false }));
    };
    let file_path = file
        .into_path()
        .map_err(|error| format!("无法读取所选文件路径：{error}"))?;

    emit_progress(
        &app,
        operation_id.as_deref(),
        "reading_file",
        20,
        Some(&file_path),
    );
    let raw_sql =
        fs::read_to_string(&file_path).map_err(|error| format!("读取备份文件失败：{error}"))?;
    // Older exports could embed binary PDF/OFD bytes in text fields. SQLite's
    // SQL parser cannot consume NUL bytes inside a string literal.
    let sql = raw_sql.replace('\0', "\u{fffd}");
    emit_progress(
        &app,
        operation_id.as_deref(),
        "validating_backup",
        35,
        Some(&file_path),
    );
    let info = validate_backup(&sql, &file_path)?;

    emit_progress(
        &app,
        operation_id.as_deref(),
        "restoring_database",
        55,
        Some(&file_path),
    );
    restore_database(&state, &sql, &info.key)?;
    emit_progress(
        &app,
        operation_id.as_deref(),
        "loading_stats",
        90,
        Some(&file_path),
    );

    let connection = db::open(&state)?;
    let account_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM onemail_mail_accounts", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("读取账号统计失败：{error}"))?;
    let message_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM onemail_mail_messages", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("读取邮件统计失败：{error}"))?;

    emit_progress(
        &app,
        operation_id.as_deref(),
        "completed",
        100,
        Some(&file_path),
    );
    Ok(json!({
        "imported": true,
        "filePath": file_path.to_string_lossy(),
        "importedAt": db::now_iso(),
        "exportedAt": info.exported_at,
        "accountCount": account_count,
        "messageCount": message_count
    }))
}

#[tauri::command]
pub async fn settings_export_sql(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let exported_at = unix_timestamp();
    let key = state.database_key()?;
    let file_name = format!("{key}_{exported_at}.sql");
    let sql = dump_database(&state, exported_at, &key)?;

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("OneMail SQL Backup", &["sql"])
        .set_title("导出 SQL 备份")
        .set_file_name(&file_name);
    if let Ok(documents) = app.path().document_dir() {
        dialog = dialog.set_directory(documents);
    }
    let Some(file) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let file_path = file
        .into_path()
        .map_err(|error| format!("无法读取保存路径：{error}"))?;
    fs::write(&file_path, sql).map_err(|error| format!("写入备份文件失败：{error}"))?;
    Ok(Some(file_path.to_string_lossy().into_owned()))
}

fn validate_backup(sql: &str, file_path: &Path) -> Result<BackupInfo, String> {
    let lower = sql.to_ascii_lowercase();
    if !lower.contains("create table") || !lower.contains("onemail_mail_accounts") {
        return Err("备份 SQL 缺少 OneMail 账号表。".to_string());
    }
    if !lower.contains("encrypted_password") {
        return Err("备份 SQL 缺少账号密码密文字段。".to_string());
    }
    if !lower.contains("onemail_app_settings") {
        return Err("备份 SQL 缺少 OneMail 设置表。".to_string());
    }
    if lower.contains("onemail_crypto_keys") || lower.contains("onemail_account_credentials") {
        return Err("备份 SQL 包含旧版凭据表，请使用新库重新导出。".to_string());
    }

    let attachment =
        Regex::new(r"(?im)(?:^|;)\s*(?:EXPLAIN(?:\s+QUERY\s+PLAN)?\s+)?(?:ATTACH|DETACH)\b")
            .map_err(|error| error.to_string())?;
    if attachment.is_match(sql) {
        return Err("备份 SQL 包含不允许的数据库附加语句。".to_string());
    }

    let key =
        header_value(sql, "-- key:").ok_or_else(|| "备份 SQL 缺少数据库密钥。".to_string())?;
    let exported_at = header_value(sql, "-- exported_at:")
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "备份 SQL 缺少有效的导出时间。".to_string())?;
    validate_key_and_timestamp(&key, exported_at)?;

    if let Some(file_name) = file_path.file_name().and_then(|value| value.to_str()) {
        let canonical_name =
            Regex::new(r"^k\d{10}[0-9a-f]{16}_\d{10}\.sql$").map_err(|error| error.to_string())?;
        let expected = format!("{key}_{exported_at}.sql");
        if canonical_name.is_match(file_name) && file_name != expected {
            return Err("备份 SQL 头部信息与文件名不一致。".to_string());
        }
    }

    Ok(BackupInfo { key, exported_at })
}

fn restore_database(state: &AppState, sql: &str, key: &str) -> Result<(), String> {
    let database_dir = state
        .database_path
        .parent()
        .ok_or_else(|| "数据库目录无效。".to_string())?;
    let temp_path = database_dir.join("onemail.importing.sqlite");
    let rollback_path = database_dir.join("onemail.rollback.sqlite");
    remove_database_files(&temp_path)?;
    remove_database_files(&rollback_path)?;

    {
        let connection =
            Connection::open(&temp_path).map_err(|error| format!("创建临时数据库失败：{error}"))?;
        connection
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .and_then(|_| connection.execute_batch(sql))
            .map_err(|error| format!("恢复 SQL 备份失败：{error}"))?;
        connection
            .query_row("SELECT COUNT(*) FROM onemail_mail_accounts", [], |_| Ok(()))
            .map_err(|error| format!("导入后的账号表无效：{error}"))?;
    }

    if state.database_path.exists() {
        if let Ok(connection) = db::open(state) {
            let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        move_database_files(&state.database_path, &rollback_path)?;
    }

    if let Err(error) = move_database_files(&temp_path, &state.database_path) {
        let _ = move_database_files(&rollback_path, &state.database_path);
        return Err(error);
    }

    if let Err(error) = state
        .set_database_key(key)
        .and_then(|_| db::initialize(state))
    {
        let _ = remove_database_files(&state.database_path);
        let _ = move_database_files(&rollback_path, &state.database_path);
        return Err(error);
    }

    remove_database_files(&rollback_path)?;
    Ok(())
}

fn dump_database(state: &AppState, exported_at: u64, key: &str) -> Result<String, String> {
    let connection = db::open(state)?;
    let mut output = vec![
        "-- OneMail SQL Backup".to_string(),
        format!("-- key: {key}"),
        format!("-- exported_at: {exported_at}"),
        "PRAGMA foreign_keys = OFF;".to_string(),
        "BEGIN TRANSACTION;".to_string(),
    ];

    let mut schema_statement = connection
        .prepare(
            "SELECT sql FROM sqlite_schema
             WHERE sql IS NOT NULL
               AND type IN ('table', 'index', 'trigger', 'view')
               AND name NOT LIKE 'sqlite_%'
               AND name NOT LIKE 'onemail_message_search_%'
             ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1
                      WHEN 'trigger' THEN 2 ELSE 3 END, name",
        )
        .map_err(|error| format!("读取数据库结构失败：{error}"))?;
    let schema_rows = schema_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("读取数据库结构失败：{error}"))?;
    for row in schema_rows {
        output.push(format!(
            "{};",
            row.map_err(|error| format!("读取数据库结构失败：{error}"))?
        ));
    }

    let table_names = {
        let mut statement = connection
            .prepare(
                "SELECT name FROM sqlite_schema
                 WHERE type = 'table'
                   AND name NOT LIKE 'sqlite_%'
                   AND name NOT LIKE 'onemail_message_search_%'
                 ORDER BY name",
            )
            .map_err(|error| format!("读取数据表失败：{error}"))?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("读取数据表失败：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取数据表失败：{error}"))?;
        names
    };

    for table_name in table_names {
        let sql = format!("SELECT * FROM \"{}\"", escape_identifier(&table_name));
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("读取 {table_name} 失败：{error}"))?;
        let columns = statement
            .column_names()
            .iter()
            .map(|name| format!("\"{}\"", escape_identifier(name)))
            .collect::<Vec<_>>()
            .join(", ");
        let column_count = statement.column_count();
        let rows = statement
            .query_map([], |row| {
                let values = (0..column_count)
                    .map(|index| format_sql_value(row.get_ref(index)?))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(values.join(", "))
            })
            .map_err(|error| format!("读取 {table_name} 失败：{error}"))?;

        for row in rows {
            output.push(format!(
                "INSERT INTO \"{}\" ({columns}) VALUES ({});",
                escape_identifier(&table_name),
                row.map_err(|error| format!("读取 {table_name} 失败：{error}"))?
            ));
        }
    }

    output.push("COMMIT;".to_string());
    output.push("PRAGMA foreign_keys = ON;".to_string());
    Ok(format!("{}\n", output.join("\n")))
}

fn format_sql_value(value: ValueRef<'_>) -> Result<String, rusqlite::Error> {
    Ok(match value {
        ValueRef::Null => "NULL".to_string(),
        ValueRef::Integer(value) => value.to_string(),
        ValueRef::Real(value) => value.to_string(),
        ValueRef::Text(value) => {
            if value.contains(&0) {
                let hex = value
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                format!("CAST(X'{hex}' AS TEXT)")
            } else {
                format!("'{}'", String::from_utf8_lossy(value).replace('\'', "''"))
            }
        }
        ValueRef::Blob(value) => {
            let hex = value
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            format!("X'{hex}'")
        }
    })
}

fn emit_progress(
    app: &AppHandle,
    operation_id: Option<&str>,
    stage: &str,
    percent: u8,
    file_path: Option<&Path>,
) {
    let Some(operation_id) = operation_id else {
        return;
    };
    let mut payload = json!({
        "operationId": operation_id,
        "source": "local",
        "stage": stage,
        "percent": percent
    });
    if let Some(path) = file_path {
        payload["filePath"] = json!(path.to_string_lossy());
    }
    let _ = app.emit("settings/backupImportProgress", payload);
}

fn header_value(sql: &str, prefix: &str) -> Option<String> {
    sql.lines()
        .find_map(|line| line.strip_prefix(prefix).map(str::trim))
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn validate_key_and_timestamp(key: &str, exported_at: u64) -> Result<(), String> {
    if !is_valid_database_key(key) {
        return Err("备份文件中的数据库密钥无效。".to_string());
    }
    let created_at = key[1..11]
        .parse::<u64>()
        .map_err(|_| "备份文件中的数据库密钥无效。".to_string())?;
    let now = unix_timestamp();
    if exported_at < created_at || exported_at > now + MAX_BACKUP_CLOCK_SKEW_SECONDS {
        return Err("备份文件中的导出时间无效或超出允许范围。".to_string());
    }
    Ok(())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    for target in database_file_set(path) {
        if target.exists() {
            fs::remove_file(&target).map_err(|error| format!("删除临时数据库失败：{error}"))?;
        }
    }
    Ok(())
}

fn move_database_files(from: &Path, to: &Path) -> Result<(), String> {
    let from_files = database_file_set(from);
    let to_files = database_file_set(to);
    for (source, target) in from_files.into_iter().zip(to_files) {
        if source.exists() {
            fs::rename(&source, &target).map_err(|error| format!("替换数据库失败：{error}"))?;
        }
    }
    Ok(())
}

fn database_file_set(path: &Path) -> [PathBuf; 3] {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
}

fn escape_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}
