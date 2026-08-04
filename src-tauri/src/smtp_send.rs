use std::{fs, time::Duration};

use lettre::{
    message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart},
    transport::{
        smtp::{
            authentication::{Credentials, Mechanism},
            AsyncSmtpTransport,
        },
        AsyncTransport,
    },
    Tokio1Executor,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

use crate::{db, mail_transport, oauth, state::AppState};

pub async fn send_message(state: &AppState, input: Value) -> Result<Value, String> {
    let mut input = input;
    if !input.is_object() {
        return Err("发信参数无效。".to_string());
    }
    let account_id = input
        .get("accountId")
        .and_then(Value::as_i64)
        .ok_or_else(|| "账号 ID 无效。".to_string())?;
    let account = mail_transport::load_account(state, account_id)?;
    if !account.smtp_enabled {
        return Err("该账号已禁用 SMTP 发信。".to_string());
    }
    if account.smtp_auth_type.as_deref() == Some("oauth2") && account.auth_type != "oauth2" {
        return Err("SMTP OAuth 需要账号使用 OAuth 认证，请重新授权该账号。".to_string());
    }
    let outbox_id = input.get("outboxId").and_then(Value::as_i64);
    if input.get("rfc822MessageId").is_none() {
        if let Some(outbox_id) = outbox_id {
            let connection = db::open(state)?;
            let message_id = connection
                .query_row(
                    "SELECT rfc822_message_id FROM onemail_outbox_messages WHERE outbox_id=?1",
                    [outbox_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("读取发信记录失败：{error}"))?;
            if let Some(message_id) = message_id {
                input["rfc822MessageId"] = json!(message_id);
            }
        }
    }
    if let Some(outbox_id) = outbox_id {
        update_outbox_status(state, outbox_id, "sending", None)?;
    }

    let initial_access_token = if account.auth_type == "oauth2" {
        match oauth::access_token(state, account_id, &account.provider_key).await {
            Ok(token) => Some(token.access_token),
            Err(error) => {
                if let Some(outbox_id) = outbox_id {
                    let _ = update_outbox_status(state, outbox_id, "failed", Some(&error));
                }
                return Err(error);
            }
        }
    } else {
        None
    };
    let result = send_once(state, &account, &input, initial_access_token.as_deref()).await;
    let result = match result {
        Ok(value) => Ok(value),
        Err(error) if account.auth_type == "oauth2" && is_smtp_auth_error(&error) => {
            match oauth::force_refresh_access_token(
                state,
                account_id,
                &account.provider_key,
                initial_access_token.as_deref(),
            )
            .await
            {
                Ok(token) => {
                    let retry = send_once(state, &account, &input, Some(&token.access_token)).await;
                    if let Err(error) = &retry {
                        if is_smtp_auth_error(error) {
                            let message = format!("SMTP OAuth 登录认证失败，请重新授权：{error}");
                            let _ = oauth::set_connection_state(
                                state,
                                account_id,
                                "reauthorize",
                                true,
                                Some(&message),
                            );
                            return Err(message);
                        }
                    }
                    retry
                }
                Err(refresh_error) => Err(refresh_error),
            }
        }
        Err(error) => Err(error),
    };

    match result {
        Ok(mut value) => {
            if let Some(outbox_id) = outbox_id {
                update_outbox_status(state, outbox_id, "sent", None)?;
                value["outboxId"] = json!(outbox_id);
            }
            Ok(value)
        }
        Err(error) => {
            if let Some(outbox_id) = outbox_id {
                let _ = update_outbox_status(state, outbox_id, "failed", Some(&error));
            }
            Err(error)
        }
    }
}

async fn send_once(
    state: &AppState,
    account: &mail_transport::MailAccount,
    input: &Value,
    refreshed_access_token: Option<&str>,
) -> Result<Value, String> {
    let secret = if account.auth_type == "oauth2" {
        if let Some(access_token) = refreshed_access_token {
            access_token.to_string()
        } else {
            oauth::access_token(state, account.account_id, &account.provider_key)
                .await?
                .access_token
        }
    } else {
        account_password(state, account)?
    };
    let message = build_message(account, input)?;
    let transport = build_transport(account, &secret)?;
    transport
        .send(message)
        .await
        .map_err(|error| format!("SMTP 发信失败：{error}"))?;
    let message_id = input
        .get("messageId")
        .and_then(Value::as_str)
        .or_else(|| input.get("rfc822MessageId").and_then(Value::as_str))
        .unwrap_or_default();
    Ok(json!({ "status": "sent", "rfc822MessageId": message_id }))
}

fn build_message(account: &mail_transport::MailAccount, input: &Value) -> Result<Message, String> {
    let from = Mailbox::new(None, parse_address(&account.email)?);
    let mut builder = Message::builder().from(from);
    let to = addresses(input.get("to"))?;
    if to.is_empty() {
        return Err("收件人不能为空。".to_string());
    }
    for address in to {
        builder = builder.to(address);
    }
    for address in addresses(input.get("cc"))? {
        builder = builder.cc(address);
    }
    for address in addresses(input.get("bcc"))? {
        builder = builder.bcc(address);
    }
    if let Some(message_id) = input.get("rfc822MessageId").and_then(Value::as_str) {
        builder = builder.message_id(Some(message_id.to_string()));
    }
    if let Some(in_reply_to) = input.get("inReplyTo").and_then(Value::as_str) {
        builder = builder.in_reply_to(in_reply_to.to_string());
    }
    if let Some(references) = input.get("referencesHeader").and_then(Value::as_str) {
        builder = builder.references(references.to_string());
    }
    builder = builder.subject(
        input
            .get("subject")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    );

    let body_text = input
        .get("bodyText")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let body_html = input.get("bodyHtml").and_then(Value::as_str);
    let body = if let Some(body_html) = body_html.filter(|value| !value.trim().is_empty()) {
        MultiPart::alternative()
            .singlepart(SinglePart::plain(body_text))
            .singlepart(SinglePart::html(body_html.to_string()))
    } else {
        MultiPart::mixed().singlepart(SinglePart::plain(body_text))
    };
    let mut mixed = MultiPart::mixed().multipart(body);
    if let Some(attachments) = input.get("attachments").and_then(Value::as_array) {
        for attachment in attachments {
            let path = attachment
                .get("filePath")
                .and_then(Value::as_str)
                .ok_or_else(|| "附件路径不能为空。".to_string())?;
            let filename = attachment
                .get("filename")
                .and_then(Value::as_str)
                .or_else(|| attachment.get("name").and_then(Value::as_str))
                .unwrap_or("attachment")
                .to_string();
            let mime_type = attachment
                .get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream");
            let content_type = ContentType::parse(mime_type)
                .map_err(|error| format!("附件 MIME 类型无效：{error}"))?;
            mixed = mixed.singlepart(Attachment::new(filename).body(
                fs::read(path).map_err(|error| format!("读取附件失败：{error}"))?,
                content_type,
            ));
        }
    }
    builder
        .multipart(mixed)
        .map_err(|error| format!("构造邮件失败：{error}"))
}

fn build_transport(
    account: &mail_transport::MailAccount,
    secret: &str,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let host = account
        .smtp_host
        .as_deref()
        .filter(|host| !host.trim().is_empty())
        .ok_or_else(|| "SMTP 地址不能为空。".to_string())?;
    let port = account.smtp_port.unwrap_or_else(|| {
        if account.smtp_security.as_deref() == Some("ssl_tls") {
            465
        } else {
            587
        }
    });
    let security = account.smtp_security.as_deref().unwrap_or("starttls");
    let builder = match security {
        "ssl_tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(host),
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host),
        "none" => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
            host,
        )),
        _ => return Err("不支持的 SMTP 加密方式。".to_string()),
    }
    .map_err(|error| format!("创建 SMTP TLS 配置失败：{error}"))?;
    let credentials = Credentials::new(account.email.clone(), secret.to_string());
    let builder = builder
        .port(port)
        .credentials(credentials)
        .timeout(Some(Duration::from_secs(30)));
    let builder =
        if account.auth_type == "oauth2" || account.smtp_auth_type.as_deref() == Some("oauth2") {
            builder.authentication(vec![Mechanism::Xoauth2])
        } else {
            builder
        };
    Ok(builder.build())
}

fn addresses(value: Option<&Value>) -> Result<Vec<Mailbox>, String> {
    let values = value.and_then(Value::as_array).cloned().unwrap_or_default();
    values
        .iter()
        .map(|value| {
            let email = value
                .get("email")
                .and_then(Value::as_str)
                .or_else(|| value.as_str())
                .ok_or_else(|| "收件人地址无效。".to_string())?;
            let name = value
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .map(str::to_string);
            Ok(Mailbox::new(name, parse_address(email)?))
        })
        .collect()
}

fn parse_address(value: &str) -> Result<lettre::address::Address, String> {
    value
        .trim()
        .parse()
        .map_err(|error| format!("邮箱地址无效：{error}"))
}

fn account_password(
    state: &AppState,
    account: &mail_transport::MailAccount,
) -> Result<String, String> {
    mail_transport::password(state, account)
}

fn is_smtp_auth_error(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("auth")
        || error.contains("authentication")
        || error.contains("535")
        || error.contains("oauth")
}

fn update_outbox_status(
    state: &AppState,
    outbox_id: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = db::open(state)?;
    connection
        .execute(
            "UPDATE onemail_outbox_messages SET status=?2,last_error=?3,
               sent_at=CASE WHEN ?2='sent' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE sent_at END,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE outbox_id=?1",
            rusqlite::params![outbox_id, status, error],
        )
        .map(|_| ())
        .map_err(|error| format!("更新发信状态失败：{error}"))
}
