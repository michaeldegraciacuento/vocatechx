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
];

fn main() {
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
  )
  .expect("failed to run tauri-build");
}
