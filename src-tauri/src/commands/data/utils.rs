use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use rusqlite::types::ValueRef;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub(super) fn encrypt_password(database_key: &str, password: &str) -> Result<String, String> {
    let key = Sha256::digest(database_key.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "创建凭据加密器失败。".to_string())?;
    let mut iv = [0_u8; 12];
    rand::rng().fill_bytes(&mut iv);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&iv), password.as_bytes())
        .map_err(|_| "加密账号凭据失败。".to_string())?;
    let tag_start = encrypted
        .len()
        .checked_sub(16)
        .ok_or_else(|| "加密账号凭据失败。".to_string())?;
    let payload = json!({
        "version": 1,
        "alg": "aes-256-gcm",
        "iv": BASE64.encode(iv),
        "authTag": BASE64.encode(&encrypted[tag_start..]),
        "ciphertext": BASE64.encode(&encrypted[..tag_start])
    });
    Ok(BASE64.encode(serde_json::to_vec(&payload).map_err(|error| error.to_string())?))
}

pub(super) fn require_object(value: &Value) -> Result<&Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "请求参数格式无效。".to_string())
}

pub(super) fn required_string(
    object: &Map<String, Value>,
    key: &str,
    message: &str,
) -> Result<String, String> {
    optional_string(object, key)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| message.to_string())
}

pub(super) fn optional_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

pub(super) fn required_i64(
    object: &Map<String, Value>,
    key: &str,
    message: &str,
) -> Result<i64, String> {
    optional_i64(object, key).ok_or_else(|| message.to_string())
}

pub(super) fn optional_i64(object: &Map<String, Value>, key: &str) -> Option<i64> {
    object.get(key).and_then(Value::as_i64)
}

pub(super) fn optional_bool(object: &Map<String, Value>, key: &str) -> Option<bool> {
    object.get(key).and_then(Value::as_bool)
}

pub(super) fn database_error(error: rusqlite::Error) -> String {
    format!("数据库操作失败：{error}")
}

#[allow(dead_code)]
fn sqlite_value_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::from(value),
        ValueRef::Real(value) => Value::from(value),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::String(BASE64.encode(value)),
    }
}
