use serde_json::{json, Value};
use tauri::State;

use crate::{db, state::AppState};

#[tauri::command]
pub fn updates_check(state: State<'_, AppState>) -> Value {
    json!({
        "status": "unsupported",
        "currentVersion": state.app_version,
        "message": "Tauri 更新源尚未配置。"
    })
}

#[tauri::command]
pub fn updates_status(state: State<'_, AppState>) -> Value {
    json!({
        "state": "unsupported",
        "currentVersion": state.app_version,
        "message": "Tauri 更新源尚未配置。",
        "updatedAt": db::now_iso()
    })
}

#[tauri::command]
pub fn updates_install() -> bool {
    false
}
