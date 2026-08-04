use base64::{engine::general_purpose::URL_SAFE as BASE64_URL, Engine};
use reqwest::{Client, StatusCode};
use serde_json::Value;

use crate::{
    db,
    mail_sync::{apply_messages, ensure_inbox, fetched_message, read_cursor, FetchedMessage},
    mail_transport::MailAccount,
    oauth,
    state::AppState,
};

const GRAPH_DELTA: &str = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta";
const CURSOR_PREFIX: &str = "graph-delta:";

pub async fn sync(state: &AppState, account: &MailAccount) -> Result<Value, String> {
    ensure_capability(state, account)?;
    let connection = db::open(state)?;
    let folder_id = ensure_inbox(&connection, account.account_id)?;
    let cursor = read_cursor(&connection, folder_id, CURSOR_PREFIX)?;
    drop(connection);

    let token = oauth::access_token(state, account.account_id, &account.provider_key).await?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| format!("创建 Microsoft Graph 客户端失败：{error}"))?;
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

fn ensure_capability(state: &AppState, account: &MailAccount) -> Result<(), String> {
    let connection = db::open(state)?;
    let (provider_key, scopes_json): (String, String) = connection
        .query_row(
            "SELECT provider_key,scopes_json FROM onemail_oauth_tokens WHERE account_id=?1",
            [account.account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("读取 Microsoft OAuth capability 失败：{error}"))?;
    let scopes = serde_json::from_str::<Vec<String>>(&scopes_json).unwrap_or_default();
    let has_mail_read = scopes
        .iter()
        .map(|scope| scope.to_ascii_lowercase())
        .any(|scope| {
            matches!(
                scope.as_str(),
                "mail.read"
                    | "mail.readbasic"
                    | "https://graph.microsoft.com/mail.read"
                    | "https://graph.microsoft.com/mail.readbasic"
            )
        });
    let (_, token) = oauth::read_token(state, account.account_id)?;
    let graph_audience = jwt_audience(&token.access_token).map(|audiences| {
        audiences
            .iter()
            .any(|audience| audience == "https://graph.microsoft.com")
    });
    if provider_key != account.provider_key
        || !matches!(
            account.provider_key.to_ascii_lowercase().as_str(),
            "outlook" | "microsoft"
        )
        || !has_mail_read
        || graph_audience != Some(true)
    {
        return Err(
            "Microsoft Graph 增量同步不可用：当前 OAuth token 只有 Outlook IMAP/SMTP 权限或 audience 不是 graph.microsoft.com，已保持通用 IMAP fallback；重新授权 Graph Mail.Read 后才会启用。"
                .to_string(),
        );
    }
    Ok(())
}

async fn sync_with_token(
    state: &AppState,
    account: &MailAccount,
    folder_id: i64,
    cursor: Option<&str>,
    client: &Client,
    access_token: &str,
) -> Result<Value, ApiError> {
    let mut url = cursor
        .map(str::to_string)
        .unwrap_or_else(|| GRAPH_DELTA.to_string());
    let mut messages = Vec::new();
    let delta_link = loop {
        let payload = get_json(client.get(&url).bearer_auth(access_token)).await?;
        if let Some(values) = payload.get("value").and_then(Value::as_array) {
            for value in values {
                messages.push(parse_message(value)?);
            }
        }
        if let Some(next) = payload.get("@odata.nextLink").and_then(Value::as_str) {
            url = next.to_string();
            continue;
        }
        break payload
            .get("@odata.deltaLink")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::other("Microsoft Graph 未返回 deltaLink。"))?
            .to_string();
    };

    let connection = db::open(state).map_err(ApiError::other)?;
    let result = apply_messages(
        &connection,
        account.account_id,
        folder_id,
        &messages,
        Some(&format!("{CURSOR_PREFIX}{delta_link}")),
        "graph-delta",
    )
    .map_err(ApiError::other)?;
    Ok(result)
}

fn parse_message(value: &Value) -> Result<FetchedMessage, ApiError> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::other("Microsoft Graph 邮件缺少 id。"))?;
    if value.get("@removed").is_some() {
        return Ok(fetched_message(
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
        ));
    }
    let from = value.get("from").and_then(|from| from.get("emailAddress"));
    Ok(fetched_message(
        stable_uid(id),
        value
            .get("subject")
            .and_then(Value::as_str)
            .map(str::to_string),
        value
            .get("internetMessageId")
            .and_then(Value::as_str)
            .map(str::to_string),
        from.and_then(|from| from.get("name").and_then(Value::as_str).map(str::to_string)),
        from.and_then(|from| {
            from.get("address")
                .and_then(Value::as_str)
                .map(str::to_string)
        }),
        value
            .get("receivedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        value
            .get("receivedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        None,
        None,
        value
            .get("bodyPreview")
            .and_then(Value::as_str)
            .map(str::to_string),
        value
            .get("size")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(u64::from(u32::MAX)) as u32,
        value
            .get("isRead")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        value
            .get("hasAttachments")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        false,
    ))
}

async fn get_json(request: reqwest::RequestBuilder) -> Result<Value, ApiError> {
    let response = request
        .send()
        .await
        .map_err(|error| ApiError::other(format!("Microsoft Graph 请求失败：{error}")))?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(ApiError::Unauthorized);
    }
    if !status.is_success() {
        return Err(ApiError::other(format!(
            "Microsoft Graph 请求失败（HTTP {status}）。"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| ApiError::other(format!("解析 Microsoft Graph 响应失败：{error}")))
}

fn jwt_audience(token: &str) -> Option<Vec<String>> {
    let encoded = token.split('.').nth(1)?;
    let normalized = encoded.replace('-', "+").replace('_', "/");
    let padded = format!("{normalized}{}", "=".repeat((4 - normalized.len() % 4) % 4));
    let payload: Value = serde_json::from_slice(&BASE64_URL.decode(padded).ok()?).ok()?;
    match payload.get("aud") {
        Some(Value::String(audience)) => Some(vec![audience.to_ascii_lowercase()]),
        Some(Value::Array(audiences)) => Some(
            audiences
                .iter()
                .filter_map(Value::as_str)
                .map(|audience| audience.to_ascii_lowercase())
                .collect(),
        ),
        _ => None,
    }
}

fn stable_uid(id: &str) -> i64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    ((hash & 0x7fff_ffff_ffff_ffff) as i64).max(1)
}

enum ApiError {
    Unauthorized,
    Other(String),
}

impl ApiError {
    fn other(error: impl Into<String>) -> Self {
        Self::Other(error.into())
    }

    fn into_message(self) -> String {
        match self {
            Self::Unauthorized => {
                "Microsoft Graph access token 无效，且刷新后仍未通过认证。".to_string()
            }
            Self::Other(error) => error,
        }
    }
}
