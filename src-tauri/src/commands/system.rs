use std::{path::Path, process::Command};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::state::AppState;

#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> Value {
    json!({
        "platform": javascript_platform(),
        "appVersion": state.app_version,
        "databasePath": state.database_path.to_string_lossy(),
        "userDataPath": state.user_data_path.to_string_lossy()
    })
}

#[tauri::command]
pub fn system_set_title_bar_theme(window: WebviewWindow, theme: String) -> Result<bool, String> {
    let next_theme = match theme.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return Ok(false),
    };
    window
        .set_theme(Some(next_theme))
        .map_err(|error| format!("更新窗口主题失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn system_reveal_database(state: State<'_, AppState>) -> Result<bool, String> {
    reveal_path(&state.database_path)?;
    Ok(true)
}

#[tauri::command]
pub fn system_reveal_path(path: String) -> Result<bool, String> {
    let target = path.trim();
    if target.is_empty() {
        return Ok(false);
    }
    reveal_path(Path::new(target))?;
    Ok(true)
}

#[tauri::command]
pub fn system_open_external(url: String) -> Result<bool, String> {
    let target = url.trim();
    if !target.starts_with("https://") && !target.starts_with("http://") {
        return Ok(false);
    }
    open::that(target).map_err(|error| format!("打开链接失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn accounts_open_add_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("add-account") {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("打开添加账号窗口失败：{error}"))?;
        return Ok(true);
    }

    WebviewWindowBuilder::new(
        &app,
        "add-account",
        WebviewUrl::App("index.html#/accounts/new".into()),
    )
    .title("添加账号 - OneMail")
    .inner_size(440.0, 460.0)
    .min_inner_size(440.0, 460.0)
    .max_inner_size(440.0, 460.0)
    .resizable(false)
    .center()
    .build()
    .map_err(|error| format!("创建添加账号窗口失败：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub fn accounts_close_add_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("add-account") {
        window
            .close()
            .map_err(|error| format!("关闭添加账号窗口失败：{error}"))?;
    }
    Ok(true)
}

fn javascript_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    return "darwin";
    #[cfg(target_os = "windows")]
    return "win32";
    #[cfg(target_os = "linux")]
    return "linux";
    #[allow(unreachable_code)]
    "unknown"
}

fn reveal_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(path).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status();

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .status();

    status
        .map_err(|error| format!("打开文件管理器失败：{error}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err("文件管理器未能打开目标路径。".to_string())
            }
        })
}
