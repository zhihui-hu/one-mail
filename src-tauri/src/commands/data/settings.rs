use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

use crate::{db, state::AppState};

use super::utils::{database_error, optional_bool, optional_i64, optional_string, require_object};

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    ensure_default_settings(&connection)?;
    Ok(json!({
        "syncIntervalMinutes": read_setting_i64(&connection, "sync_interval_minutes", 15)?,
        "syncWindowDays": read_setting_i64(&connection, "sync_window_days", 90)?,
        "openAtLogin": read_setting_bool(&connection, "open_at_login", false)?,
        "externalImagesBlocked": read_setting_bool(&connection, "external_images_blocked", true)?,
        "locale": read_setting_string(&connection, "locale", "zh-CN")?
    }))
}

#[tauri::command]
pub fn settings_update(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let current = settings_get(state.clone())?;
    let current_object = require_object(&current)?;
    let input_object = require_object(&input)?;
    let connection = db::open(&state)?;

    write_setting(
        &connection,
        "sync_interval_minutes",
        &optional_i64(input_object, "syncIntervalMinutes")
            .or_else(|| optional_i64(current_object, "syncIntervalMinutes"))
            .unwrap_or(15)
            .to_string(),
        "number",
    )?;
    write_setting(
        &connection,
        "sync_window_days",
        &optional_i64(input_object, "syncWindowDays")
            .or_else(|| optional_i64(current_object, "syncWindowDays"))
            .unwrap_or(90)
            .to_string(),
        "number",
    )?;
    write_setting(
        &connection,
        "open_at_login",
        if optional_bool(input_object, "openAtLogin")
            .or_else(|| optional_bool(current_object, "openAtLogin"))
            .unwrap_or(false)
        {
            "1"
        } else {
            "0"
        },
        "boolean",
    )?;
    write_setting(
        &connection,
        "external_images_blocked",
        if optional_bool(input_object, "externalImagesBlocked")
            .or_else(|| optional_bool(current_object, "externalImagesBlocked"))
            .unwrap_or(true)
        {
            "1"
        } else {
            "0"
        },
        "boolean",
    )?;
    let locale = optional_string(input_object, "locale")
        .or_else(|| optional_string(current_object, "locale"))
        .unwrap_or_else(|| "zh-CN".to_string());
    write_setting(&connection, "locale", &locale, "string")?;
    settings_get(state)
}

#[tauri::command]
pub fn settings_get_backup_sync(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let value = connection
        .query_row(
            "SELECT setting_value FROM onemail_app_settings WHERE setting_key='backup_sync_settings'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?;
    Ok(value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_else(|| json!({ "provider": "none" })))
}

#[tauri::command]
pub fn settings_update_backup_sync(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    let connection = db::open(&state)?;
    write_setting(
        &connection,
        "backup_sync_settings",
        &serde_json::to_string(&input).map_err(|error| error.to_string())?,
        "json",
    )?;
    Ok(input)
}

#[tauri::command]
pub fn settings_test_backup_sync(input: Value) -> Result<Value, String> {
    let _ = input;
    Err("WebDAV/S3 备份同步尚未迁移到 Tauri。".to_string())
}

#[tauri::command]
pub fn settings_upload_backup_sync() -> Result<Value, String> {
    Err("WebDAV/S3 备份同步尚未迁移到 Tauri。".to_string())
}

#[tauri::command]
pub fn settings_download_backup_sync(operation_id: Option<String>) -> Result<Value, String> {
    let _ = operation_id;
    Err("WebDAV/S3 备份同步尚未迁移到 Tauri。".to_string())
}

#[tauri::command]
pub fn settings_import_backup_from_remote(
    input: Value,
    operation_id: Option<String>,
) -> Result<Value, String> {
    let _ = (input, operation_id);
    Err("WebDAV/S3 备份同步尚未迁移到 Tauri。".to_string())
}

fn ensure_default_settings(connection: &Connection) -> Result<(), String> {
    for (key, value, value_type) in [
        ("sync_interval_minutes", "15", "number"),
        ("sync_window_days", "90", "number"),
        ("open_at_login", "0", "boolean"),
        ("external_images_blocked", "1", "boolean"),
        ("locale", "zh-CN", "string"),
    ] {
        connection
            .execute(
                "INSERT OR IGNORE INTO onemail_app_settings
                 (setting_key,setting_value,value_type) VALUES (?1,?2,?3)",
                params![key, value, value_type],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn read_setting_string(
    connection: &Connection,
    key: &str,
    fallback: &str,
) -> Result<String, String> {
    connection
        .query_row(
            "SELECT setting_value FROM onemail_app_settings WHERE setting_key=?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or_else(|| fallback.to_string()))
        .map_err(database_error)
}

fn read_setting_i64(connection: &Connection, key: &str, fallback: i64) -> Result<i64, String> {
    Ok(read_setting_string(connection, key, &fallback.to_string())?
        .parse()
        .unwrap_or(fallback))
}

fn read_setting_bool(connection: &Connection, key: &str, fallback: bool) -> Result<bool, String> {
    let fallback_value = if fallback { "1" } else { "0" };
    Ok(matches!(
        read_setting_string(connection, key, fallback_value)?.as_str(),
        "1" | "true"
    ))
}

fn write_setting(
    connection: &Connection,
    key: &str,
    value: &str,
    value_type: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO onemail_app_settings (setting_key,setting_value,value_type)
             VALUES (?1,?2,?3)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,
             value_type=excluded.value_type,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![key, value, value_type],
        )
        .map(|_| ())
        .map_err(database_error)
}
