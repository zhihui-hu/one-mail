use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::{db, oauth, state::AppState};

use super::utils::{
    database_error, encrypt_password, optional_bool, optional_i64, optional_string, require_object,
    required_i64, required_string,
};

#[tauri::command]
pub fn accounts_list(state: State<'_, AppState>) -> Result<Value, String> {
    let connection = db::open(&state)?;
    Ok(Value::Array(list_accounts(&connection)?))
}

#[tauri::command]
pub async fn accounts_create(
    app: AppHandle,
    state: State<'_, AppState>,
    input: Value,
) -> Result<Value, String> {
    let object = require_object(&input)?;
    let provider_key = required_string(object, "providerKey", "邮箱服务商不能为空。")?;
    let auth_type = required_string(object, "authType", "认证方式不能为空。")?;
    let login_hint = optional_string(object, "email");
    let authorized = if auth_type == "oauth2" {
        Some(oauth::authorize(&provider_key, login_hint.as_deref(), Some(&app)).await?)
    } else {
        None
    };
    let email = authorized
        .as_ref()
        .map(|value| value.email.clone())
        .or(login_hint)
        .ok_or_else(|| "邮箱地址不能为空。".to_string())?;
    let normalized_email = email.trim().to_lowercase();
    let imap_host = required_string(object, "imapHost", "IMAP 地址不能为空。")?;
    let imap_port = required_i64(object, "imapPort", "IMAP 端口无效。")?;
    let imap_security = required_string(object, "imapSecurity", "IMAP 加密方式不能为空。")?;
    let password = if auth_type == "oauth2" {
        None
    } else {
        Some(required_string(
            object,
            "password",
            "请输入邮箱授权码或密码。",
        )?)
    };
    let account_label = optional_string(object, "accountLabel")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| normalized_email.clone());
    let encrypted_password = password
        .as_deref()
        .map(|password| encrypt_password(&state.database_key()?, password))
        .transpose()?;
    let credential_state = if auth_type == "oauth2" {
        "pending"
    } else {
        "stored"
    };
    let smtp_host = optional_string(object, "smtpHost");
    let smtp_port = optional_i64(object, "smtpPort");
    let smtp_security = optional_string(object, "smtpSecurity");
    let smtp_auth_type =
        optional_string(object, "smtpAuthType").unwrap_or_else(|| auth_type.clone());
    let smtp_enabled = optional_bool(object, "smtpEnabled").unwrap_or(true);

    let connection = db::open(&state)?;
    connection
        .execute(
            "INSERT OR IGNORE INTO onemail_provider_presets (
                provider_key, display_name, domains_json, auth_type,
                imap_host, imap_port, imap_security,
                smtp_host, smtp_port, smtp_security, smtp_auth_type,
                smtp_requires_auth, is_builtin, is_active
             ) VALUES (?1, ?1, '[]', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 0, 1)",
            params![
                provider_key,
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type
            ],
        )
        .map_err(database_error)?;
    connection
        .execute(
            "INSERT INTO onemail_mail_accounts (
                provider_key, email, normalized_email, account_label, avatar_text,
                auth_type, imap_host, imap_port, imap_security,
                smtp_host, smtp_port, smtp_security, smtp_auth_type, smtp_enabled,
                encrypted_password, credential_state, status
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                       ?15, ?16, 'active')",
            params![
                provider_key,
                email,
                normalized_email,
                account_label,
                normalized_email
                    .chars()
                    .next()
                    .unwrap_or('?')
                    .to_uppercase()
                    .to_string(),
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type,
                smtp_enabled,
                encrypted_password,
                credential_state
            ],
        )
        .map_err(|error| format!("保存账号失败：{error}"))?;
    let account_id = connection.last_insert_rowid();
    if let Some(authorized) = authorized {
        let provider = oauth::provider_for(&provider_key)?;
        if let Err(error) = oauth::save_token(
            &state,
            account_id,
            &provider_key,
            &authorized.token,
            provider.scopes(),
        ) {
            let _ = connection.execute(
                "DELETE FROM onemail_mail_accounts WHERE account_id=?1",
                [account_id],
            );
            return Err(error);
        }
    }
    let account = get_account(&connection, account_id)?
        .ok_or_else(|| "保存账号后无法读取账号。".to_string())?;
    let _ = app.emit(
        "accounts/created",
        json!({ "account": account, "requestedSync": true }),
    );
    Ok(account)
}

#[tauri::command]
pub fn accounts_update(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let object = require_object(&input)?;
    let account_id = required_i64(object, "accountId", "账号 ID 无效。")?;
    let connection = db::open(&state)?;
    let current =
        get_account(&connection, account_id)?.ok_or_else(|| format!("账号不存在：{account_id}"))?;
    let current_object = require_object(&current)?;

    let provider_key = optional_string(object, "providerKey")
        .or_else(|| optional_string(current_object, "providerKey"))
        .unwrap_or_default();
    let display_name = optional_string(object, "displayName")
        .or_else(|| optional_string(current_object, "displayName"));
    let account_label = optional_string(object, "accountLabel")
        .or_else(|| optional_string(current_object, "accountLabel"))
        .or_else(|| optional_string(current_object, "email"));
    let auth_type = optional_string(object, "authType")
        .or_else(|| optional_string(current_object, "authType"))
        .unwrap_or_default();
    let imap_host = optional_string(object, "imapHost")
        .or_else(|| optional_string(current_object, "imapHost"))
        .unwrap_or_default();
    let imap_port = optional_i64(object, "imapPort")
        .or_else(|| optional_i64(current_object, "imapPort"))
        .unwrap_or(993);
    let imap_security = optional_string(object, "imapSecurity")
        .or_else(|| optional_string(current_object, "imapSecurity"))
        .unwrap_or_else(|| "ssl_tls".to_string());
    let smtp_host =
        optional_string(object, "smtpHost").or_else(|| optional_string(current_object, "smtpHost"));
    let smtp_port =
        optional_i64(object, "smtpPort").or_else(|| optional_i64(current_object, "smtpPort"));
    let smtp_security = optional_string(object, "smtpSecurity")
        .or_else(|| optional_string(current_object, "smtpSecurity"));
    let smtp_auth_type = optional_string(object, "smtpAuthType")
        .or_else(|| optional_string(current_object, "smtpAuthType"));
    let smtp_enabled = optional_bool(object, "smtpEnabled")
        .or_else(|| optional_bool(current_object, "smtpEnabled"))
        .unwrap_or(true);
    let sync_enabled = optional_bool(object, "syncEnabled")
        .or_else(|| optional_bool(current_object, "syncEnabled"))
        .unwrap_or(true);

    connection
        .execute(
            "UPDATE onemail_mail_accounts SET
               provider_key=?2, display_name=?3, account_label=?4, auth_type=?5,
               imap_host=?6, imap_port=?7, imap_security=?8,
               smtp_host=?9, smtp_port=?10, smtp_security=?11, smtp_auth_type=?12,
               smtp_enabled=?13, sync_enabled=?14,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE account_id=?1",
            params![
                account_id,
                provider_key,
                display_name,
                account_label,
                auth_type,
                imap_host,
                imap_port,
                imap_security,
                smtp_host,
                smtp_port,
                smtp_security,
                smtp_auth_type,
                smtp_enabled,
                sync_enabled
            ],
        )
        .map_err(database_error)?;

    if let Some(password) = optional_string(object, "password") {
        let encrypted = encrypt_password(&state.database_key()?, &password)?;
        connection
            .execute(
                "UPDATE onemail_mail_accounts SET encrypted_password=?2,
                  credential_state='stored' WHERE account_id=?1",
                params![account_id, encrypted],
            )
            .map_err(database_error)?;
    }
    get_account(&connection, account_id)?.ok_or_else(|| format!("更新后无法读取账号：{account_id}"))
}

#[tauri::command]
pub fn accounts_disable(state: State<'_, AppState>, account_id: i64) -> Result<Value, String> {
    let connection = db::open(&state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET sync_enabled=0, status='disabled',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
            [account_id],
        )
        .map_err(database_error)?;
    get_account(&connection, account_id)?.ok_or_else(|| format!("账号不存在：{account_id}"))
}

#[tauri::command]
pub fn accounts_remove(state: State<'_, AppState>, account_id: i64) -> Result<bool, String> {
    let connection = db::open(&state)?;
    connection
        .execute(
            "DELETE FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
        )
        .map(|changes| changes > 0)
        .map_err(database_error)
}

#[tauri::command]
pub async fn accounts_reauthorize(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: i64,
) -> Result<Value, String> {
    let (provider_key, current_email, auth_type) = {
        let connection = db::open(&state)?;
        connection
            .query_row(
                "SELECT provider_key,email,auth_type FROM onemail_mail_accounts WHERE account_id=?1",
                [account_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .map_err(|_| format!("账号不存在：{account_id}"))?
    };
    if auth_type != "oauth2" {
        return Err("当前账号不是 OAuth 认证账号。".to_string());
    }
    let authorized = oauth::authorize(&provider_key, Some(&current_email), Some(&app)).await?;
    let normalized_email = authorized.email.to_lowercase();
    let provider = oauth::provider_for(&provider_key)?;
    let refresh_lock = state.oauth_refresh_lock(account_id)?;
    let _refresh_guard = refresh_lock.lock().await;
    let connection = db::open(&state)?;
    connection
        .execute(
            "UPDATE onemail_mail_accounts SET email=?2,normalized_email=?3,credential_state='pending',
               status='active',last_error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE account_id=?1",
            params![account_id, authorized.email, normalized_email],
        )
        .map_err(|error| format!("更新授权账号失败：{error}"))?;
    oauth::save_token(
        &state,
        account_id,
        &provider_key,
        &authorized.token,
        provider.scopes(),
    )?;
    get_account(&connection, account_id)?.ok_or_else(|| format!("账号不存在：{account_id}"))
}

fn list_accounts(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT account_id,provider_key,email,display_name,account_label,auth_type,
                    imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,
                    smtp_auth_type,smtp_enabled,sync_enabled,
                    CASE WHEN encrypted_password IS NOT NULL THEN 'stored'
                         WHEN auth_type='oauth2' AND EXISTS (
                           SELECT 1 FROM onemail_oauth_tokens t
                           WHERE t.account_id=onemail_mail_accounts.account_id
                         ) THEN 'stored' ELSE credential_state END,
                    status,connection_state,last_sync_at,last_error
             FROM onemail_mail_accounts ORDER BY sort_order,account_id",
        )
        .map_err(database_error)?;
    let accounts = statement
        .query_map([], map_account)
        .map_err(database_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(database_error)?;
    Ok(accounts)
}

fn get_account(connection: &Connection, account_id: i64) -> Result<Option<Value>, String> {
    connection
        .query_row(
            "SELECT account_id,provider_key,email,display_name,account_label,auth_type,
                    imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,
                    smtp_auth_type,smtp_enabled,sync_enabled,
                    CASE WHEN encrypted_password IS NOT NULL THEN 'stored'
                         WHEN auth_type='oauth2' AND EXISTS (
                           SELECT 1 FROM onemail_oauth_tokens t
                           WHERE t.account_id=onemail_mail_accounts.account_id
                         ) THEN 'stored' ELSE credential_state END,
                    status,connection_state,last_sync_at,last_error
             FROM onemail_mail_accounts WHERE account_id=?1",
            [account_id],
            map_account,
        )
        .optional()
        .map_err(database_error)
}

fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "accountId": row.get::<_, i64>(0)?,
        "providerKey": row.get::<_, String>(1)?,
        "email": row.get::<_, String>(2)?,
        "displayName": row.get::<_, Option<String>>(3)?,
        "accountLabel": row.get::<_, Option<String>>(4)?,
        "authType": row.get::<_, String>(5)?,
        "imapHost": row.get::<_, String>(6)?,
        "imapPort": row.get::<_, i64>(7)?,
        "imapSecurity": row.get::<_, String>(8)?,
        "smtpHost": row.get::<_, Option<String>>(9)?,
        "smtpPort": row.get::<_, Option<i64>>(10)?,
        "smtpSecurity": row.get::<_, Option<String>>(11)?,
        "smtpAuthType": row.get::<_, Option<String>>(12)?,
        "smtpEnabled": row.get::<_, i64>(13)? != 0,
        "syncEnabled": row.get::<_, i64>(14)? != 0,
        "credentialState": row.get::<_, String>(15)?,
        "status": row.get::<_, String>(16)?,
        "connectionStatus": row.get::<_, String>(17)?,
        "lastSyncAt": row.get::<_, Option<String>>(18)?,
        "lastError": row.get::<_, Option<String>>(19)?
    }))
}
