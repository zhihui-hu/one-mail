use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

use crate::{db, mail_body, state::AppState};

use super::utils::{database_error, optional_i64, optional_string, require_object, required_i64};

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
pub async fn messages_load_body(
    state: State<'_, AppState>,
    message_id: i64,
) -> Result<Value, String> {
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

    if let Some(body) = body {
        return Ok(json!({ "body": body, "error": null }));
    }

    drop(connection);
    match mail_body::load_message_body(&state, message_id).await {
        Ok(body) => Ok(json!({ "body": body, "error": null })),
        Err(error) => Ok(json!({ "body": null, "error": error })),
    }
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

pub(crate) fn get_message_detail(
    connection: &Connection,
    message_id: i64,
) -> Result<Option<Value>, String> {
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
