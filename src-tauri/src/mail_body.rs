use mailparse::{parse_mail, DispositionType, ParsedMail};
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::{
    db,
    mail_transport::{self, MailAccount},
    state::AppState,
};

#[derive(Default)]
struct ParsedMessageBody {
    text: Option<String>,
    html: Option<String>,
    attachments: Vec<ParsedAttachment>,
}

struct ParsedAttachment {
    filename: String,
    mime_type: String,
    disposition: String,
    size_bytes: usize,
}

pub async fn load_message_body(state: &AppState, message_id: i64) -> Result<Value, String> {
    let locator = get_message_locator(state, message_id)?
        .ok_or_else(|| format!("邮件不存在：{message_id}"))?;
    set_body_status(state, message_id, "loading", None)?;

    let result = async {
        let raw_message = mail_transport::fetch_raw_message(
            state,
            &locator.account,
            &locator.folder_path,
            locator.uid,
        )
        .await?;
        let parsed = parse_message(&raw_message)?;
        persist_message_body(state, message_id, locator.account.account_id, parsed)
    }
    .await;

    if let Err(error) = &result {
        let _ = set_body_status(state, message_id, "error", Some(error));
    }
    result
}

struct MessageLocator {
    account: MailAccount,
    folder_path: String,
    uid: u32,
}

fn get_message_locator(
    state: &AppState,
    message_id: i64,
) -> Result<Option<MessageLocator>, String> {
    let connection = db::open(state)?;
    connection
        .query_row(
            "SELECT f.path,m.uid,m.account_id
             FROM onemail_mail_messages m
             JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
             WHERE m.message_id=?1",
            [message_id],
            |row| {
                let uid = row.get::<_, i64>(1)?;
                Ok((row.get::<_, String>(0)?, uid, row.get::<_, i64>(2)?))
            },
        )
        .optional()
        .map_err(|error| format!("读取邮件定位信息失败：{error}"))?
        .map(|(folder_path, uid, account_id)| {
            let account = mail_transport::load_account(state, account_id)?;
            Ok(MessageLocator {
                account,
                folder_path,
                uid: u32::try_from(uid).map_err(|_| "邮件 UID 无效。".to_string())?,
            })
        })
        .transpose()
}

fn set_body_status(
    state: &AppState,
    message_id: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_messages
             SET body_status=?2,body_error=?3,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE message_id=?1",
            params![message_id, status, error],
        )
        .map(|_| ())
        .map_err(|error| format!("更新正文状态失败：{error}"))
}

fn parse_message(raw_message: &[u8]) -> Result<ParsedMessageBody, String> {
    let parsed = parse_mail(raw_message).map_err(|error| format!("解析邮件正文失败：{error}"))?;
    let mut leaves = Vec::new();
    collect_leaf_parts(&parsed, &mut leaves);
    let text = leaves
        .iter()
        .find(|part| part.ctype.mimetype.eq_ignore_ascii_case("text/plain"))
        .and_then(|part| part.get_body().ok())
        .filter(|value| !value.trim().is_empty());
    let html = leaves
        .iter()
        .find(|part| part.ctype.mimetype.eq_ignore_ascii_case("text/html"))
        .and_then(|part| part.get_body().ok())
        .filter(|value| !value.trim().is_empty());
    let attachments = leaves
        .iter()
        .filter_map(|part| {
            let disposition = part.get_content_disposition();
            let disposition_name = match disposition.disposition {
                DispositionType::Attachment => "attachment",
                DispositionType::Inline => "inline",
                _ => return None,
            };
            let filename = disposition
                .params
                .get("filename")
                .or_else(|| part.ctype.params.get("name"))?
                .trim()
                .to_string();
            if filename.is_empty() {
                return None;
            }
            let size_bytes = part.get_body_raw().ok()?.len();
            Some(ParsedAttachment {
                filename,
                mime_type: part.ctype.mimetype.clone(),
                disposition: disposition_name.to_string(),
                size_bytes,
            })
        })
        .collect();

    Ok(ParsedMessageBody {
        text,
        html,
        attachments,
    })
}

fn collect_leaf_parts<'a>(part: &'a ParsedMail<'a>, leaves: &mut Vec<&'a ParsedMail<'a>>) {
    if part.subparts.is_empty() {
        leaves.push(part);
        return;
    }
    for child in &part.subparts {
        collect_leaf_parts(child, leaves);
    }
}

fn persist_message_body(
    state: &AppState,
    message_id: i64,
    account_id: i64,
    parsed: ParsedMessageBody,
) -> Result<Value, String> {
    let body_text = parsed.text.as_deref().map(normalize_body_text);
    let body_html = parsed.html.as_deref().and_then(sanitize_html);
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_message_bodies
               (message_id,body_text,body_html_sanitized,external_images_blocked,sanitized_at)
             VALUES (?1,?2,?3,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(message_id) DO UPDATE SET
               body_text=excluded.body_text,body_html_sanitized=excluded.body_html_sanitized,
               external_images_blocked=excluded.external_images_blocked,
               sanitized_at=excluded.sanitized_at,loaded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![message_id, body_text, body_html],
        )
        .map_err(|error| format!("保存邮件正文失败：{error}"))?;
    connection
        .execute(
            "DELETE FROM onemail_message_attachments WHERE message_id=?1",
            [message_id],
        )
        .map_err(|error| format!("更新附件信息失败：{error}"))?;
    for attachment in &parsed.attachments {
        connection
            .execute(
                "INSERT INTO onemail_message_attachments
                   (message_id,filename,mime_type,content_disposition,size_bytes)
                 VALUES (?1,?2,?3,?4,?5)",
                params![
                    message_id,
                    attachment.filename,
                    attachment.mime_type,
                    attachment.disposition,
                    attachment.size_bytes as i64
                ],
            )
            .map_err(|error| format!("保存附件信息失败：{error}"))?;
    }
    connection
        .execute(
            "UPDATE onemail_mail_messages SET has_attachments=?2,body_status='ready',
               body_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE message_id=?1",
            params![
                message_id,
                if parsed.attachments.is_empty() {
                    0_i64
                } else {
                    1_i64
                }
            ],
        )
        .map_err(|error| format!("更新正文状态失败：{error}"))?;

    let search_text = body_text
        .as_deref()
        .map(str::to_string)
        .or_else(|| body_html.as_deref().map(html_to_text))
        .unwrap_or_default();
    update_search_index(&connection, message_id, account_id, &search_text)?;

    Ok(json!({
        "messageId": message_id,
        "bodyText": body_text,
        "bodyHtmlSanitized": body_html,
        "externalImagesBlocked": true
    }))
}

fn update_search_index(
    connection: &rusqlite::Connection,
    message_id: i64,
    account_id: i64,
    body_text: &str,
) -> Result<(), String> {
    let metadata = connection
        .query_row(
            "SELECT folder_id,subject,from_name,from_email,snippet
             FROM onemail_mail_messages WHERE message_id=?1",
            [message_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                ))
            },
        )
        .map_err(|error| format!("读取搜索索引信息失败：{error}"))?;
    connection
        .execute(
            "DELETE FROM onemail_message_search WHERE message_id=?1",
            [message_id],
        )
        .map_err(|error| format!("更新搜索索引失败：{error}"))?;
    connection
        .execute(
            "INSERT INTO onemail_message_search
               (message_id,account_id,folder_id,subject,from_name,from_email,snippet,body_text)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                message_id, account_id, metadata.0, metadata.1, metadata.2, metadata.3, metadata.4,
                body_text
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("更新搜索索引失败：{error}"))
}

fn normalize_body_text(value: &str) -> String {
    value
        .replace('\0', "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn sanitize_html(value: &str) -> Option<String> {
    let mut sanitized = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .expect("valid script regex")
        .replace_all(value, "")
        .into_owned();
    sanitized = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .expect("valid style regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .expect("valid event regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+(src|href)\s*=\s*"javascript:[^"]*""#)
        .expect("valid javascript regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+src="((?:https?:)?//[^"\s>]+)""#)
        .expect("valid remote source regex")
        .replace_all(&sanitized, r#" data-blocked-src="$1""#)
        .into_owned();
    sanitized = Regex::new(r"(?i)\s+src='((?:https?:)?//[^'\s>]+)'")
        .expect("valid remote source regex")
        .replace_all(&sanitized, " data-blocked-src='$1'")
        .into_owned();
    let sanitized = sanitized.trim().to_string();
    (!sanitized.is_empty()).then_some(sanitized)
}

fn html_to_text(value: &str) -> String {
    Regex::new(r"(?is)<[^>]+>")
        .expect("valid html regex")
        .replace_all(value, " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
