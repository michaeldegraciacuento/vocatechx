/// Every command the frontend may invoke. Commands not listed here are
/// rejected by Tauri even if registered in `lib.rs`.
const COMMANDS: &[&str] = &[
  "get_session",
  "login",
  "logout",
  "change_password",
  "get_system_overview",
  "get_recent_activity",
  "get_system_status",
  "ralp_status",
  "ralp_start",
  "ralp_import_model",
  "ralp_list_conversations",
  "ralp_get_messages",
  "ralp_delete_conversation",
  "ralp_send_message",
  "ralp_stop_generation",
  "net_health",
  "net_adapters",
  "net_run_diagnostics",
  "net_dns_lookup",
  "net_repair",
  "net_open_settings",
  "net_performance_test",
  "net_sharing_overview",
  "net_discover_computers",
  "net_list_shares",
  "net_check_smb",
  "net_test_share_access",
  "net_open_share",
  "net_pick_folder",
  "net_create_share",
  "net_remove_share",
  "net_wifi_password",
  "net_history",
  "net_report",
  "net_export_report",
  "dev_printers",
  "dev_spooler_status",
  "dev_print_jobs",
  "dev_devices",
  "dev_drivers",
  "dev_open_printer_settings",
  "dev_open_printer_window",
  "dev_open_device_manager",
  "dev_open_device_properties",
  "dev_history",
  "dev_report",
  "dev_export_report",
  "sw_library",
  "sw_status",
  "sw_icon",
  "sw_inspect",
  "sw_save_app",
  "sw_open_folder",
  "sw_install",
  "sw_uninstall",
  "sw_cancel_install",
  "sw_history",
  "learn_state",
  "learn_update_progress",
  "learn_set_bookmark",
  "learn_record_quiz",
  "learn_record_lab",
  "wr_status",
  "wr_run",
  "wr_history",
  "wr_report",
  "wr_export_report",
];

fn main() {
  println!("cargo:rerun-if-changed=windows-app-manifest.xml");
  // Release builds always run as administrator (one UAC prompt at launch).
  // Dev builds keep Tauri's default manifest so `npm run tauri dev` starts
  // from a normal terminal; Windows refuses to launch an admin-only exe from
  // a non-elevated one (os error 740).
  let windows = if std::env::var("PROFILE").as_deref() == Ok("release") {
    tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"))
  } else {
    tauri_build::WindowsAttributes::new()
  };
  tauri_build::try_build(
    tauri_build::Attributes::new()
      .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS))
      .windows_attributes(windows),
  )
  .expect("failed to run tauri-build");
}
