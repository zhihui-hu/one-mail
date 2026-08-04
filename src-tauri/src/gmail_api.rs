use std::collections::HashSet;

use reqwest::{Client, StatusCode};
use serde_json::Value;
use url::form_urlencoded::Serializer;

use crate::{
    db,
    mail_sync::{apply_messages, ensure_inbox, fetched_message, read_cursor, FetchedMessage},
    mail_transport::MailAccount,
    oauth,
    state::AppState,
};

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const CURSOR_PREFIX: &str = "gmail-history:";
const MAX_MESSAGES: usize = 200;

pub async fn sync(state: &AppState, account: &MailAccount) -> Result<Value, String> {
    let connection = db::open(state)?;
    let folder_id = ensure_inbox(&connection, account.account_id)?;
    let cursor = read_cursor(&connection, folder_id, CURSOR_PREFIX)?;
    drop(connection);

    let token = oauth::access_token(state, account.account_id, &account.provider_key).await?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| format!("创建 Gmail API 客户端失败：{error}"))?;
    match sync_with_token(
        state,
        account,
        folder_id,
        cursor.as_deref(),
        &client,
        &token.access_token,
    )
    .await
    {
        Ok(value) => Ok(value),
        Err(ApiError::Unauthorized) => {
            let refreshed = oauth::force_refresh_access_token(
                state,
                account.account_id,
                &account.provider_key,
                Some(&token.access_token),
            )
            .await?;
            sync_with_token(
                state,
                account,
                folder_id,
                cursor.as_deref(),
                &client,
                &refreshed.access_token,
            )
            .await
            .map_err(ApiError::into_message)
        }
        Err(error) => Err(error.into_message()),
    }
}

async fn sync_with_token(
    state: &AppState,
    account: &MailAccount,
    folder_id: i64,
    cursor: Option<&str>,
    client: &Client,
    access_token: &str,
) -> Result<Value, ApiError> {
    let (messages, history_id, full_scan) = if let Some(cursor) = cursor {
        match history_messages(client, access_token, cursor).await {
            Ok(value) => value,
            Err(ApiError::HistoryExpired) => full_messages(client, access_token).await?,
            Err(error) => return Err(error),
        }
    } else {
        full_messages(client, access_token).await?
    };

    let connection = db::open(state).map_err(ApiError::other)?;
    let result = apply_messages(
        &connection,
        account.account_id,
        folder_id,
        &messages,
        Some(&format!("{CURSOR_PREFIX}{history_id}")),
        "gmail-history",
    )
    .map_err(ApiError::other)?;
    let mut result = result;
    if let Some(object) = result.as_object_mut() {
        object.insert("fullScan".to_string(), Value::Bool(full_scan));
    }
    Ok(result)
}

async fn full_messages(
    client: &Client,
    access_token: &str,
) -> Result<(Vec<FetchedMessage>, String, bool), ApiError> {
    let mut ids = Vec::new();
    let mut page_token: Option<String> = None;
    while ids.len() < MAX_MESSAGES {
        let mut query = vec![("labelIds", "INBOX"), ("maxResults", "100")];
        if let Some(page_token) = &page_token {
            query.push(("pageToken", page_token));
        }
        let request = client
            .get(with_query(&format!("{GMAIL_API}/messages"), &query))
            .bearer_auth(access_token);
        let payload = get_json(request).await?;
        if let Some(values) = payload.get("messages").and_then(Value::as_array) {
            ids.extend(
                values
                    .iter()
                    .filter_map(|message| message.get("id").and_then(Value::as_str))
                    .map(str::to_string),
            );
        }
        if ids.len() >= MAX_MESSAGES {
            ids.truncate(MAX_MESSAGES);
            break;
        }
        page_token = payload
            .get("nextPageToken")
            .and_then(Value::as_str)
            .map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }
    let mut messages = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(message) = get_message(client, access_token, &id).await? {
            messages.push(message);
        }
    }
    let profile = get_json(
        client
            .get(format!("{GMAIL_API}/profile"))
            .bearer_auth(access_token),
    )
    .await?;
    let history_id = profile
        .get("historyId")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::other("Gmail API 未返回 historyId。"))?
        .to_string();
    Ok((messages, history_id, true))
}

async fn history_messages(
    client: &Client,
    access_token: &str,
    start_history_id: &str,
) -> Result<(Vec<FetchedMessage>, String, bool), ApiError> {
    let mut page_token: Option<String> = None;
    let mut changed_ids = HashSet::new();
    let mut deleted_ids = HashSet::new();
    let mut history_id = None;

    loop {
        let mut query = vec![
            ("startHistoryId", start_history_id),
            ("historyTypes", "messageAdded"),
            ("historyTypes", "messageDeleted"),
            ("historyTypes", "labelAdded"),
            ("historyTypes", "labelRemoved"),
        ];
        if let Some(page_token) = &page_token {
            query.push(("pageToken", page_token));
        }
        let request = client
            .get(with_query(&format!("{GMAIL_API}/history"), &query))
            .bearer_auth(access_token);
        let payload = get_json(request).await?;
        history_id = payload
            .get("historyId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(history_id);
        if let Some(history) = payload.get("history").and_then(Value::as_array) {
            for entry in history {
                collect_message_ids(entry.get("messagesAdded"), &mut changed_ids);
                collect_message_ids(entry.get("messages"), &mut changed_ids);
                collect_message_ids(entry.get("messagesDeleted"), &mut deleted_ids);
            }
        }
        page_token = payload
            .get("nextPageToken")
            .and_then(Value::as_str)
            .map(str::to_string);
        if page_token.is_none() {
            break;
        }
    }

    let mut messages = Vec::with_capacity(changed_ids.len() + deleted_ids.len());
    for id in changed_ids.difference(&deleted_ids) {
        if let Some(message) = get_message(client, access_token, id).await? {
            messages.push(message);
        }
    }
    for id in deleted_ids {
        messages.push(fetched_message(
            stable_uid(&id),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            false,
            true,
        ));
    }
    let history_id =
        history_id.ok_or_else(|| ApiError::other("Gmail API 未返回新的 historyId。"))?;
    Ok((messages, history_id, false))
}

fn collect_message_ids(value: Option<&Value>, target: &mut HashSet<String>) {
    if let Some(values) = value.and_then(Value::as_array) {
        for item in values {
            if let Some(id) = item
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(Value::as_str)
                .or_else(|| item.get("id").and_then(Value::as_str))
            {
                target.insert(id.to_string());
            }
        }
    }
}

async fn get_message(
    client: &Client,
    access_token: &str,
    id: &str,
) -> Result<Option<FetchedMessage>, ApiError> {
    let query = [
        ("format", "metadata"),
        ("metadataHeaders", "Subject"),
        ("metadataHeaders", "From"),
        ("metadataHeaders", "Date"),
        ("metadataHeaders", "Message-ID"),
        ("metadataHeaders", "In-Reply-To"),
        ("metadataHeaders", "References"),
    ];
    let payload = get_json(
        client
            .get(with_query(&format!("{GMAIL_API}/messages/{id}"), &query))
            .bearer_auth(access_token),
    )
    .await?;
    let labels = payload
        .get("labelIds")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    if !labels.contains("INBOX") {
        return Ok(Some(fetched_message(
            stable_uid(id),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            0,
            false,
            false,
            true,
        )));
    }
    let headers = payload
        .get("payload")
        .and_then(|payload| payload.get("headers"))
        .and_then(Value::as_array);
    let header = |name: &str| {
        headers.and_then(|values| {
            values.iter().find_map(|item| {
                (item.get("name").and_then(Value::as_str) == Some(name))
                    .then(|| {
                        item.get("value")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .flatten()
            })
        })
    };
    let (from_name, from_email) = parse_from(header("From").as_deref());
    Ok(Some(fetched_message(
        stable_uid(id),
        header("Subject"),
        header("Message-ID"),
        from_name,
        from_email,
        header("Date"),
        payload
            .get("internalDate")
            .and_then(Value::as_str)
            .and_then(parse_millis),
        header("In-Reply-To"),
        header("References"),
        payload
            .get("snippet")
            .and_then(Value::as_str)
            .map(str::to_string),
        payload
            .get("sizeEstimate")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(u64::from(u32::MAX)) as u32,
        !labels.contains("UNREAD"),
        has_attachments(payload.get("payload")),
        false,
    )))
}

async fn get_json(request: reqwest::RequestBuilder) -> Result<Value, ApiError> {
    let response = request
        .send()
        .await
        .map_err(|error| ApiError::other(format!("Gmail API 请求失败：{error}")))?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(ApiError::Unauthorized);
    }
    if status == StatusCode::NOT_FOUND {
        return Err(ApiError::HistoryExpired);
    }
    if !status.is_success() {
        return Err(ApiError::other(format!(
            "Gmail API 请求失败（HTTP {status}）。"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| ApiError::other(format!("解析 Gmail API 响应失败：{error}")))
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
        Some(value.trim().to_string()).filter(|value| value.contains('@')),
    )
}

fn with_query(base: &str, query: &[(&str, &str)]) -> String {
    let mut serializer = Serializer::new(String::new());
    for (key, value) in query {
        serializer.append_pair(key, value);
    }
    format!("{base}?{}", serializer.finish())
}

fn parse_millis(value: &str) -> Option<String> {
    value
        .parse::<i64>()
        .ok()
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis)
        .map(|date| date.to_rfc3339())
}

fn has_attachments(payload: Option<&Value>) -> bool {
    payload
        .and_then(|payload| payload.get("parts"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts.iter().any(|part| {
                part.get("filename")
                    .and_then(Value::as_str)
                    .is_some_and(|filename| !filename.is_empty())
                    || has_attachments(Some(part))
            })
        })
        .unwrap_or(false)
}

fn stable_uid(id: &str) -> i64 {
    if let Ok(uid) = id.parse::<i64>() {
        if uid > 0 {
            return uid;
        }
    }
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    ((hash & 0x7fff_ffff_ffff_ffff) as i64).max(1)
}

enum ApiError {
    Unauthorized,
    HistoryExpired,
    Other(String),
}

impl ApiError {
    fn other(error: impl Into<String>) -> Self {
        Self::Other(error.into())
    }

    fn into_message(self) -> String {
        match self {
            Self::Unauthorized => "Gmail API access token 无效，且刷新后仍未通过认证。".to_string(),
            Self::HistoryExpired => "Gmail history 游标已过期，需要重新建立同步基线。".to_string(),
            Self::Other(error) => error,
        }
    }
}
