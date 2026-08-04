use std::fs;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::{db, smtp_send, state::AppState};

use super::{
    messages::get_message_detail,
    utils::{database_error, optional_i64, optional_string, require_object, required_i64},
};

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
pub async fn compose_send(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    smtp_send::send_message(&state, input).await
}

#[tauri::command]
pub async fn compose_retry(state: State<'_, AppState>, outbox_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    let outbox = get_outbox(&connection, outbox_id)?
        .ok_or_else(|| format!("发信记录不存在：{outbox_id}"))?;
    drop(connection);
    smtp_send::send_message(&state, outbox).await
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
