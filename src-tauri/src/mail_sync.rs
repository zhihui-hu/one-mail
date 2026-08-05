#[path = "gmail_api.rs"]
mod gmail_api;
#[path = "graph_api.rs"]
mod graph_api;

use async_imap::types::{Flag, Mailbox};
use futures_util::TryStreamExt;
use mailparse::MailHeaderMap;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::{db, mail_transport, state::AppState};

const MAX_MESSAGES: usize = 200;

pub async fn sync_all(state: &AppState, mode: Option<&str>) -> Result<Value, String> {
    let account_ids = {
        let connection = db::open(state)?;
        let mut statement = connection
            .prepare(
                "SELECT account_id FROM onemail_mail_accounts
                 WHERE sync_enabled=1 AND status <> 'disabled'
                 ORDER BY sort_order,account_id",
            )
            .map_err(|error| format!("读取同步账号失败：{error}"))?;
        let ids = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("读取同步账号失败：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取同步账号失败：{error}"))?;
        ids
    };

    let mut results = Vec::with_capacity(account_ids.len());
    for account_id in account_ids {
        results.push(match sync_account(state, account_id, mode).await {
            Ok(value) => value,
            Err(error) => json!({ "accountId": account_id, "ok": false, "error": error }),
        });
    }
    Ok(json!({ "mode": mode, "accounts": results }))
}

pub async fn sync_account(
    state: &AppState,
    account_id: i64,
    _mode: Option<&str>,
) -> Result<Value, String> {
    let account = mail_transport::load_account(state, account_id)?;
    set_syncing(state, account_id)?;

    let result = sync_account_inner(state, &account).await;
    match result {
        Ok(value) => {
            let connection = db::open(state)?;
            connection
                .execute(
                    "UPDATE onemail_mail_accounts SET status='active',last_sync_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                       last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
                    [account_id],
                )
                .map_err(|error| format!("更新同步状态失败：{error}"))?;
            Ok(value)
        }
        Err(error) => {
            let connection = db::open(state)?;
            connection
                .execute(
                    "UPDATE onemail_mail_accounts SET status=CASE WHEN connection_state='reauthorize' THEN 'auth_error' ELSE 'sync_error' END,
                       last_error=?2,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
                    params![account_id, error],
                )
                .map_err(|db_error| format!("保存同步错误失败：{db_error}"))?;
            Err(error)
        }
    }
}

async fn sync_account_inner(
    state: &AppState,
    account: &mail_transport::MailAccount,
) -> Result<Value, String> {
    let provider_key = account.provider_key.to_ascii_lowercase();
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "gmail" | "google") {
        match gmail_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                let value = sync_account_imap(state, account).await?;
                return Ok(with_api_fallback(value, "gmail-history", reason));
            }
        }
    }
    if account.auth_type == "oauth2" && matches!(provider_key.as_str(), "outlook" | "microsoft") {
        match graph_api::sync(state, account).await {
            Ok(value) => return Ok(value),
            Err(reason) => {
                let value = sync_account_imap(state, account).await?;
                return Ok(with_api_fallback(value, "graph-delta", reason));
            }
        }
    }
    sync_account_imap(state, account).await
}

fn with_api_fallback(mut value: Value, api: &str, reason: String) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("syncPath".to_string(), Value::String("imap".to_string()));
        object.insert("apiFallback".to_string(), Value::String(api.to_string()));
        object.insert("apiFallbackReason".to_string(), Value::String(reason));
    }
    value
}

async fn sync_account_imap(
    state: &AppState,
    account: &mail_transport::MailAccount,
) -> Result<Value, String> {
    let folders = load_imap_sync_folders(state, account.account_id)?;
    let mut session = mail_transport::connect_authenticated(state, account).await?;
    let mut results = Vec::with_capacity(folders.len());
    let mut failures = Vec::new();
    for folder in &folders {
        match sync_imap_folder(state, account, &mut session, folder).await {
            Ok(result) => results.push(result),
            Err(error) => {
                let _ = set_folder_sync_error(state, folder.folder_id, account.account_id, &error);
                failures.push(format!("{}：{error}", folder.path));
            }
        }
    }
    if let Err(error) = session.logout().await {
        failures.push(format!("关闭 IMAP 连接失败：{error}"));
    }
    if !failures.is_empty() {
        return Err(format!("同步部分 IMAP 文件夹失败：{}", failures.join("；")));
    }

    let fetched_count = results
        .iter()
        .filter_map(|result| result.get("fetchedCount").and_then(Value::as_u64))
        .sum::<u64>();
    let deleted_count = results
        .iter()
        .filter_map(|result| result.get("deletedCount").and_then(Value::as_u64))
        .sum::<u64>();
    Ok(json!({
        "accountId": account.account_id,
        "folders": results,
        "fetchedCount": fetched_count,
        "deletedCount": deleted_count,
        "syncPath": "imap",
        "ok": true
    }))
}

#[derive(Clone, Debug)]
struct ImapSyncFolder {
    folder_id: i64,
    path: String,
}

fn load_imap_sync_folders(
    state: &AppState,
    account_id: i64,
) -> Result<Vec<ImapSyncFolder>, String> {
    let connection = db::open(state)?;
    ensure_inbox(&connection, account_id)?;
    let mut statement = connection
        .prepare(
            "SELECT folder_id,path FROM onemail_mail_folders
             WHERE account_id=?1 AND sync_enabled=1 AND is_selectable=1
             ORDER BY CASE WHEN path='INBOX' THEN 0 ELSE 1 END,sort_order,folder_id",
        )
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?;
    let folders = statement
        .query_map([account_id], |row| {
            Ok(ImapSyncFolder {
                folder_id: row.get(0)?,
                path: row.get(1)?,
            })
        })
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取同步文件夹失败：{error}"))?;
    Ok(folders)
}

async fn sync_imap_folder(
    state: &AppState,
    account: &mail_transport::MailAccount,
    session: &mut mail_transport::ImapSession,
    folder: &ImapSyncFolder,
) -> Result<Value, String> {
    let mailbox = session
        .select(&folder.path)
        .await
        .map_err(|error| format!("打开文件夹失败：{error}"))?;
    let uid_validity_reset = persist_selected_mailbox(state, folder, &mailbox)?;
    let mut uids = session
        .uid_search("ALL")
        .await
        .map_err(|error| format!("读取邮件列表失败：{error}"))?
        .into_iter()
        .collect::<Vec<_>>();
    uids.sort_unstable();
    if uids.len() > MAX_MESSAGES {
        uids = uids.split_off(uids.len() - MAX_MESSAGES);
    }

    let mut fetched = Vec::new();
    if !uids.is_empty() {
        let uid_set = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let mut stream = session
            .uid_fetch(uid_set, "UID FLAGS INTERNALDATE RFC822.SIZE RFC822.HEADER")
            .await
            .map_err(|error| format!("读取邮件摘要失败：{error}"))?;
        while let Some(fetch) = stream
            .try_next()
            .await
            .map_err(|error| format!("读取邮件摘要失败：{error}"))?
        {
            let Some(uid) = fetch.uid else { continue };
            let headers = fetch
                .header()
                .map(|value| mailparse::parse_headers(value).map(|(headers, _)| headers))
                .transpose()
                .map_err(|error| format!("解析邮件摘要失败：{error}"))?
                .unwrap_or_default();
            let from = headers.get_first_value("From");
            let (from_name, from_email) = parse_from(from.as_deref());
            let internal_date = fetch.internal_date().map(|date| date.to_rfc3339());
            fetched.push(FetchedMessage {
                uid: i64::from(uid),
                subject: headers.get_first_value("Subject"),
                message_id: headers.get_first_value("Message-ID"),
                from_name,
                from_email,
                received_at: headers
                    .get_first_value("Date")
                    .or_else(|| internal_date.clone()),
                internal_date,
                in_reply_to: headers.get_first_value("In-Reply-To"),
                references_header: headers.get_first_value("References"),
                snippet: headers.get_first_value("Subject"),
                size_bytes: fetch.size.unwrap_or(0),
                is_read: fetch.flags().any(|flag| matches!(flag, Flag::Seen)),
                has_attachments: false,
                remote_deleted: false,
            });
        }
        drop(stream);
    }
    let connection = db::open(state)?;
    let mut result = apply_messages(
        &connection,
        account.account_id,
        folder.folder_id,
        &folder.path,
        &fetched,
        None,
        "imap",
    )?;
    if let Some(object) = result.as_object_mut() {
        object.insert(
            "uidValidityReset".to_string(),
            Value::Bool(uid_validity_reset),
        );
    }
    Ok(result)
}

fn persist_selected_mailbox(
    state: &AppState,
    folder: &ImapSyncFolder,
    mailbox: &Mailbox,
) -> Result<bool, String> {
    let mut connection = db::open(state)?;
    let previous_uid_validity = connection
        .query_row(
            "SELECT uid_validity FROM onemail_mail_folders WHERE folder_id=?1",
            [folder.folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("读取文件夹 UIDVALIDITY 失败：{error}"))?
        .flatten();
    let uid_validity = mailbox.uid_validity.map(|value| value.to_string());
    let reset = uid_validity_changed(previous_uid_validity.as_deref(), uid_validity.as_deref());
    let uid_next = mailbox.uid_next.map(i64::from);
    let highest_modseq = mailbox.highest_modseq.map(|value| value.to_string());
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始更新文件夹状态失败：{error}"))?;
    if reset {
        transaction
            .execute(
                "DELETE FROM onemail_message_search WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("清理文件夹搜索索引失败：{error}"))?;
        transaction
            .execute(
                "DELETE FROM onemail_mail_messages WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("清理 UIDVALIDITY 已变化的邮件失败：{error}"))?;
        transaction
            .execute(
                "DELETE FROM onemail_folder_sync_states WHERE folder_id=?1",
                [folder.folder_id],
            )
            .map_err(|error| format!("重置文件夹同步状态失败：{error}"))?;
    }
    transaction
        .execute(
            "UPDATE onemail_mail_folders SET uid_validity=COALESCE(?2,uid_validity),
               uid_next=COALESCE(?3,uid_next),highest_modseq=COALESCE(?4,highest_modseq),
               total_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND remote_deleted=0 AND user_hidden=0),
               unread_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND is_read=0 AND remote_deleted=0 AND user_hidden=0),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE folder_id=?1",
            params![folder.folder_id, uid_validity, uid_next, highest_modseq],
        )
        .map_err(|error| format!("更新文件夹 UID 状态失败：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("提交文件夹 UID 状态失败：{error}"))?;
    Ok(reset)
}

fn uid_validity_changed(previous: Option<&str>, current: Option<&str>) -> bool {
    matches!((previous, current), (Some(previous), Some(current)) if previous != current)
}

fn set_folder_sync_error(
    state: &AppState,
    folder_id: i64,
    account_id: i64,
    error: &str,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_folder_sync_states(folder_id,account_id,status,last_error,finished_at)
             VALUES (?1,?2,'error',?3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(folder_id) DO UPDATE SET status='error',last_error=excluded.last_error,
               finished_at=excluded.finished_at,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![folder_id, account_id, error],
        )
        .map(|_| ())
        .map_err(|db_error| format!("保存文件夹同步错误失败：{db_error}"))
}

pub(crate) struct FetchedMessage {
    pub(crate) uid: i64,
    subject: Option<String>,
    message_id: Option<String>,
    from_name: Option<String>,
    from_email: Option<String>,
    received_at: Option<String>,
    internal_date: Option<String>,
    in_reply_to: Option<String>,
    references_header: Option<String>,
    snippet: Option<String>,
    size_bytes: u32,
    is_read: bool,
    has_attachments: bool,
    remote_deleted: bool,
}

pub(crate) fn fetched_message(
    uid: i64,
    subject: Option<String>,
    message_id: Option<String>,
    from_name: Option<String>,
    from_email: Option<String>,
    received_at: Option<String>,
    internal_date: Option<String>,
    in_reply_to: Option<String>,
    references_header: Option<String>,
    snippet: Option<String>,
    size_bytes: u32,
    is_read: bool,
    has_attachments: bool,
    remote_deleted: bool,
) -> FetchedMessage {
    FetchedMessage {
        uid,
        subject,
        message_id,
        from_name,
        from_email,
        received_at,
        internal_date,
        in_reply_to,
        references_header,
        snippet,
        size_bytes,
        is_read,
        has_attachments,
        remote_deleted,
    }
}

pub(crate) fn read_cursor(
    connection: &Connection,
    folder_id: i64,
    prefix: &str,
) -> Result<Option<String>, String> {
    let value = connection
        .query_row(
            "SELECT highest_modseq FROM onemail_folder_sync_states WHERE folder_id=?1",
            [folder_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("读取同步游标失败：{error}"))?
        .flatten();
    Ok(value
        .filter(|value| value.starts_with(prefix))
        .map(|value| value[prefix.len()..].to_string()))
}

pub(crate) fn apply_messages(
    connection: &Connection,
    account_id: i64,
    folder_id: i64,
    folder_path: &str,
    messages: &[FetchedMessage],
    cursor: Option<&str>,
    sync_path: &str,
) -> Result<Value, String> {
    for message in messages {
        connection
            .execute(
                "INSERT INTO onemail_mail_messages
                   (account_id,folder_id,uid,rfc822_message_id,in_reply_to,references_header,subject,
                    from_name,from_email,received_at,internal_date,snippet,size_bytes,is_read,
                    has_attachments,flags_json,remote_deleted)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'[]',?16)
                 ON CONFLICT(account_id,folder_id,uid) DO UPDATE SET
                   rfc822_message_id=excluded.rfc822_message_id,in_reply_to=excluded.in_reply_to,
                   references_header=excluded.references_header,subject=excluded.subject,
                   from_name=excluded.from_name,from_email=excluded.from_email,
                   received_at=excluded.received_at,internal_date=excluded.internal_date,
                   snippet=excluded.snippet,size_bytes=excluded.size_bytes,is_read=excluded.is_read,
                   has_attachments=excluded.has_attachments,remote_deleted=excluded.remote_deleted,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    account_id,
                    folder_id,
                    message.uid,
                    message.message_id,
                    message.in_reply_to,
                    message.references_header,
                    message.subject,
                    message.from_name,
                    message.from_email,
                    message.received_at,
                    message.internal_date,
                    message.snippet,
                    i64::from(message.size_bytes),
                    message.is_read,
                    message.has_attachments,
                    message.remote_deleted,
                ],
            )
            .map_err(|error| format!("保存邮件摘要失败：{error}"))?;
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_folder_sync_states(folder_id,account_id) VALUES (?1,?2)",
            params![folder_id, account_id],
        )
        .map_err(|error| format!("初始化同步状态失败：{error}"))?;
    let last_uid = messages.iter().map(|message| message.uid).max();
    connection
        .execute(
            "UPDATE onemail_folder_sync_states SET
               highest_modseq=COALESCE(?2,highest_modseq),last_uid=MAX(last_uid,COALESCE(?3,last_uid)),
               uid_validity=(SELECT uid_validity FROM onemail_mail_folders WHERE folder_id=?1),
               last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),status='idle',last_error=NULL,
               finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE folder_id=?1",
            params![folder_id, cursor, last_uid],
        )
        .map_err(|error| format!("保存同步游标失败：{error}"))?;
    connection
        .execute(
            "UPDATE onemail_mail_folders SET total_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND remote_deleted=0 AND user_hidden=0),
               unread_count=(SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id=?1 AND is_read=0 AND remote_deleted=0 AND user_hidden=0),
               last_sync_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE folder_id=?1",
            [folder_id],
        )
        .map_err(|error| format!("更新文件夹同步状态失败：{error}"))?;

    Ok(json!({
        "accountId": account_id,
        "folder": folder_path,
        "fetchedCount": messages.iter().filter(|message| !message.remote_deleted).count(),
        "deletedCount": messages.iter().filter(|message| message.remote_deleted).count(),
        "syncPath": sync_path,
        "ok": true
    }))
}

fn ensure_inbox(connection: &Connection, account_id: i64) -> Result<i64, String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_mail_folders
               (account_id,path,name,role,sync_enabled,sort_order)
             VALUES (?1,'INBOX','INBOX','inbox',1,0)",
            [account_id],
        )
        .map_err(|error| format!("保存收件箱失败：{error}"))?;
    connection
        .query_row(
            "SELECT folder_id FROM onemail_mail_folders WHERE account_id=?1 AND path='INBOX'",
            [account_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("读取收件箱失败：{error}"))
}

fn set_syncing(state: &AppState, account_id: i64) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET status='syncing',last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
            [account_id],
        )
        .map(|_| ())
        .map_err(|error| format!("更新同步状态失败：{error}"))
}

fn parse_from(value: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    if let Some(start) = value.rfind('<') {
        if let Some(end) = value[start + 1..].find('>') {
            let email = value[start + 1..start + 1 + end].trim().to_string();
            let name = value[..start].trim().trim_matches('"').trim().to_string();
            return (
                (!name.is_empty()).then_some(name),
                (!email.is_empty()).then_some(email),
            );
        }
    }
    (
        None,
        Some(value.trim().to_string()).filter(|email| email.contains('@')),
    )
}

#[cfg(test)]
mod tests {
    use super::uid_validity_changed;

    #[test]
    fn only_resets_a_folder_when_known_uid_validity_changes() {
        assert!(uid_validity_changed(Some("123"), Some("456")));
        assert!(!uid_validity_changed(Some("123"), Some("123")));
        assert!(!uid_validity_changed(None, Some("123")));
        assert!(!uid_validity_changed(Some("123"), None));
    }
}
