use tauri::{State, WebviewWindow};

use crate::{
    ai::{self, AiChatInput, AiChatResult, AiSettings, AiSettingsInput},
    state::AppState,
};

#[tauri::command]
pub async fn ai_settings_get(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<AiSettings, String> {
    require_main_window(&window)?;
    ai::settings_get(&state).await
}

#[tauri::command]
pub async fn ai_settings_verify_and_save(
    window: WebviewWindow,
    state: State<'_, AppState>,
    input: AiSettingsInput,
) -> Result<AiSettings, String> {
    require_main_window(&window)?;
    ai::settings_verify_and_save(&state, input).await
}

#[tauri::command]
pub async fn ai_settings_clear(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<AiSettings, String> {
    require_main_window(&window)?;
    ai::settings_clear(&state).await
}

#[tauri::command]
pub async fn ai_chat(
    window: WebviewWindow,
    state: State<'_, AppState>,
    input: AiChatInput,
) -> Result<AiChatResult, String> {
    require_main_window(&window)?;
    ai::chat(&state, input).await
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    require_main_window_label(window.label())
}

fn require_main_window_label(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("当前窗口无权使用 AI 功能。".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::require_main_window_label;

    #[test]
    fn ai_commands_only_allow_the_main_window() {
        assert!(require_main_window_label("main").is_ok());
        assert!(require_main_window_label("add-account").is_err());
        assert!(require_main_window_label("").is_err());
    }
}
