use serde_json::{json, Value};
use tauri::State;

use crate::{mail_sync, state::AppState};

#[tauri::command]
pub fn sync_status() -> Value {
    json!({ "running": false, "accountIds": [] })
}

#[tauri::command]
pub async fn sync_start_all(
    state: State<'_, AppState>,
    mode: Option<String>,
) -> Result<Value, String> {
    mail_sync::sync_all(&state, mode.as_deref()).await
}

#[tauri::command]
pub async fn sync_start_account(
    state: State<'_, AppState>,
    account_id: i64,
    mode: Option<String>,
) -> Result<Value, String> {
    mail_sync::sync_account(&state, account_id, mode.as_deref()).await
}

#[tauri::command]
pub fn notifications_status() -> Value {
    json!({ "desktopSupported": true })
}
