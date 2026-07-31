use std::fs;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use rusqlite::{
    params, params_from_iter,
    types::{Value as SqlValue, ValueRef},
    Connection, OptionalExtension,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{db, state::AppState};

#[tauri::command]
pub fn accounts_list(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    Ok(Value::Array(list_accounts(&connection)?))
}

#[tauri::command]
pub fn accounts_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    let object = require_object(&input)?;
    let email = required_string(object, "email", "邮箱地址不能为空。")?;
    let normalized_email = email.trim().to_lowercase();
    let provider_key = required_string(object, "providerKey", "邮箱服务商不能为空。")?;
    let auth_type = required_string(object, "authType", "认证方式不能为空。")?;
    if auth_type == "oauth2" {
        return Err("Microsoft OAuth 尚未迁移到 Tauri，请暂时使用授权码账号。".to_string());
    }
    let imap_host = required_string(object, "imapHost", "IMAP 地址不能为空。")?;
    let imap_port = required_i64(object, "imapPort", "IMAP 端口无效。")?;
    let imap_security = required_string(object, "imapSecurity", "IMAP 加密方式不能为空。")?;
    let password = required_string(object, "password", "请输入邮箱授权码或密码。")?;
    let account_label = optional_string(object, "accountLabel")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| normalized_email.clone());
    let encrypted_password = encrypt_password(&state.database_key()?, &password)?;
    let smtp_host = optional_string(object, "smtpHost");
    let smtp_port = optional_i64(object, "smtpPort");
    let smtp_security = optional_string(object, "smtpSecurity");
    let smtp_auth_type =
        optional_string(object, "smtpAuthType").unwrap_or_else(|| auth_type.clone());
    let smtp_enabled = optional_bool(object, "smtpEnabled").unwrap_or(true);

    let connection = db::open(&state)?;
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_provider_presets (
                provider_key, display_name, domains_json, auth_type,
                imap_host, imap_port, imap_security,
                smtp_host, smtp_port, smtp_security, smtp_auth_type,
                smtp_requires_auth, is_builtin, is_active
             ) VALUES (?1, ?1, '[]', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 0, 1)",
            params![
                provider_key,
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type
            ],
        )
        .map_err(database_error)?;
    connection
        .execute(
            "INSERT INTO onemail_mail_accounts (
                provider_key, email, normalized_email, account_label, avatar_text,
                auth_type, imap_host, imap_port, imap_security,
                smtp_host, smtp_port, smtp_security, smtp_auth_type, smtp_enabled,
                encrypted_password, credential_state, status
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                       ?15, 'stored', 'active')",
            params![
                provider_key,
                email,
                normalized_email,
                account_label,
                normalized_email
                    .chars()
                    .next()
                    .unwrap_or('?')
                    .to_uppercase()
                    .to_string(),
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type,
                smtp_enabled,
                encrypted_password
            ],
        )
        .map_err(|error| format!("保存账号失败：{error}"))?;
    let account_id = connection.last_insert_rowid();
    let account = get_account(&connection, account_id)?
        .ok_or_else(|| "保存账号后无法读取账号。".to_string())?;
    let _ = app.emit(
        "accounts/created",
        json!({ "account": account, "requestedSync": true }),
    );
    Ok(account)
}

#[tauri::command]
pub fn accounts_update(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let account_id = required_i64(object, "accountId", "账号 ID 无效。")?;
    let connection = db::open(&state)?;
    let current =
        get_account(&connection, account_id)?.ok_or_else(|| format!("账号不存在：{account_id}"))?;
    let current_object = require_object(&current)?;

    let provider_key = optional_string(object, "providerKey")
        .or_else(|| optional_string(current_object, "providerKey"))
        .unwrap_or_default();
    let display_name = optional_string(object, "displayName")
        .or_else(|| optional_string(current_object, "displayName"));
    let account_label = optional_string(object, "accountLabel")
        .or_else(|| optional_string(current_object, "accountLabel"))
        .or_else(|| optional_string(current_object, "email"));
    let auth_type = optional_string(object, "authType")
        .or_else(|| optional_string(current_object, "authType"))
        .unwrap_or_default();
    let imap_host = optional_string(object, "imapHost")
        .or_else(|| optional_string(current_object, "imapHost"))
        .unwrap_or_default();
    let imap_port = optional_i64(object, "imapPort")
        .or_else(|| optional_i64(current_object, "imapPort"))
        .unwrap_or(993);
    let imap_security = optional_string(object, "imapSecurity")
        .or_else(|| optional_string(current_object, "imapSecurity"))
        .unwrap_or_else(|| "ssl_tls".to_string());
    let smtp_host =
        optional_string(object, "smtpHost").or_else(|| optional_string(current_object, "smtpHost"));
    let smtp_port =
        optional_i64(object, "smtpPort").or_else(|| optional_i64(current_object, "smtpPort"));
    let smtp_security = optional_string(object, "smtpSecurity")
        .or_else(|| optional_string(current_object, "smtpSecurity"));
    let smtp_auth_type = optional_string(object, "smtpAuthType")
        .or_else(|| optional_string(current_object, "smtpAuthType"));
    let smtp_enabled = optional_bool(object, "smtpEnabled")
        .or_else(|| optional_bool(current_object, "smtpEnabled"))
        .unwrap_or(true);
    let sync_enabled = optional_bool(object, "syncEnabled")
        .or_else(|| optional_bool(current_object, "syncEnabled"))
        .unwrap_or(true);

    connection
        .execute(
            "UPDATE onemail_mail_accounts SET
               provider_key=?2, display_name=?3, account_label=?4, auth_type=?5,
               imap_host=?6, imap_port=?7, imap_security=?8,
               smtp_host=?9, smtp_port=?10, smtp_security=?11, smtp_auth_type=?12,
               smtp_enabled=?13, sync_enabled=?14,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE account_id=?1",
            params![
                account_id,
                provider_key,
                display_name,
                account_label,
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type,
                smtp_enabled,
                sync_enabled
            ],
        )
        .map_err(database_error)?;

    if let Some(password) = optional_string(object, "password") {
        let encrypted = encrypt_password(&state.database_key()?, &password)?;
        connection
            .execute(
                "UPDATE onemail_mail_accounts SET encrypted_password=?2,
                  credential_state='stored' WHERE account_id=?1",
                params![account_id, encrypted],
            )
            .map_err(database_error)?;
    }
    get_account(&connection, account_id)?.ok_or_else(|| format!("更新后无法读取账号：{account_id}"))
}

#[tauri::command]
pub fn accounts_disable(state: State<'_, AppState>, account_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET sync_enabled=0, status='disabled',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
            [account_id],
        )
        .map_err(database_error)?;
    get_account(&connection, account_id)?.ok_or_else(|| format!("账号不存在：{account_id}"))
}

#[tauri::command]
pub fn accounts_remove(state: State<'_, AppState>, account_id: i64) -> Result<bool, String> {
    let connection = db::open(&state)?;
    connection
        .execute(
            "DELETE FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
        )
        .map(|changes| changes > 0)
        .map_err(database_error)
}

#[tauri::command]
pub fn accounts_reauthorize(account_id: i64) -> Result<Value, String> {
    let _ = account_id;
    Err("Microsoft OAuth 尚未迁移到 Tauri。".to_string())
}

#[tauri::command]
pub fn messages_stats(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT m.account_id, COUNT(*) AS total_count,
                    SUM(CASE WHEN m.is_read=0 THEN 1 ELSE 0 END) AS unread_count
             FROM onemail_mail_messages m
             WHERE m.remote_deleted=0 AND m.user_hidden=0
             GROUP BY m.account_id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "accountId": row.get::<_, i64>(0)?,
                "totalCount": row.get::<_, i64>(1)?,
                "unreadCount": row.get::<_, i64>(2)?
            }))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(Value::Array(rows))
}

#[tauri::command]
pub fn messages_list(state: State<'_, AppState>, query: Option<Value>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let query_object = query.as_ref().and_then(Value::as_object);
    let mut where_parts = vec!["m.remote_deleted=0", "m.user_hidden=0"];
    let mut values: Vec<SqlValue> = Vec::new();

    if let Some(account_id) = query_object.and_then(|object| optional_i64(object, "accountId")) {
        where_parts.push("m.account_id=?");
        values.push(account_id.into());
    }
    if let Some(folder_id) = query_object.and_then(|object| optional_i64(object, "folderId")) {
        where_parts.push("m.folder_id=?");
        values.push(folder_id.into());
    }
    let filters = query_object
        .and_then(|object| object.get("filters"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if filters.iter().any(|value| value == "unread") {
        where_parts.push("m.is_read=0");
    }
    if filters.iter().any(|value| value == "starred") {
        where_parts.push("m.is_starred=1");
    }
    if filters.iter().any(|value| value == "today") {
        where_parts.push(
            "date(COALESCE(m.received_at,m.internal_date),'localtime')=date('now','localtime')",
        );
    }
    if filters.iter().any(|value| value == "yesterday") {
        where_parts.push(
            "date(COALESCE(m.received_at,m.internal_date),'localtime')=date('now','localtime','-1 day')",
        );
    }
    if filters.iter().any(|value| value == "last7") {
        where_parts.push(
            "date(COALESCE(m.received_at,m.internal_date),'localtime')>=date('now','localtime','-6 days')",
        );
    }
    let keyword = query_object
        .and_then(|object| {
            optional_string(object, "keyword").or_else(|| optional_string(object, "search"))
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(keyword) = keyword {
        where_parts.push(
            "(m.subject LIKE ? OR m.from_name LIKE ? OR m.from_email LIKE ? OR m.snippet LIKE ? OR b.body_text LIKE ?)",
        );
        let like = format!("%{keyword}%");
        for _ in 0..5 {
            values.push(like.clone().into());
        }
    }
    let limit = query_object
        .and_then(|object| optional_i64(object, "limit"))
        .unwrap_or(50)
        .clamp(1, 200);
    let offset = query_object
        .and_then(|object| optional_i64(object, "offset"))
        .unwrap_or(0)
        .max(0);
    values.push(limit.into());
    values.push(offset.into());

    let sql = format!(
        "SELECT m.message_id,m.account_id,m.folder_id,f.role,f.name,
                m.rfc822_message_id,m.references_header,m.subject,m.from_name,m.from_email,
                m.received_at,m.snippet,m.is_read,m.is_starred,m.has_attachments,m.body_status
         FROM onemail_mail_messages m
         JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
         LEFT JOIN onemail_message_bodies b ON b.message_id=m.message_id
         WHERE {}
         ORDER BY COALESCE(m.received_at,m.internal_date,m.created_at) DESC,m.message_id DESC
         LIMIT ? OFFSET ?",
        where_parts.join(" AND ")
    );
    let mut statement = connection.prepare(&sql).map_err(database_error)?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), map_message_summary)
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(Value::Array(rows))
}

#[tauri::command]
pub fn messages_get(state: State<'_, AppState>, message_id: i64) -> Result<Option<Value>, String> {
    let connection = db::open(&state)?;
    get_message_detail(&connection, message_id)
}

#[tauri::command]
pub fn messages_load_body(state: State<'_, AppState>, message_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let body = connection
        .query_row(
            "SELECT body_text,body_html_sanitized,external_images_blocked
             FROM onemail_message_bodies WHERE message_id=?1",
            [message_id],
            |row| {
                Ok(json!({
                    "messageId": message_id,
                    "bodyText": row.get::<_, Option<String>>(0)?,
                    "bodyHtmlSanitized": row.get::<_, Option<String>>(1)?,
                    "externalImagesBlocked": row.get::<_, i64>(2)? != 0
                }))
            },
        )
        .optional()
        .map_err(database_error)?;
    Ok(json!({
        "body": body,
        "error": if body.is_none() { Some("邮件正文尚未缓存；Tauri IMAP 正文加载仍在迁移中。") } else { None }
    }))
}

#[tauri::command]
pub fn messages_set_read_state(
    state: State<'_, AppState>,
    message_id: i64,
    is_read: bool,
) -> Result<Value, String> {
    let connection = db::open(&state)?;
    set_read_state(&connection, message_id, is_read)
}

#[tauri::command]
pub fn messages_bulk_set_read_state(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    let object = require_object(&input)?;
    let is_read = object
        .get("isRead")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let message_ids = object
        .get("messageIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let connection = db::open(&state)?;
    let mut updates = Vec::new();
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for value in message_ids {
        let Some(message_id) = value.as_i64() else {
            continue;
        };
        match set_read_state(&connection, message_id, is_read) {
            Ok(update) => {
                updates.push(update);
                succeeded.push(message_id);
            }
            Err(error) => failed.push(json!({ "messageId": message_id, "error": error })),
        }
    }
    Ok(json!({
        "isRead": is_read,
        "updates": updates,
        "succeededMessageIds": succeeded,
        "failedItems": failed,
        "updatedCount": succeeded.len(),
        "failedCount": failed.len()
    }))
}

#[tauri::command]
pub fn messages_mark_all_read(
    state: State<'_, AppState>,
    input: Option<Value>,
) -> Result<Value, String> {
    let query = input
        .and_then(|value| value.get("query").cloned())
        .unwrap_or_else(|| json!({ "filters": ["unread"], "limit": 200 }));
    let listed = messages_list(state.clone(), Some(query))?;
    let ids = listed
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|message| message.get("messageId").and_then(Value::as_i64))
        .map(Value::from)
        .collect::<Vec<_>>();
    messages_bulk_set_read_state(state, json!({ "messageIds": ids, "isRead": true }))
}

#[tauri::command]
pub fn messages_hide_local(state: State<'_, AppState>, message_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let account_id = message_account_id(&connection, message_id)?;
    connection
        .execute(
            "UPDATE onemail_mail_messages SET user_hidden=1,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE message_id=?1",
            [message_id],
        )
        .map_err(database_error)?;
    Ok(json!({
        "messageId": message_id,
        "accountId": account_id,
        "mode": "local_hide",
        "deleted": true,
        "localOnly": true
    }))
}

#[tauri::command]
pub fn messages_delete(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let message_id = required_i64(object, "messageId", "邮件 ID 无效。")?;
    let mode = optional_string(object, "mode").unwrap_or_else(|| "permanent".to_string());
    if mode == "local_hide" {
        return messages_hide_local(state, message_id);
    }
    let connection = db::open(&state)?;
    let account_id = message_account_id(&connection, message_id)?;
    connection
        .execute(
            "UPDATE onemail_mail_messages SET user_deleted=1,user_hidden=1,
              deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE message_id=?1",
            [message_id],
        )
        .map_err(database_error)?;
    Ok(json!({
        "messageId": message_id,
        "accountId": account_id,
        "mode": "permanent",
        "deleted": true,
        "localOnly": true
    }))
}

#[tauri::command]
pub fn messages_bulk_delete(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let mode = optional_string(object, "mode").unwrap_or_else(|| "permanent".to_string());
    let ids = object
        .get("messageIds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for id in ids {
        let Some(message_id) = id.as_i64() else {
            continue;
        };
        match messages_delete(
            state.clone(),
            json!({ "messageId": message_id, "mode": mode }),
        ) {
            Ok(_) => succeeded.push(message_id),
            Err(error) => failed.push(json!({ "messageId": message_id, "error": error })),
        }
    }
    Ok(json!({
        "mode": mode,
        "succeededMessageIds": succeeded,
        "failedItems": failed,
        "deletedCount": succeeded.len(),
        "failedCount": failed.len()
    }))
}

#[tauri::command]
pub fn messages_restore(state: State<'_, AppState>, message_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let account_id = message_account_id(&connection, message_id)?;
    connection
        .execute(
            "UPDATE onemail_mail_messages SET user_deleted=0,user_hidden=0,deleted_at=NULL,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE message_id=?1",
            [message_id],
        )
        .map_err(database_error)?;
    Ok(json!({
        "messageId": message_id,
        "accountId": account_id,
        "restored": true,
        "localOnly": true
    }))
}

#[tauri::command]
pub fn messages_download_attachment(attachment_id: i64) -> Result<Value, String> {
    let _ = attachment_id;
    Err("Tauri 附件远端下载仍在迁移中；已导入的附件元数据可以正常查看。".to_string())
}

#[tauri::command]
pub fn logos_get(domain: String) -> Option<String> {
    let _ = domain;
    None
}

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

#[tauri::command]
pub fn sync_status() -> Value {
    json!({ "running": false, "accountIds": [] })
}

#[tauri::command]
pub fn sync_start_all(mode: Option<String>) -> Result<Value, String> {
    let _ = mode;
    Err("Tauri 原生 IMAP 同步尚未迁移完成。".to_string())
}

#[tauri::command]
pub fn sync_start_account(account_id: i64, mode: Option<String>) -> Result<Value, String> {
    let _ = (account_id, mode);
    Err("Tauri 原生 IMAP 同步尚未迁移完成。".to_string())
}

#[tauri::command]
pub fn notifications_status() -> Value {
    json!({ "desktopSupported": true })
}

#[tauri::command]
pub fn updates_check(state: State<'_, AppState>) -> Value {
    json!({
        "status": "unsupported",
        "currentVersion": state.app_version,
        "message": "Tauri 更新源尚未配置。"
    })
}

#[tauri::command]
pub fn updates_status(state: State<'_, AppState>) -> Value {
    json!({
        "state": "unsupported",
        "currentVersion": state.app_version,
        "message": "Tauri 更新源尚未配置。",
        "updatedAt": db::now_iso()
    })
}

#[tauri::command]
pub fn updates_install() -> bool {
    false
}

#[tauri::command]
pub async fn compose_select_attachments(app: AppHandle) -> Result<Value, String> {
    let Some(files) = app.dialog().file().blocking_pick_files() else {
        return Ok(json!([]));
    };
    let mut attachments = Vec::new();
    for file in files {
        let path = file
            .into_path()
            .map_err(|error| format!("无法读取附件路径：{error}"))?;
        let metadata = fs::metadata(&path).map_err(|error| format!("读取附件失败：{error}"))?;
        if !metadata.is_file() {
            return Err(format!("附件不是普通文件：{}", path.display()));
        }
        attachments.push(json!({
            "filePath": path.to_string_lossy(),
            "filename": path.file_name().and_then(|name| name.to_str()).unwrap_or("attachment"),
            "sizeBytes": metadata.len()
        }));
    }
    Ok(Value::Array(attachments))
}

#[tauri::command]
pub fn compose_list_outbox(
    state: State<'_, AppState>,
    query: Option<Value>,
) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let statuses = query
        .as_ref()
        .and_then(|value| value.get("statuses"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let limit = query
        .as_ref()
        .and_then(|value| value.get("limit"))
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .clamp(1, 200);
    let mut where_clause = "status!='deleted'".to_string();
    let mut values: Vec<SqlValue> = Vec::new();
    if !statuses.is_empty() {
        where_clause = format!(
            "status IN ({})",
            std::iter::repeat("?")
                .take(statuses.len())
                .collect::<Vec<_>>()
                .join(",")
        );
        for status in statuses {
            if let Some(status) = status.as_str() {
                values.push(status.to_string().into());
            }
        }
    }
    values.push(limit.into());
    let sql = format!(
        "SELECT outbox_id,account_id,related_message_id,compose_kind,status,
                rfc822_message_id,from_name,from_email,to_json,cc_json,bcc_json,
                subject,body_text,body_html,in_reply_to,references_header,sent_at,
                deleted_at,last_error,last_warning,created_at,updated_at
         FROM onemail_outbox_messages WHERE {where_clause}
         ORDER BY updated_at DESC LIMIT ?"
    );
    let mut statement = connection.prepare(&sql).map_err(database_error)?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), map_outbox)
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(Value::Array(rows))
}

#[tauri::command]
pub fn compose_save_draft(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let account_id = required_i64(object, "accountId", "账号 ID 无效。")?;
    let compose_kind = optional_string(object, "mode").unwrap_or_else(|| "new".to_string());
    let related_message_id = optional_i64(object, "relatedMessageId");
    let to_json = serde_json::to_string(object.get("to").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let cc_json = serde_json::to_string(object.get("cc").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let bcc_json = serde_json::to_string(object.get("bcc").unwrap_or(&json!([])))
        .map_err(|error| error.to_string())?;
    let connection = db::open(&state)?;
    let from_email: String = connection
        .query_row(
            "SELECT email FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|_| "账号不存在。".to_string())?;
    let outbox_id = optional_i64(object, "outboxId");
    if let Some(outbox_id) = outbox_id {
        connection
            .execute(
                "UPDATE onemail_outbox_messages SET compose_kind=?2,related_message_id=?3,
                  to_json=?4,cc_json=?5,bcc_json=?6,subject=?7,body_text=?8,body_html=?9,
                  in_reply_to=?10,references_header=?11,status='draft',
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE outbox_id=?1",
                params![
                    outbox_id,
                    compose_kind,
                    related_message_id,
                    to_json,
                    cc_json,
                    bcc_json,
                    optional_string(object, "subject"),
                    optional_string(object, "bodyText"),
                    optional_string(object, "bodyHtml"),
                    optional_string(object, "inReplyTo"),
                    optional_string(object, "referencesHeader")
                ],
            )
            .map_err(database_error)?;
    } else {
        let message_id = format!(
            "<{}.{}@onemail.local>",
            chrono::Utc::now().timestamp_millis(),
            account_id
        );
        connection
            .execute(
                "INSERT INTO onemail_outbox_messages (
                  account_id,related_message_id,compose_kind,status,rfc822_message_id,
                  from_email,to_json,cc_json,bcc_json,subject,body_text,body_html,
                  in_reply_to,references_header
                 ) VALUES (?1,?2,?3,'draft',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    account_id,
                    related_message_id,
                    compose_kind,
                    message_id,
                    from_email,
                    to_json,
                    cc_json,
                    bcc_json,
                    optional_string(object, "subject"),
                    optional_string(object, "bodyText"),
                    optional_string(object, "bodyHtml"),
                    optional_string(object, "inReplyTo"),
                    optional_string(object, "referencesHeader")
                ],
            )
            .map_err(database_error)?;
    }
    let id = outbox_id.unwrap_or_else(|| connection.last_insert_rowid());
    get_outbox(&connection, id)?.ok_or_else(|| "保存草稿后无法读取记录。".to_string())
}

#[tauri::command]
pub fn compose_delete_draft(state: State<'_, AppState>, outbox_id: i64) -> Result<bool, String> {
    delete_outbox(&state, outbox_id)
}

#[tauri::command]
pub fn compose_delete_outbox(state: State<'_, AppState>, outbox_id: i64) -> Result<bool, String> {
    delete_outbox(&state, outbox_id)
}

#[tauri::command]
pub fn compose_create_reply_draft(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    create_related_draft(&state, &input, false)
}

#[tauri::command]
pub fn compose_create_forward_draft(
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    create_related_draft(&state, &input, true)
}

#[tauri::command]
pub fn compose_send(input: Value) -> Result<Value, String> {
    let _ = input;
    Err("Tauri 原生 SMTP 发送尚未迁移完成，草稿仍可正常保存。".to_string())
}

#[tauri::command]
pub fn compose_retry(outbox_id: i64) -> Result<Value, String> {
    let _ = outbox_id;
    Err("Tauri 原生 SMTP 发送尚未迁移完成。".to_string())
}

fn list_accounts(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT account_id,provider_key,email,display_name,account_label,auth_type,
                    imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,
                    smtp_auth_type,smtp_enabled,sync_enabled,
                    CASE WHEN encrypted_password IS NOT NULL THEN 'stored'
                         WHEN auth_type='oauth2' AND EXISTS (
                           SELECT 1 FROM onemail_oauth_tokens t
                           WHERE t.account_id=onemail_mail_accounts.account_id
                         ) THEN 'stored' ELSE credential_state END,
                    status,last_sync_at,last_error
             FROM onemail_mail_accounts ORDER BY sort_order,account_id",
        )
        .map_err(database_error)?;
    let accounts = statement
        .query_map([], map_account)
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(accounts)
}

fn get_account(connection: &Connection, account_id: i64) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT account_id,provider_key,email,display_name,account_label,auth_type,
                    imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,
                    smtp_auth_type,smtp_enabled,sync_enabled,
                    CASE WHEN encrypted_password IS NOT NULL THEN 'stored'
                         WHEN auth_type='oauth2' AND EXISTS (
                           SELECT 1 FROM onemail_oauth_tokens t
                           WHERE t.account_id=onemail_mail_accounts.account_id
                         ) THEN 'stored' ELSE credential_state END,
                    status,last_sync_at,last_error
             FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
            map_account,
        )
        .optional()
        .map_err(database_error)
}

fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "accountId": row.get::<_, i64>(0)?,
        "providerKey": row.get::<_, String>(1)?,
        "email": row.get::<_, String>(2)?,
        "displayName": row.get::<_, Option<String>>(3)?,
        "accountLabel": row.get::<_, Option<String>>(4)?,
        "authType": row.get::<_, String>(5)?,
        "imapHost": row.get::<_, String>(6)?,
        "imapPort": row.get::<_, i64>(7)?,
        "imapSecurity": row.get::<_, String>(8)?,
        "smtpHost": row.get::<_, Option<String>>(9)?,
        "smtpPort": row.get::<_, Option<i64>>(10)?,
        "smtpSecurity": row.get::<_, Option<String>>(11)?,
        "smtpAuthType": row.get::<_, Option<String>>(12)?,
        "smtpEnabled": row.get::<_, i64>(13)? != 0,
        "syncEnabled": row.get::<_, i64>(14)? != 0,
        "credentialState": row.get::<_, String>(15)?,
        "status": row.get::<_, String>(16)?,
        "lastSyncAt": row.get::<_, Option<String>>(17)?,
        "lastError": row.get::<_, Option<String>>(18)?
    }))
}

fn map_message_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "messageId": row.get::<_, i64>(0)?,
        "accountId": row.get::<_, i64>(1)?,
        "folderId": row.get::<_, i64>(2)?,
        "folderRole": row.get::<_, Option<String>>(3)?,
        "folderName": row.get::<_, Option<String>>(4)?,
        "messageRfc822Id": row.get::<_, Option<String>>(5)?,
        "references": row.get::<_, Option<String>>(6)?,
        "subject": row.get::<_, Option<String>>(7)?,
        "fromName": row.get::<_, Option<String>>(8)?,
        "fromEmail": row.get::<_, Option<String>>(9)?,
        "receivedAt": row.get::<_, Option<String>>(10)?,
        "snippet": row.get::<_, Option<String>>(11)?,
        "isRead": row.get::<_, i64>(12)? != 0,
        "isStarred": row.get::<_, i64>(13)? != 0,
        "hasAttachments": row.get::<_, i64>(14)? != 0,
        "bodyStatus": row.get::<_, String>(15)?
    }))
}

fn get_message_detail(connection: &Connection, message_id: i64) -> Result<Option<Value>, String> {
    let summary = connection
        .query_row(
            "SELECT m.message_id,m.account_id,m.folder_id,f.role,f.name,
                    m.rfc822_message_id,m.references_header,m.subject,m.from_name,m.from_email,
                    m.received_at,m.snippet,m.is_read,m.is_starred,m.has_attachments,m.body_status
             FROM onemail_mail_messages m
             JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
             WHERE m.message_id=?1",
            [message_id],
            map_message_summary,
        )
        .optional()
        .map_err(database_error)?;
    let Some(mut detail) = summary else {
        return Ok(None);
    };

    let body = connection
        .query_row(
            "SELECT body_text,body_html_sanitized,external_images_blocked
             FROM onemail_message_bodies WHERE message_id=?1",
            [message_id],
            |row| {
                Ok(json!({
                    "messageId": message_id,
                    "bodyText": row.get::<_, Option<String>>(0)?,
                    "bodyHtmlSanitized": row.get::<_, Option<String>>(1)?,
                    "externalImagesBlocked": row.get::<_, i64>(2)? != 0
                }))
            },
        )
        .optional()
        .map_err(database_error)?;

    let mut attachment_statement = connection
        .prepare(
            "SELECT attachment_id,filename,mime_type,content_disposition,size_bytes
             FROM onemail_message_attachments WHERE message_id=?1 ORDER BY attachment_id",
        )
        .map_err(database_error)?;
    let attachments = attachment_statement
        .query_map([message_id], |row| {
            Ok(json!({
                "attachmentId": row.get::<_, i64>(0)?,
                "filename": row.get::<_, String>(1)?,
                "mimeType": row.get::<_, Option<String>>(2)?,
                "contentDisposition": row.get::<_, Option<String>>(3)?,
                "sizeBytes": row.get::<_, i64>(4)?
            }))
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;

    if let Some(object) = detail.as_object_mut() {
        object.insert("body".to_string(), body.unwrap_or(Value::Null));
        object.insert("attachments".to_string(), Value::Array(attachments));
        for (kind, property) in [("to", "to"), ("cc", "cc"), ("reply_to", "replyTo")] {
            if let Some(value) = list_address_text(connection, message_id, kind)? {
                object.insert(property.to_string(), Value::String(value));
            }
        }
    }
    Ok(Some(detail))
}

fn list_address_text(
    connection: &Connection,
    message_id: i64,
    kind: &str,
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT name,email FROM onemail_message_addresses
             WHERE message_id=?1 AND kind=?2 ORDER BY sort_order,address_id",
        )
        .map_err(database_error)?;
    let values = statement
        .query_map(params![message_id, kind], |row| {
            let name: Option<String> = row.get(0)?;
            let email: String = row.get(1)?;
            Ok(match name.filter(|value| !value.is_empty()) {
                Some(name) => format!("{name} <{email}>"),
                None => email,
            })
        })
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok((!values.is_empty()).then(|| values.join(", ")))
}

fn set_read_state(
    connection: &Connection,
    message_id: i64,
    is_read: bool,
) -> Result<Value, String> {
    let target = connection
        .query_row(
            "SELECT account_id,folder_id FROM onemail_mail_messages WHERE message_id=?1",
            [message_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or_else(|| "邮件不存在。".to_string())?;
    connection
        .execute(
            "UPDATE onemail_mail_messages SET is_read=?2,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE message_id=?1",
            params![message_id, is_read],
        )
        .map_err(database_error)?;
    Ok(json!({
        "messageId": message_id,
        "accountId": target.0,
        "folderId": target.1,
        "isRead": is_read
    }))
}

fn message_account_id(connection: &Connection, message_id: i64) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT account_id FROM onemail_mail_messages WHERE message_id=?1",
            [message_id],
            |row| row.get(0),
        )
        .map_err(|_| "邮件不存在。".to_string())
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

fn map_outbox(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let parse_json = |value: String| serde_json::from_str::<Value>(&value).unwrap_or(json!([]));
    Ok(json!({
        "outboxId": row.get::<_, i64>(0)?,
        "accountId": row.get::<_, i64>(1)?,
        "relatedMessageId": row.get::<_, Option<i64>>(2)?,
        "composeKind": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "rfc822MessageId": row.get::<_, String>(5)?,
        "from": {
            "name": row.get::<_, Option<String>>(6)?,
            "email": row.get::<_, String>(7)?
        },
        "to": parse_json(row.get::<_, String>(8)?),
        "cc": parse_json(row.get::<_, String>(9)?),
        "bcc": parse_json(row.get::<_, String>(10)?),
        "subject": row.get::<_, Option<String>>(11)?,
        "bodyText": row.get::<_, Option<String>>(12)?,
        "bodyHtml": row.get::<_, Option<String>>(13)?,
        "inReplyTo": row.get::<_, Option<String>>(14)?,
        "referencesHeader": row.get::<_, Option<String>>(15)?,
        "sentAt": row.get::<_, Option<String>>(16)?,
        "deletedAt": row.get::<_, Option<String>>(17)?,
        "lastError": row.get::<_, Option<String>>(18)?,
        "lastWarning": row.get::<_, Option<String>>(19)?,
        "createdAt": row.get::<_, String>(20)?,
        "updatedAt": row.get::<_, String>(21)?
    }))
}

fn get_outbox(connection: &Connection, outbox_id: i64) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT outbox_id,account_id,related_message_id,compose_kind,status,
                    rfc822_message_id,from_name,from_email,to_json,cc_json,bcc_json,
                    subject,body_text,body_html,in_reply_to,references_header,sent_at,
                    deleted_at,last_error,last_warning,created_at,updated_at
             FROM onemail_outbox_messages WHERE outbox_id=?1",
            [outbox_id],
            map_outbox,
        )
        .optional()
        .map_err(database_error)
}

fn delete_outbox(state: &AppState, outbox_id: i64) -> Result<bool, String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_outbox_messages SET status='deleted',
              deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE outbox_id=?1",
            [outbox_id],
        )
        .map(|changes| changes > 0)
        .map_err(database_error)
}

fn create_related_draft(state: &AppState, input: &Value, forward: bool) -> Result<Value, String> {
    let object = require_object(input)?;
    let message_id = required_i64(object, "messageId", "邮件 ID 无效。")?;
    let connection = db::open(state)?;
    let detail =
        get_message_detail(&connection, message_id)?.ok_or_else(|| "原邮件不存在。".to_string())?;
    let detail_object = require_object(&detail)?;
    let subject = optional_string(detail_object, "subject").unwrap_or_default();
    let account_id = optional_i64(detail_object, "accountId").unwrap_or_default();
    let from_email = optional_string(detail_object, "fromEmail").unwrap_or_default();
    let mode = optional_string(object, "mode")
        .unwrap_or_else(|| if forward { "forward" } else { "reply" }.to_string());
    let next_subject = if forward {
        format_subject("Fwd:", &subject)
    } else {
        format_subject("Re:", &subject)
    };
    Ok(json!({
        "accountId": account_id,
        "mode": mode,
        "relatedMessageId": message_id,
        "to": if forward || from_email.is_empty() { json!([]) } else { json!([{ "email": from_email }]) },
        "cc": [],
        "bcc": [],
        "subject": next_subject,
        "bodyText": "",
        "bodyHtml": null
    }))
}

fn format_subject(prefix: &str, subject: &str) -> String {
    if subject.to_lowercase().starts_with(&prefix.to_lowercase()) {
        subject.to_string()
    } else {
        format!("{prefix} {subject}").trim().to_string()
    }
}

fn encrypt_password(database_key: &str, password: &str) -> Result<String, String> {
    let key = Sha256::digest(database_key.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "创建凭据加密器失败。".to_string())?;
    let mut iv = [0_u8; 12];
    rand::rng().fill_bytes(&mut iv);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), password.as_bytes())
        .map_err(|_| "加密账号凭据失败。".to_string())?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .ok_or_else(|| "加密账号凭据失败。".to_string())?;
    let payload = json!({
        "version": 1,
        "alg": "aes-256-gcm",
        "iv": BASE64.encode(iv),
        "authTag": BASE64.encode(&encrypted[tag_start..]),
        "ciphertext": BASE64.encode(&encrypted[..tag_start])
    });
    Ok(BASE64.encode(serde_json::to_vec(&payload).map_err(|error| error.to_string())?))
}

fn require_object(value: &Value) -> Result<&Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "请求参数格式无效。".to_string())
}

fn required_string(
    object: &Map<String, Value>,
    key: &str,
    message: &str,
) -> Result<String, String> {
    optional_string(object, key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| message.to_string())
}

fn optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn required_i64(object: &Map<String, Value>, key: &str, message: &str) -> Result<i64, String> {
    optional_i64(object, key).ok_or_else(|| message.to_string())
}

fn optional_i64(object: &Map<String, Value>, key: &str) -> Option<i64> {
    object.get(key).and_then(Value::as_i64)
}

fn optional_bool(object: &Map<String, Value>, key: &str) -> Option<bool> {
    object.get(key).and_then(Value::as_bool)
}

fn database_error(error: rusqlite::Error) -> String {
    format!("数据库操作失败：{error}")
}

#[allow(dead_code)]
fn sqlite_value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::from(value),
        ValueRef::Real(value) => Value::from(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::String(BASE64.encode(value)),
    }
}
