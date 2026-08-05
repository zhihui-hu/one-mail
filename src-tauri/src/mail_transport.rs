use std::time::Duration;

use aes_gcm::{aead::Aead, KeyInit};
use async_imap::{types::NameAttribute, Authenticator, Client};
use async_native_tls::TlsConnector;
use base64::Engine;
use futures_util::TryStreamExt;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
};

use crate::{db, oauth, state::AppState};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) trait ImapStream:
    AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug
{
}

impl<T> ImapStream for T where T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug {}

pub(crate) type ImapSession = async_imap::Session<Box<dyn ImapStream>>;

#[derive(Clone, Debug)]
pub struct ImapConnectionConfig {
    pub email: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_security: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImapFolder {
    pub path: String,
    pub name: String,
    pub delimiter: Option<String>,
    pub role: String,
    pub attributes: Vec<String>,
    pub is_selectable: bool,
}

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
    let config = ImapConnectionConfig::from(account);
    if account.auth_type != "oauth2" {
        let password = password(state, account)?;
        return connect_with_password(&config, &password).await;
    }

    let client = connect_client(&config).await?;
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
            let client = connect_client(&config).await?;
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

pub async fn discover_folders(
    config: &ImapConnectionConfig,
    password: &str,
) -> Result<Vec<ImapFolder>, String> {
    tokio::time::timeout(DISCOVER_TIMEOUT, discover_folders_inner(config, password))
        .await
        .map_err(|_| "列举 IMAP 文件夹超时。".to_string())?
}

async fn discover_folders_inner(
    config: &ImapConnectionConfig,
    password: &str,
) -> Result<Vec<ImapFolder>, String> {
    let mut session = connect_with_password(config, password).await?;
    let mut folders = Vec::new();
    let mut stream = session
        .list(Some(""), Some("*"))
        .await
        .map_err(|error| format!("列举 IMAP 文件夹失败：{error}"))?;
    while let Some(folder) = stream
        .try_next()
        .await
        .map_err(|error| format!("读取 IMAP 文件夹失败：{error}"))?
    {
        let path = folder.name().to_string();
        let attributes = folder
            .attributes()
            .iter()
            .map(name_attribute_value)
            .collect::<Vec<_>>();
        folders.push(ImapFolder {
            name: decode_modified_utf7(&path),
            role: folder_role(&path, &attributes).to_string(),
            is_selectable: is_folder_selectable(&attributes),
            path,
            delimiter: folder.delimiter().map(str::to_string),
            attributes,
        });
    }
    drop(stream);
    session
        .logout()
        .await
        .map_err(|error| format!("关闭 IMAP 连接失败：{error}"))?;
    Ok(folders)
}

async fn connect_with_password(
    config: &ImapConnectionConfig,
    password: &str,
) -> Result<ImapSession, String> {
    connect_client(config)
        .await?
        .login(&config.email, password)
        .await
        .map_err(|(error, _)| format!("IMAP 登录认证失败：{error}"))
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

async fn connect_client(
    config: &ImapConnectionConfig,
) -> Result<Client<Box<dyn ImapStream>>, String> {
    if config.imap_port == 0 {
        return Err("IMAP 端口无效。".to_string());
    }
    if !matches!(
        config.imap_security.as_str(),
        "ssl_tls" | "starttls" | "none"
    ) {
        return Err("不支持的 IMAP 加密方式。".to_string());
    }
    let tcp = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect((config.imap_host.as_str(), config.imap_port)),
    )
    .await
    .map_err(|_| "连接 IMAP 服务器超时。".to_string())?
    .map_err(|error| format!("连接 IMAP 服务器失败：{error}"))?;

    if config.imap_security == "none" {
        let stream: Box<dyn ImapStream> = Box::new(tcp);
        let mut client = Client::new(stream);
        client
            .read_response()
            .await
            .map_err(|error| format!("读取 IMAP 欢迎语失败：{error}"))?;
        return Ok(client);
    }

    if config.imap_security == "starttls" {
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
            .connect(&config.imap_host, stream)
            .await
            .map_err(|error| format!("IMAP TLS 握手失败：{error}"))?;
        let stream: Box<dyn ImapStream> = Box::new(tls);
        return Ok(Client::new(stream));
    }

    let tls = TlsConnector::new()
        .connect(&config.imap_host, tcp)
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

impl From<&MailAccount> for ImapConnectionConfig {
    fn from(account: &MailAccount) -> Self {
        Self {
            email: account.email.clone(),
            imap_host: account.imap_host.clone(),
            imap_port: account.imap_port,
            imap_security: account.imap_security.clone(),
        }
    }
}

fn name_attribute_value(attribute: &NameAttribute<'_>) -> String {
    match attribute {
        NameAttribute::NoInferiors => "\\Noinferiors".to_string(),
        NameAttribute::NoSelect => "\\Noselect".to_string(),
        NameAttribute::Marked => "\\Marked".to_string(),
        NameAttribute::Unmarked => "\\Unmarked".to_string(),
        NameAttribute::All => "\\All".to_string(),
        NameAttribute::Archive => "\\Archive".to_string(),
        NameAttribute::Drafts => "\\Drafts".to_string(),
        NameAttribute::Flagged => "\\Flagged".to_string(),
        NameAttribute::Junk => "\\Junk".to_string(),
        NameAttribute::Sent => "\\Sent".to_string(),
        NameAttribute::Trash => "\\Trash".to_string(),
        NameAttribute::Extension(value) => value.to_string(),
        _ => format!("{attribute:?}"),
    }
}

pub fn is_folder_selectable(attributes: &[String]) -> bool {
    !attributes.iter().any(|attribute| {
        attribute.eq_ignore_ascii_case("\\Noselect")
            || attribute.eq_ignore_ascii_case("\\NonExistent")
    })
}

pub fn folder_role(path: &str, attributes: &[String]) -> &'static str {
    if path.eq_ignore_ascii_case("INBOX") {
        return "inbox";
    }
    for (attribute, role) in [
        ("\\Sent", "sent"),
        ("\\Drafts", "drafts"),
        ("\\Trash", "trash"),
        ("\\Junk", "junk"),
        ("\\Archive", "archive"),
        ("\\All", "all_mail"),
        ("\\Important", "important"),
        ("\\Flagged", "starred"),
    ] {
        if attributes
            .iter()
            .any(|value| value.eq_ignore_ascii_case(attribute))
        {
            return role;
        }
    }
    "custom"
}

pub fn decode_modified_utf7(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = String::with_capacity(value.len());
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(relative_start) = bytes[cursor..].iter().position(|byte| *byte == b'&') else {
            decoded.push_str(&value[cursor..]);
            break;
        };
        let start = cursor + relative_start;
        decoded.push_str(&value[cursor..start]);
        let Some(relative_end) = bytes[start + 1..].iter().position(|byte| *byte == b'-') else {
            decoded.push_str(&value[start..]);
            break;
        };
        let end = start + 1 + relative_end;
        let encoded = &value[start + 1..end];
        if encoded.is_empty() {
            decoded.push('&');
        } else if let Some(segment) = decode_modified_utf7_segment(encoded) {
            decoded.push_str(&segment);
        } else {
            decoded.push_str(&value[start..=end]);
        }
        cursor = end + 1;
    }

    decoded
}

fn decode_modified_utf7_segment(value: &str) -> Option<String> {
    let mut encoded = value.replace(',', "/");
    match encoded.len() % 4 {
        0 => {}
        2 => encoded.push_str("=="),
        3 => encoded.push('='),
        _ => return None,
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let utf16 = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&utf16).ok()
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

#[cfg(test)]
mod tests {
    use super::{decode_modified_utf7, folder_role, is_folder_selectable};

    #[test]
    fn decodes_modified_utf7_mailbox_names_and_literal_ampersands() {
        assert_eq!(
            decode_modified_utf7("~peter/mail/&U,BTFw-/&ZeVnLIqe-"),
            "~peter/mail/台北/日本語"
        );
        assert_eq!(decode_modified_utf7("R&-D &- Sales"), "R&D & Sales");
    }

    #[test]
    fn preserves_invalid_modified_utf7_segments() {
        assert_eq!(decode_modified_utf7("Folder/&bad!-"), "Folder/&bad!-");
        assert_eq!(decode_modified_utf7("Folder/&broken"), "Folder/&broken");
    }

    #[test]
    fn maps_special_use_attributes_without_guessing_custom_names() {
        assert_eq!(folder_role("Inbox", &[]), "inbox");
        assert_eq!(folder_role("已发送", &["\\Sent".to_string()]), "sent");
        assert_eq!(
            folder_role("Everything", &["\\ALL".to_string()]),
            "all_mail"
        );
        assert_eq!(folder_role("Sent Items", &[]), "custom");
    }

    #[test]
    fn keeps_non_selectable_folders_but_marks_them_unselectable() {
        assert!(!is_folder_selectable(&["\\Noselect".to_string()]));
        assert!(!is_folder_selectable(&["\\nonexistent".to_string()]));
        assert!(is_folder_selectable(&["\\HasChildren".to_string()]));
    }
}
