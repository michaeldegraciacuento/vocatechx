mod activity;
mod auth;
mod commands;
mod conversations;
mod db;
mod devices;
mod error;
mod network;
mod ralp;
mod session;
mod software;
mod system_info;

use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
  db: Mutex<Connection>,
  session: session::Session,
  monitor: system_info::SystemMonitor,
  ralp: ralp::Ralp,
  software: software::SoftwareCenter,
}

impl AppState {
  fn db(&self) -> MutexGuard<'_, Connection> {
    self.db.lock().unwrap_or_else(|e| e.into_inner())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let data_dir = app.path().app_data_dir()?;
      std::fs::create_dir_all(&data_dir)?;
      let db_path = data_dir.join(db::DATABASE_FILE);
      let conn = db::open(&db_path).map_err(|e| format!("failed to open database at {}: {e:?}", db_path.display()))?;
      log::info!("database ready at {}", db_path.display());

      app.manage(AppState {
        db: Mutex::new(conn),
        session: session::Session::default(),
        monitor: system_info::SystemMonitor::new(),
        ralp: ralp::Ralp::new(ralp::Locations::resolve(app.handle())?),
        software: software::SoftwareCenter::resolve(),
      });
      Ok(())
    })
    .on_window_event(|window, event| {
      // Closing mid-install would abandon the batch and its history entry.
      if let tauri::WindowEvent::CloseRequested { api, .. } = event
        && window.try_state::<AppState>().is_some_and(|state| state.software.is_installing())
      {
        api.prevent_close();
      }
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_session,
      commands::login,
      commands::logout,
      commands::change_password,
      commands::get_system_overview,
      commands::get_recent_activity,
      commands::get_system_status,
      commands::ralp_status,
      commands::ralp_start,
      commands::ralp_import_model,
      commands::ralp_list_conversations,
      commands::ralp_get_messages,
      commands::ralp_delete_conversation,
      commands::ralp_send_message,
      commands::ralp_stop_generation,
      commands::net_health,
      commands::net_adapters,
      commands::net_run_diagnostics,
      commands::net_dns_lookup,
      commands::net_repair,
      commands::net_open_settings,
      commands::net_performance_test,
      commands::net_sharing_overview,
      commands::net_discover_computers,
      commands::net_list_shares,
      commands::net_check_smb,
      commands::net_test_share_access,
      commands::net_open_share,
      commands::net_pick_folder,
      commands::net_create_share,
      commands::net_remove_share,
      commands::net_wifi_password,
      commands::net_history,
      commands::net_report,
      commands::net_export_report,
      commands::dev_printers,
      commands::dev_spooler_status,
      commands::dev_print_jobs,
      commands::dev_devices,
      commands::dev_drivers,
      commands::dev_open_printer_settings,
      commands::dev_open_printer_window,
      commands::dev_open_device_manager,
      commands::dev_open_device_properties,
      commands::dev_history,
      commands::dev_report,
      commands::dev_export_report,
      commands::sw_library,
      commands::sw_status,
      commands::sw_icon,
      commands::sw_inspect,
      commands::sw_save_app,
      commands::sw_open_folder,
      commands::sw_install,
      commands::sw_uninstall,
      commands::sw_cancel_install,
      commands::sw_history,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        if let Some(state) = app.try_state::<AppState>() {
          state.ralp.shutdown();
        }
      }
    });
}
