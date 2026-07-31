mod commands;
mod db;
mod state;

use commands::{backup, data, system};
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = AppState::initialize(&app.handle())?;
            db::initialize(&state)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::system_info,
            system::system_set_title_bar_theme,
            system::system_reveal_database,
            system::system_reveal_path,
            system::system_open_external,
            system::accounts_open_add_window,
            system::accounts_close_add_window,
            data::accounts_list,
            data::accounts_create,
            data::accounts_update,
            data::accounts_reauthorize,
            data::accounts_disable,
            data::accounts_remove,
            data::logos_get,
            data::messages_list,
            data::messages_stats,
            data::messages_get,
            data::messages_load_body,
            data::messages_set_read_state,
            data::messages_bulk_set_read_state,
            data::messages_mark_all_read,
            data::messages_download_attachment,
            data::messages_delete,
            data::messages_bulk_delete,
            data::messages_hide_local,
            data::messages_restore,
            data::compose_create_reply_draft,
            data::compose_create_forward_draft,
            data::compose_send,
            data::compose_select_attachments,
            data::compose_list_outbox,
            data::compose_save_draft,
            data::compose_delete_draft,
            data::compose_retry,
            data::compose_delete_outbox,
            data::sync_start_all,
            data::sync_start_account,
            data::sync_status,
            data::notifications_status,
            data::settings_get,
            data::settings_update,
            data::settings_get_backup_sync,
            data::settings_update_backup_sync,
            data::settings_test_backup_sync,
            data::settings_upload_backup_sync,
            data::settings_download_backup_sync,
            data::settings_import_backup_from_remote,
            backup::settings_export_sql,
            backup::settings_import_sql,
            data::updates_check,
            data::updates_status,
            data::updates_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running OneMail");
}
