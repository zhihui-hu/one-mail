pub(crate) mod accounts;
pub(crate) mod compose;
pub(crate) mod messages;
pub(crate) mod settings;
pub(crate) mod sync;
pub(crate) mod updates;
mod utils;

#[tauri::command]
pub fn logos_get(domain: String) -> Option<String> {
    let _ = domain;
    None
}
