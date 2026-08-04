use std::time::Duration;

use aes_gcm::{aead::Aead, KeyInit};
use async_imap::{Authenticator, Client};
use async_native_tls::TlsConnector;
use base64::Engine;
use futures_util::TryStreamExt;
use rusqlite::OptionalExtension;
use sha2::Digest;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};

use crate::{db, oauth, state::AppState};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) trait ImapStream:
    AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug
{
}

impl<T> ImapStream for T where T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug {}

pub(crate) type ImapSession = async_imap::Session<Box<dyn ImapStream>>;

#[derive(Clone, Debug)]
pub struct MailAccount {
    pub account_id: i64,
    pub provider_key: String,
    pub email: String,
    pub auth_type: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: String,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_security: Option<String>,
    pub smtp_auth_type: Option<String>,
    pub smtp_enabled: bool,
    pub encrypted_password: Option<String>,
}

pub fn load_account(state: &AppState, account_id: i64) -> Result<MailAccount, String> {
    let connection = db::open(state)?;
    connection
        .query_row(
            "SELECT account_id,provider_key,email,auth_type,imap_host,imap_port,imap_security,
                    smtp_host,smtp_port,smtp_security,smtp_auth_type,smtp_enabled,encrypted_password
             FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
            |row| {
                let imap_port = row.get::<_, i64>(5)?;
                let smtp_port = row.get::<_, Option<i64>>(8)?;
                Ok(MailAccount {
                    account_id: row.get(0)?,
                    provider_key: row.get(1)?,
                    email: row.get(2)?,
                    auth_type: row.get(3)?,
                    imap_host: row.get(4)?,
                    imap_port: u16::try_from(imap_port).unwrap_or(0),
                    imap_security: row.get(6)?,
                    smtp_host: row.get(7)?,
                    smtp_port: smtp_port.and_then(|port| u16::try_from(port).ok()),
                    smtp_security: row.get(9)?,
                    smtp_auth_type: row.get(10)?,
                    smtp_enabled: row.get::<_, i64>(11)? != 0,
                    encrypted_password: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取邮箱账号失败：{error}"))?
        .ok_or_else(|| format!("账号不存在：{account_id}"))
}

pub async fn connect_authenticated(
    state: &AppState,
    account: &MailAccount,
) -> Result<ImapSession, String> {
    let client = connect_client(account).await?;
    if account.auth_type != "oauth2" {
        let password = password(state, account)?;
        return client
            .login(&account.email, password)
            .await
            .map_err(|(error, _)| format!("IMAP 登录认证失败：{error}"));
    }

    let token = oauth::access_token(state, account.account_id, &account.provider_key).await?;
    let login_hints = vec![account.email.clone()];
    match authenticate_xoauth2(client, &login_hints, &token.access_token).await {
        Ok(session) => {
            let _ =
                oauth::set_connection_state(state, account.account_id, "connected", false, None);
            Ok(session)
        }
        Err(first_error) if is_xoauth2_auth_error(&first_error) => {
            let refreshed = oauth::force_refresh_access_token(
                state,
                account.account_id,
                &account.provider_key,
                Some(&token.access_token),
            )
            .await?;
            let client = connect_client(account).await?;
            match authenticate_xoauth2(client, &login_hints, &refreshed.access_token).await {
                Ok(session) => {
                    let _ = oauth::set_connection_state(
                        state,
                        account.account_id,
                        "connected",
                        false,
                        None,
                    );
                    Ok(session)
                }
                Err(second_error) => {
                    let message = format!("IMAP OAuth 登录认证失败，请重新授权：{second_error}");
                    let _ = oauth::set_connection_state(
                        state,
                        account.account_id,
                        "reauthorize",
                        true,
                        Some(&message),
                    );
                    Err(message)
                }
            }
        }
        Err(error) => Err(format!("IMAP OAuth 登录认证失败：{error}")),
    }
}

pub async fn fetch_raw_message(
    state: &AppState,
    account: &MailAccount,
    folder_path: &str,
    uid: u32,
) -> Result<Vec<u8>, String> {
    if uid == 0 {
        return Err("邮件 UID 无效。".to_string());
    }
    let mut session = connect_authenticated(state, account).await?;
    session
        .select(folder_path)
        .await
        .map_err(|error| format!("打开邮箱文件夹失败：{error}"))?;
    let mut stream = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .await
        .map_err(|error| format!("读取邮件正文失败：{error}"))?;
    let mut body = None;
    while let Some(fetch) = stream
        .try_next()
        .await
        .map_err(|error| format!("读取邮件正文失败：{error}"))?
    {
        if let Some(value) = fetch.body() {
            body = Some(value.to_vec());
        }
    }
    drop(stream);
    session
        .logout()
        .await
        .map_err(|error| format!("关闭 IMAP 连接失败：{error}"))?;
    body.ok_or_else(|| "IMAP 返回中没有邮件正文。".to_string())
}

async fn connect_client(account: &MailAccount) -> Result<Client<Box<dyn ImapStream>>, String> {
    if account.imap_port == 0 {
        return Err("IMAP 端口无效。".to_string());
    }
    if !matches!(
        account.imap_security.as_str(),
        "ssl_tls" | "starttls" | "none"
    ) {
        return Err("不支持的 IMAP 加密方式。".to_string());
    }
    let tcp = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect((account.imap_host.as_str(), account.imap_port)),
    )
    .await
    .map_err(|_| "连接 IMAP 服务器超时。".to_string())?
    .map_err(|error| format!("连接 IMAP 服务器失败：{error}"))?;

    if account.imap_security == "none" {
        let stream: Box<dyn ImapStream> = Box::new(tcp);
        let mut client = Client::new(stream);
        client
            .read_response()
            .await
            .map_err(|error| format!("读取 IMAP 欢迎语失败：{error}"))?;
        return Ok(client);
    }

    if account.imap_security == "starttls" {
        let mut client = Client::new(tcp);
        client
            .read_response()
            .await
            .map_err(|error| format!("读取 IMAP 欢迎语失败：{error}"))?;
        client
            .run_command_and_check_ok("STARTTLS", None)
            .await
            .map_err(|error| format!("IMAP STARTTLS 失败：{error}"))?;
        let stream = client.into_inner();
        let tls = TlsConnector::new()
            .connect(&account.imap_host, stream)
            .await
            .map_err(|error| format!("IMAP TLS 握手失败：{error}"))?;
        let stream: Box<dyn ImapStream> = Box::new(tls);
        return Ok(Client::new(stream));
    }

    let tls = TlsConnector::new()
        .connect(&account.imap_host, tcp)
        .await
        .map_err(|error| format!("IMAP TLS 握手失败：{error}"))?;
    let stream: Box<dyn ImapStream> = Box::new(tls);
    let mut client = Client::new(stream);
    client
        .read_response()
        .await
        .map_err(|error| format!("读取 IMAP 欢迎语失败：{error}"))?;
    Ok(client)
}

async fn authenticate_xoauth2(
    mut client: Client<Box<dyn ImapStream>>,
    login_hints: &[String],
    access_token: &str,
) -> Result<ImapSession, String> {
    let mut last_error = None;
    for username in login_hints {
        let auth = XOAuth2 {
            username,
            access_token,
        };
        match client.authenticate("XOAUTH2", auth).await {
            Ok(session) => return Ok(session),
            Err((error, next_client)) => {
                last_error = Some(error.to_string());
                client = next_client;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "XOAUTH2 认证失败。".to_string()))
}

fn is_xoauth2_auth_error(error: &str) -> bool {
    let message = error.to_ascii_lowercase();
    message.contains("auth")
        || message.contains("oauth")
        || message.contains("invalid credentials")
        || message.contains("not authenticated")
}

pub fn password(state: &AppState, account: &MailAccount) -> Result<String, String> {
    let encrypted = account
        .encrypted_password
        .as_deref()
        .ok_or_else(|| "账号凭据不存在，请编辑账号并重新保存密码。".to_string())?;
    decrypt_secret(&state.database_key()?, encrypted)
}

#[derive(serde::Deserialize)]
struct EncryptedPayload {
    version: u8,
    alg: String,
    iv: String,
    #[serde(rename = "authTag")]
    auth_tag: String,
    ciphertext: String,
}

fn decrypt_secret(database_key: &str, value: &str) -> Result<String, String> {
    let payload: EncryptedPayload = serde_json::from_slice(
        &base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|_| "账号凭据格式无效，请编辑账号并重新保存密码。".to_string())?,
    )
    .map_err(|_| "账号凭据格式无效，请编辑账号并重新保存密码。".to_string())?;
    if payload.version != 1 || payload.alg != "aes-256-gcm" {
        return Err("账号凭据格式不支持，请编辑账号并重新保存密码。".to_string());
    }
    let iv = base64::engine::general_purpose::STANDARD
        .decode(payload.iv)
        .map_err(|_| "账号凭据格式无效，请编辑账号并重新保存密码。".to_string())?;
    let mut encrypted = base64::engine::general_purpose::STANDARD
        .decode(payload.ciphertext)
        .map_err(|_| "账号凭据格式无效，请编辑账号并重新保存密码。".to_string())?;
    encrypted.extend(
        base64::engine::general_purpose::STANDARD
            .decode(payload.auth_tag)
            .map_err(|_| "账号凭据格式无效，请编辑账号并重新保存密码。".to_string())?,
    );
    let key = sha2::Sha256::digest(database_key.as_bytes());
    let cipher = aes_gcm::Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "账号凭据解密失败，请编辑账号并重新保存密码。".to_string())?;
    let plaintext = cipher
        .decrypt(aes_gcm::Nonce::from_slice(&iv), encrypted.as_ref())
        .map_err(|_| "账号凭据解密失败，请编辑账号并重新保存密码。".to_string())?;
    String::from_utf8(plaintext)
        .map_err(|_| "账号凭据内容无效，请编辑账号并重新保存密码。".to_string())
}

struct XOAuth2<'a> {
    username: &'a str,
    access_token: &'a str,
}

impl Authenticator for XOAuth2<'_> {
    type Response = String;

    fn process(&mut self, _challenge: &[u8]) -> Self::Response {
        format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            self.username, self.access_token
        )
    }
}
