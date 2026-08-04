use std::{collections::HashSet, time::Duration};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rng, RngCore};
use reqwest::Client;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::{form_urlencoded::Serializer, Url};

use crate::{db, state::AppState};

const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REFRESH_SKEW: Duration = Duration::from_secs(10 * 60);
const MICROSOFT_CLIENT_ID: &str = "2d9a4659-0a30-4622-8113-0f72b632d176";
const MICROSOFT_SCOPES: &[&str] = &[
    "openid",
    "profile",
    "email",
    "offline_access",
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
];
const GOOGLE_AUTHORITY: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: &[&str] = &["openid", "profile", "email", "https://mail.google.com/"];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OAuthToken {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "idToken", skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(rename = "refreshToken", skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct AuthorizedAccount {
    pub email: String,
    pub token: OAuthToken,
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    access_token: Option<String>,
    id_token: Option<String>,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[async_trait]
pub trait OAuthProvider: Send + Sync {
    fn key(&self) -> &'static str;
    fn client_id(&self) -> Result<String, String>;
    fn authorization_endpoint(&self) -> &'static str;
    fn token_endpoint(&self) -> &'static str;
    fn scopes(&self) -> &'static [&'static str];
    fn authorization_parameters(&self, params: &mut Serializer<String>);
    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String>;
    fn validate_token(&self, response: &TokenResponse, token: &OAuthToken) -> Result<(), String>;

    async fn exchange_code(
        &self,
        client: &Client,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<OAuthToken, String> {
        let client_id = self.client_id()?;
        let mut form = vec![
            ("client_id", client_id),
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", redirect_uri.to_string()),
            ("code_verifier", verifier.to_string()),
        ];
        if self.key() == "microsoft" {
            form.push(("scope", self.scopes().join(" ")));
        }
        let response = client
            .post(self.token_endpoint())
            .form(&form)
            .send()
            .await
            .map_err(|error| format!("{} OAuth token 请求失败：{error}", self.key()))?;
        map_token_response(response, self).await
    }

    async fn refresh(
        &self,
        client: &Client,
        refresh_token: &str,
        previous: &OAuthToken,
    ) -> Result<OAuthToken, String> {
        let client_id = self.client_id()?;
        let mut form = vec![
            ("client_id", client_id),
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.to_string()),
        ];
        if self.key() == "microsoft" {
            form.push(("scope", self.scopes().join(" ")));
        }
        let response = client
            .post(self.token_endpoint())
            .form(&form)
            .send()
            .await
            .map_err(|error| format!("刷新 {} OAuth 失败：{error}", self.key()))?;
        let refreshed = map_token_response(response, self).await?;
        Ok(OAuthToken {
            access_token: refreshed.access_token,
            id_token: refreshed.id_token.or_else(|| previous.id_token.clone()),
            refresh_token: refreshed
                .refresh_token
                .or_else(|| previous.refresh_token.clone()),
            token_type: refreshed.token_type,
            expires_at: refreshed.expires_at,
        })
    }
}

struct MicrosoftOAuthProvider;
struct GoogleOAuthProvider;

#[async_trait]
impl OAuthProvider for MicrosoftOAuthProvider {
    fn key(&self) -> &'static str {
        "microsoft"
    }

    fn client_id(&self) -> Result<String, String> {
        Ok(std::env::var("ONEMAIL_MICROSOFT_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| MICROSOFT_CLIENT_ID.to_string()))
    }

    fn authorization_endpoint(&self) -> &'static str {
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    }

    fn token_endpoint(&self) -> &'static str {
        "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    }

    fn scopes(&self) -> &'static [&'static str] {
        MICROSOFT_SCOPES
    }

    fn authorization_parameters(&self, params: &mut Serializer<String>) {
        params.append_pair("response_type", "code");
        params.append_pair("response_mode", "query");
        params.append_pair("prompt", "consent");
    }

    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String> {
        let access = decode_jwt_payload(&token.access_token).unwrap_or_default();
        let id =
            decode_jwt_payload(token.id_token.as_deref().unwrap_or_default()).unwrap_or_default();
        first_email([
            string_claim(&access, "upn"),
            string_claim(&access, "preferred_username"),
            string_claim(&access, "unique_name"),
            string_claim(&access, "email"),
            string_claim(&id, "preferred_username"),
            string_claim(&id, "email"),
            string_claim(&id, "upn"),
        ])
        .ok_or_else(|| "Microsoft OAuth 未返回可用的 Outlook 邮箱地址。".to_string())
    }

    fn validate_token(&self, response: &TokenResponse, token: &OAuthToken) -> Result<(), String> {
        let granted = response
            .scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(normalize_scope)
            .collect::<HashSet<_>>();
        if !granted.is_empty()
            && (!granted.contains("https://outlook.office.com/imap.accessasuser.all")
                || !granted.contains("https://outlook.office.com/smtp.send"))
        {
            return Err("Microsoft OAuth 未授予 Outlook IMAP/SMTP 权限，请重新授权。".to_string());
        }

        let access = decode_jwt_payload(&token.access_token).unwrap_or_default();
        if let Some(audience) = string_claim(&access, "aud") {
            let audience = normalize_scope(&audience).trim_end_matches('/').to_string();
            let allowed = [
                "https://outlook.office.com",
                "https://outlook.office365.com",
                "00000002-0000-0ff1-ce00-000000000000",
            ];
            if !allowed.iter().any(|item| *item == audience) {
                return Err(
                    "Microsoft OAuth 返回的 access token 不是 Outlook IMAP 可用的 token。"
                        .to_string(),
                );
            }
        }
        Ok(())
    }
}

#[async_trait]
impl OAuthProvider for GoogleOAuthProvider {
    fn key(&self) -> &'static str {
        "google"
    }

    fn client_id(&self) -> Result<String, String> {
        std::env::var("ONEMAIL_GOOGLE_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "缺少 ONEMAIL_GOOGLE_CLIENT_ID，请配置 Google 桌面 OAuth 客户端。".to_string()
            })
    }

    fn authorization_endpoint(&self) -> &'static str {
        GOOGLE_AUTHORITY
    }

    fn token_endpoint(&self) -> &'static str {
        GOOGLE_TOKEN_URL
    }

    fn scopes(&self) -> &'static [&'static str] {
        GOOGLE_SCOPES
    }

    fn authorization_parameters(&self, params: &mut Serializer<String>) {
        params.append_pair("access_type", "offline");
        params.append_pair("prompt", "consent");
        params.append_pair("include_granted_scopes", "true");
    }

    async fn mailbox_email(&self, token: &OAuthToken) -> Result<String, String> {
        let id =
            decode_jwt_payload(token.id_token.as_deref().unwrap_or_default()).unwrap_or_default();
        if let Some(email) = first_email([string_claim(&id, "email")]) {
            return Ok(email);
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("创建 Google 账号信息请求客户端失败：{error}"))?;
        let response = client
            .get("https://openidconnect.googleapis.com/v1/userinfo")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|error| format!("读取 Google 账号邮箱失败：{error}"))?;
        let payload: Value = response
            .json()
            .await
            .map_err(|error| format!("解析 Google 账号信息失败：{error}"))?;
        first_email([payload
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string)])
        .ok_or_else(|| "Google OAuth 未返回可用的 Gmail 邮箱地址。".to_string())
    }

    fn validate_token(&self, response: &TokenResponse, _token: &OAuthToken) -> Result<(), String> {
        let granted = response
            .scope
            .as_deref()
            .unwrap_or_default()
            .split_whitespace()
            .map(normalize_scope)
            .collect::<HashSet<_>>();
        if !granted.is_empty() && !granted.contains("https://mail.google.com/") {
            return Err("Google OAuth 未授予 Gmail 访问权限，请重新授权。".to_string());
        }
        Ok(())
    }
}

pub fn provider_for(provider_key: &str) -> Result<Box<dyn OAuthProvider>, String> {
    match provider_key.to_ascii_lowercase().as_str() {
        "gmail" | "google" => Ok(Box::new(GoogleOAuthProvider)),
        "outlook" | "microsoft" => Ok(Box::new(MicrosoftOAuthProvider)),
        _ => Err(format!("不支持 OAuth 服务商：{provider_key}")),
    }
}

pub async fn authorize(
    provider_key: &str,
    login_hint: Option<&str>,
    _app: Option<&AppHandle>,
) -> Result<AuthorizedAccount, String> {
    let provider = provider_for(provider_key)?;
    let client_id = provider.client_id()?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("启动 OAuth 本地回调失败：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 OAuth 回调端口失败：{error}"))?
        .port();
    let callback_path = format!("/oauth/{}/callback", provider.key());
    let redirect_uri = format!("http://localhost:{port}{callback_path}");
    let verifier = random_urlsafe(48);
    let challenge = base64_url(&Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(24);

    let authorization_url = {
        let mut params = Serializer::new(String::new());
        params.append_pair("client_id", &client_id);
        params.append_pair("redirect_uri", &redirect_uri);
        params.append_pair("scope", &provider.scopes().join(" "));
        params.append_pair("state", &state);
        params.append_pair("code_challenge", &challenge);
        params.append_pair("code_challenge_method", "S256");
        provider.authorization_parameters(&mut params);
        if let Some(login_hint) = login_hint.filter(|value| !value.trim().is_empty()) {
            params.append_pair("login_hint", login_hint.trim());
        }
        format!("{}?{}", provider.authorization_endpoint(), params.finish())
    };
    open::that(&authorization_url).map_err(|error| format!("打开系统浏览器失败：{error}"))?;

    let code = wait_for_callback(listener, &callback_path, &state).await?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("创建 OAuth 请求客户端失败：{error}"))?;
    let token = provider
        .exchange_code(&client, &code, &verifier, &redirect_uri)
        .await?;
    let email = provider.mailbox_email(&token).await?;
    Ok(AuthorizedAccount { email, token })
}

pub fn save_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    token: &OAuthToken,
    scopes: &[&str],
) -> Result<(), String> {
    let encrypted = encrypt_secret(&state.database_key()?, token, ":oauth")?;
    let connection = db::open(state)?;
    connection
        .execute(
            "INSERT INTO onemail_oauth_tokens
               (account_id,provider_key,token_payload,expires_at,scopes_json,updated_at)
             VALUES (?1,?2,?3,?4,?5,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ON CONFLICT(account_id) DO UPDATE SET provider_key=excluded.provider_key,
               token_payload=excluded.token_payload,expires_at=excluded.expires_at,
               scopes_json=excluded.scopes_json,updated_at=excluded.updated_at",
            params![
                account_id,
                provider_key,
                encrypted,
                token.expires_at,
                serde_json::to_string(scopes).map_err(|error| error.to_string())?
            ],
        )
        .map_err(|error| format!("保存 OAuth 凭据失败：{error}"))?;
    set_connection_state(state, account_id, "connected", false, None)
}

pub fn read_token(state: &AppState, account_id: i64) -> Result<(String, OAuthToken), String> {
    let connection = db::open(state)?;
    let row = connection
        .query_row(
            "SELECT provider_key,token_payload FROM onemail_oauth_tokens WHERE account_id=?1",
            [account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("读取 OAuth 凭据失败：{error}"))?
        .ok_or_else(|| "OAuth 凭据不存在，请重新授权。".to_string())?;
    let token = decrypt_secret(&state.database_key()?, &row.1, ":oauth")?;
    Ok((row.0, token))
}

pub async fn access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
) -> Result<OAuthToken, String> {
    let (stored_provider, token) = match read_token(state, account_id) {
        Ok(value) => value,
        Err(error) => {
            let _ = set_connection_state(state, account_id, "reauthorize", true, Some(&error));
            return Err(error);
        }
    };
    if stored_provider != provider_key {
        let error = "OAuth 服务商与账号配置不一致，请重新授权。";
        let _ = set_connection_state(state, account_id, "reauthorize", true, Some(error));
        return Err(error.to_string());
    }
    if !should_refresh(&token) {
        return Ok(token);
    }
    refresh_access_token(state, account_id, provider_key, None, false).await
}

pub async fn force_refresh_access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    failed_access_token: Option<&str>,
) -> Result<OAuthToken, String> {
    refresh_access_token(state, account_id, provider_key, failed_access_token, true).await
}

async fn refresh_access_token(
    state: &AppState,
    account_id: i64,
    provider_key: &str,
    failed_access_token: Option<&str>,
    force: bool,
) -> Result<OAuthToken, String> {
    let lock = state.oauth_refresh_lock(account_id)?;
    let _guard = lock.lock().await;
    let (stored_provider, current) = read_token(state, account_id)?;
    if stored_provider != provider_key {
        return Err("OAuth 服务商与账号配置不一致，请重新授权。".to_string());
    }
    if let Some(failed_access_token) = failed_access_token {
        if current.access_token != failed_access_token && !should_refresh(&current) {
            return Ok(current);
        }
    } else if !force && !should_refresh(&current) {
        return Ok(current);
    }

    let Some(refresh_token) = current.refresh_token.as_deref() else {
        let error = "OAuth refresh token 不存在，请重新授权。";
        let _ = set_connection_state(state, account_id, "reauthorize", true, Some(error));
        return Err(error.to_string());
    };
    set_connection_state(state, account_id, "renewing", false, None)?;
    let provider = provider_for(provider_key)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("创建 OAuth 请求客户端失败：{error}"))?;
    match provider.refresh(&client, refresh_token, &current).await {
        Ok(token) => {
            save_token(state, account_id, provider_key, &token, provider.scopes())?;
            Ok(token)
        }
        Err(error) => {
            let _ = set_connection_state(state, account_id, "reauthorize", true, Some(&error));
            Err(error)
        }
    }
}

pub fn set_connection_state(
    state: &AppState,
    account_id: i64,
    connection_state: &str,
    auth_error: bool,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET connection_state=?2,
               status=CASE WHEN ?3=1 THEN 'auth_error' WHEN ?2='connected' THEN 'active' ELSE status END,
               credential_state=CASE WHEN ?3=1 THEN 'invalid' WHEN ?2='connected' THEN 'stored' ELSE credential_state END,
               last_error=?4,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE account_id=?1",
            params![account_id, connection_state, auth_error, error],
        )
        .map(|_| ())
        .map_err(|error| format!("更新账号连接状态失败：{error}"))
}

async fn wait_for_callback(
    listener: TcpListener,
    callback_path: &str,
    expected_state: &str,
) -> Result<String, String> {
    let result = timeout(CALLBACK_TIMEOUT, async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .map_err(|error| format!("读取 OAuth 回调失败：{error}"))?;
            let mut buffer = Vec::with_capacity(1024);
            let mut chunk = [0_u8; 1024];
            while buffer.len() < 16 * 1024 {
                let read = stream
                    .read(&mut chunk)
                    .await
                    .map_err(|error| format!("读取 OAuth 回调失败：{error}"))?;
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&buffer);
            let target = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .ok_or_else(|| "OAuth 回调请求格式无效。".to_string())?;
            let url = Url::parse(&format!("http://localhost{target}"))
                .map_err(|error| format!("解析 OAuth 回调失败：{error}"))?;
            if url.path() != callback_path {
                write_callback_response(&mut stream, 404, "Not found").await?;
                continue;
            }
            let state = url
                .query_pairs()
                .find(|(key, _)| key == "state")
                .map(|(_, value)| value.into_owned());
            if state.as_deref() != Some(expected_state) {
                write_callback_response(&mut stream, 400, "授权状态校验失败，可以关闭此页面。")
                    .await?;
                return Err("OAuth state 校验失败。".to_string());
            }
            if let Some(error) = url
                .query_pairs()
                .find(|(key, _)| key == "error")
                .map(|(_, value)| value.into_owned())
            {
                let description = url
                    .query_pairs()
                    .find(|(key, _)| key == "error_description")
                    .map(|(_, value)| value.into_owned())
                    .unwrap_or(error);
                write_callback_response(&mut stream, 400, "授权失败，可以关闭此页面。").await?;
                return Err(description);
            }
            let code = url
                .query_pairs()
                .find(|(key, _)| key == "code")
                .map(|(_, value)| value.into_owned())
                .ok_or_else(|| "OAuth 未返回授权码。".to_string())?;
            write_callback_response(&mut stream, 200, "授权成功，可以关闭此页面并返回 OneMail。")
                .await?;
            return Ok(code);
        }
    })
    .await
    .map_err(|_| "OAuth 登录超时，请重试。".to_string())?;
    result
}

async fn write_callback_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let status_text = if status == 200 { "OK" } else { "Bad Request" };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("写入 OAuth 回调响应失败：{error}"))
}

async fn map_token_response<P: OAuthProvider + ?Sized>(
    response: reqwest::Response,
    provider: &P,
) -> Result<OAuthToken, String> {
    let status = response.status();
    let payload: TokenResponse = response
        .json()
        .await
        .map_err(|error| format!("解析 {} OAuth 响应失败：{error}", provider.key()))?;
    if !status.is_success() || payload.error.is_some() {
        return Err(payload
            .error_description
            .or(payload.error)
            .unwrap_or_else(|| format!("HTTP {status}")));
    }
    let access_token = payload
        .access_token
        .clone()
        .ok_or_else(|| format!("{} OAuth 未返回 access token。", provider.key()))?;
    let token = OAuthToken {
        access_token,
        id_token: payload.id_token.clone(),
        refresh_token: payload.refresh_token.clone(),
        token_type: payload
            .token_type
            .clone()
            .unwrap_or_else(|| "Bearer".to_string()),
        expires_at: payload.expires_in.map(|seconds| {
            (chrono::Utc::now() + chrono::Duration::seconds(seconds))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        }),
    };
    provider.validate_token(&payload, &token)?;
    Ok(token)
}

fn should_refresh(token: &OAuthToken) -> bool {
    let Some(expires_at) = token.expires_at.as_deref() else {
        return false;
    };
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .map(|expires_at| {
            expires_at
                <= chrono::Utc::now() + chrono::Duration::from_std(REFRESH_SKEW).unwrap_or_default()
        })
        .unwrap_or(true)
}

fn first_email<const N: usize>(values: [Option<String>; N]) -> Option<String> {
    values
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .find(|value| is_email(value))
}

fn is_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None) if !local.is_empty() && domain.contains('.'))
}

fn decode_jwt_payload(token: &str) -> Result<Value, String> {
    let encoded = token
        .split('.')
        .nth(1)
        .ok_or_else(|| "JWT 格式无效。".to_string())?;
    let normalized = encoded.replace('-', "+").replace('_', "/");
    let padded = format!("{normalized}{}", "=".repeat((4 - normalized.len() % 4) % 4));
    let bytes = BASE64
        .decode(padded)
        .map_err(|error| format!("JWT 解析失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("JWT 解析失败：{error}"))
}

fn string_claim(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(Value::as_str).map(str::to_string)
}

fn normalize_scope(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn random_urlsafe(size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    rng().fill_bytes(&mut bytes);
    base64_url(&bytes)
}

fn base64_url(value: &[u8]) -> String {
    BASE64
        .encode(value)
        .replace('+', "-")
        .replace('/', "_")
        .trim_end_matches('=')
        .to_string()
}

#[derive(Deserialize)]
struct EncryptedPayload {
    version: u8,
    alg: String,
    iv: String,
    #[serde(rename = "authTag")]
    auth_tag: String,
    ciphertext: String,
}

fn encrypt_secret<T: Serialize>(
    database_key: &str,
    value: &T,
    suffix: &str,
) -> Result<String, String> {
    let key = Sha256::digest(format!("{database_key}{suffix}").as_bytes());
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "创建 OAuth 凭据加密器失败。".to_string())?;
    let mut iv = [0_u8; 12];
    rng().fill_bytes(&mut iv);
    let plaintext = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), plaintext.as_ref())
        .map_err(|_| "加密 OAuth 凭据失败。".to_string())?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .ok_or_else(|| "加密 OAuth 凭据失败。".to_string())?;
    let payload = json!({
        "version": 1,
        "alg": "aes-256-gcm",
        "iv": BASE64.encode(iv),
        "authTag": BASE64.encode(&encrypted[tag_start..]),
        "ciphertext": BASE64.encode(&encrypted[..tag_start])
    });
    Ok(BASE64.encode(serde_json::to_vec(&payload).map_err(|error| error.to_string())?))
}

fn decrypt_secret<T: for<'de> Deserialize<'de>>(
    database_key: &str,
    value: &str,
    suffix: &str,
) -> Result<T, String> {
    let payload: EncryptedPayload = serde_json::from_slice(
        &BASE64
            .decode(value)
            .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?,
    )
    .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    if payload.version != 1 || payload.alg != "aes-256-gcm" {
        return Err("OAuth 凭据格式不支持，请重新授权。".to_string());
    }
    let iv = BASE64
        .decode(payload.iv)
        .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    let mut encrypted = BASE64
        .decode(payload.ciphertext)
        .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?;
    encrypted.extend(
        BASE64
            .decode(payload.auth_tag)
            .map_err(|_| "OAuth 凭据格式无效，请重新授权。".to_string())?,
    );
    let key = Sha256::digest(format!("{database_key}{suffix}").as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "OAuth 凭据解密失败，请重新授权。".to_string())?;
    let decrypted = cipher
        .decrypt(Nonce::from_slice(&iv), encrypted.as_ref())
        .map_err(|_| "OAuth 凭据解密失败，请重新授权。".to_string())?;
    serde_json::from_slice(&decrypted).map_err(|_| "OAuth 凭据内容无效，请重新授权。".to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_email, normalize_scope};

    #[test]
    fn validates_mailbox_claims_without_accepting_non_emails() {
        assert!(is_email("person@example.com"));
        assert!(!is_email("person"));
        assert_eq!(
            normalize_scope(" HTTPS://EXAMPLE.COM/ "),
            "https://example.com/"
        );
    }
}
