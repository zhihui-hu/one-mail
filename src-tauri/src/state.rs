use std::{
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

use rand::RngCore;
use tauri::{AppHandle, Manager};

const DATABASE_KEY_PREFIX: &str = "ONEMAIL_DATABASE_KEY=";

pub struct AppState {
    pub database_path: PathBuf,
    pub user_data_path: PathBuf,
    pub app_version: String,
    database_key: RwLock<String>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let user_data_path = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法确定应用数据目录：{error}"))?;
        let database_dir = user_data_path.join("OneMail");
        fs::create_dir_all(&database_dir)
            .map_err(|error| format!("无法创建数据库目录：{error}"))?;

        let key_path = database_dir.join(".env");
        let database_key = read_database_key(&key_path)?.unwrap_or_else(create_database_key);
        write_database_key(&key_path, &database_key)?;

        Ok(Self {
            database_path: database_dir.join("onemail.sqlite"),
            user_data_path,
            app_version: app.package_info().version.to_string(),
            database_key: RwLock::new(database_key),
        })
    }

    pub fn database_key(&self) -> Result<String, String> {
        self.database_key
            .read()
            .map(|key| key.clone())
            .map_err(|_| "无法读取数据库密钥。".to_string())
    }

    pub fn set_database_key(&self, key: &str) -> Result<(), String> {
        if !is_valid_database_key(key) {
            return Err("数据库密钥格式无效。".to_string());
        }

        let key_path = self
            .database_path
            .parent()
            .ok_or_else(|| "数据库目录无效。".to_string())?
            .join(".env");
        write_database_key(&key_path, key)?;
        *self
            .database_key
            .write()
            .map_err(|_| "无法更新数据库密钥。".to_string())? = key.to_string();
        Ok(())
    }
}

fn read_database_key(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("无法读取数据库密钥：{error}"))?;
    let key = content.lines().find_map(|line| {
        line.trim()
            .strip_prefix(DATABASE_KEY_PREFIX)
            .map(str::trim)
            .map(|value| value.trim_matches(['\'', '"']).to_string())
    });

    match key {
        Some(value) if is_valid_database_key(&value) => Ok(Some(value)),
        Some(_) => Err("数据库密钥格式无效。".to_string()),
        None => Ok(None),
    }
}

fn write_database_key(path: &Path, key: &str) -> Result<(), String> {
    if !is_valid_database_key(key) {
        return Err("数据库密钥格式无效。".to_string());
    }
    fs::write(path, format!("{DATABASE_KEY_PREFIX}{key}\n"))
        .map_err(|error| format!("无法保存数据库密钥：{error}"))
}

fn create_database_key() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut random = [0_u8; 8];
    rand::rng().fill_bytes(&mut random);
    let suffix = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("k{timestamp}{suffix}")
}

pub fn is_valid_database_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    bytes.len() == 27
        && bytes[0] == b'k'
        && bytes[1..11].iter().all(u8::is_ascii_digit)
        && bytes[11..].iter().all(u8::is_ascii_hexdigit)
}
