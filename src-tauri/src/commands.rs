//! The only backend entry points the frontend can call. Each one is listed in
//! `build.rs` and granted in `capabilities/default.json`.

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::activity::{self, ActivityItem};
use crate::conversations::{self, ChatMessage, ConversationSummary};
use crate::devices::hardware::{self, DeviceInfo, DriverInfo};
use crate::devices::jobs::{self, PrintJob};
use crate::devices::printers::{self, PrinterInfo, PrinterWindow};
use crate::devices::spooler::{self, SpoolerStatus};
use crate::error::{AppError, AppResult};
use crate::network::adapters::{self, Adapter};
use crate::network::diagnostics::{self, DiagnosticReport, NetworkHealth, PerformanceResult};
use crate::network::repair::{self, RepairAction, RepairOutcome, RepairStatus, SettingsPage};
use crate::network::report::{self, Level, LogLine, ReportDetail};
use crate::network::sharing::{self, AccessResult, Discovery, NetError, Share, ShareAccess, ShareChange, SharingOverview, SmbCheck};
use crate::network::wifi::{self, WifiPassword};
use crate::network::{self, validate, DnsComparison};
use crate::ralp::{self, ImportProgress, RalpStatus};
use crate::session::SessionUser;
use crate::software::{
  self,
  detect::InstallState,
  inspect::{InstallerDetails, Signature},
  install::{InstallEvent, ItemResult},
  library::{AppSetup, InstallerType, PendingInstaller},
};
use crate::system_info::SystemOverview;
use crate::{auth, db, learning, AppState};

/// Runs slow work (password hashing, system queries) off the main thread so
/// the window stays responsive.
async fn run_blocking<T, F>(app: AppHandle, work: F) -> AppResult<T>
where
  T: Send + 'static,
  F: FnOnce(&AppState) -> AppResult<T> + Send + 'static,
{
  tauri::async_runtime::spawn_blocking(move || work(&app.state::<AppState>()))
    .await
    .map_err(|e| AppError::Internal(format!("background task failed: {e}")))?
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>) -> Option<SessionUser> {
  state.session.current()
}

#[tauri::command]
pub async fn login(app: AppHandle, username: String, password: String) -> AppResult<SessionUser> {
  run_blocking(app, move |state| {
    let user = auth::login(&state.db(), &username, &password, auth::now())?;
    state.session.start(user.clone());
    Ok(user)
  })
  .await
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) {
  state.session.end();
}

#[tauri::command]
pub async fn change_password(
  app: AppHandle,
  current_password: String,
  new_password: String,
  confirm_password: String,
) -> AppResult<SessionUser> {
  run_blocking(app, move |state| {
    let user = state.session.require_signed_in()?;
    let updated = auth::change_password(&state.db(), user.id, &current_password, &new_password, &confirm_password)?;
    state.session.start(updated.clone());
    Ok(updated)
  })
  .await
}

#[tauri::command]
pub async fn get_system_overview(app: AppHandle) -> AppResult<SystemOverview> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    Ok(state.monitor.snapshot())
  })
  .await
}

#[tauri::command]
pub fn get_recent_activity(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<ActivityItem>> {
  state.session.require_active()?;
  activity::recent_activity(&state.db(), limit.unwrap_or(10).clamp(1, 50))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
  pub database_ready: bool,
  pub schema_version: usize,
  pub ralp: RalpStatus,
  /// VocaTechX never needs a network connection for its features.
  pub network_required: bool,
}

#[tauri::command]
pub fn get_system_status(state: State<'_, AppState>) -> AppResult<SystemStatus> {
  state.session.require_active()?;
  let schema_version = db::schema_version(&state.db())?;
  Ok(SystemStatus {
    database_ready: schema_version > 0,
    schema_version,
    ralp: state.ralp.status(),
    network_required: false,
  })
}

// ---------------------------------------------------------------------------
// Ralp (AI Troubleshooter)

#[tauri::command]
pub fn ralp_status(state: State<'_, AppState>) -> AppResult<RalpStatus> {
  state.session.require_active()?;
  Ok(state.ralp.status())
}

#[tauri::command]
pub async fn ralp_start(app: AppHandle) -> AppResult<RalpStatus> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    state.ralp.start()
  })
  .await
}

#[tauri::command]
pub async fn ralp_import_model(app: AppHandle, on_progress: Channel<ImportProgress>) -> AppResult<Option<String>> {
  let handle = app.clone();
  run_blocking(app, move |state| {
    state.session.require_active()?;
    state.ralp.import_model(&handle, |progress| {
      let _ = on_progress.send(progress);
    })
  })
  .await
}

#[tauri::command]
pub fn ralp_list_conversations(state: State<'_, AppState>) -> AppResult<Vec<ConversationSummary>> {
  let user = state.session.require_active()?;
  conversations::list(&state.db(), user.id)
}

#[tauri::command]
pub fn ralp_get_messages(state: State<'_, AppState>, conversation_id: i64) -> AppResult<Vec<ChatMessage>> {
  let user = state.session.require_active()?;
  conversations::messages(&state.db(), user.id, conversation_id)
}

#[tauri::command]
pub fn ralp_delete_conversation(state: State<'_, AppState>, conversation_id: i64) -> AppResult<()> {
  let user = state.session.require_active()?;
  conversations::delete(&state.db(), user.id, conversation_id)
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ChatEvent {
  Started { conversation_id: i64, user_message: ChatMessage },
  Delta { text: String },
  Done { message: Option<ChatMessage>, cancelled: bool },
}

#[tauri::command]
pub async fn ralp_send_message(
  app: AppHandle,
  conversation_id: Option<i64>,
  message: String,
  on_event: Channel<ChatEvent>,
) -> AppResult<()> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let text = conversations::validate_message(&message)?;
    state.ralp.ensure_ready()?;

    let (conversation_id, user_message, history) = {
      let db = state.db();
      let id = match conversation_id {
        Some(id) => {
          conversations::ensure_owned(&db, user.id, id)?;
          id
        }
        None => conversations::create(&db, user.id, text)?,
      };
      let user_message = conversations::add_message(&db, id, "user", text)?;
      (id, user_message, conversations::messages(&db, user.id, id)?)
    };
    let _ = on_event.send(ChatEvent::Started { conversation_id, user_message });

    let history = conversations::recent_history(&history, ralp::HISTORY_CHAR_BUDGET);
    let (reply, cancelled) = state
      .ralp
      .chat(history, |text| on_event.send(ChatEvent::Delta { text: text.to_string() }).is_ok())?;

    let reply = reply.trim();
    let saved = if reply.is_empty() {
      None
    } else {
      Some(conversations::add_message(&state.db(), conversation_id, "assistant", reply)?)
    };
    let _ = on_event.send(ChatEvent::Done { message: saved, cancelled });
    Ok(())
  })
  .await
}

#[tauri::command]
pub fn ralp_stop_generation(state: State<'_, AppState>) -> AppResult<()> {
  state.session.require_active()?;
  state.ralp.request_cancel();
  Ok(())
}

// ---------------------------------------------------------------------------
// Network Center

/// Saves a finished Network Center operation to history. A database problem
/// is logged but does not hide the result the user just waited for.
fn record_network_run(state: &AppState, run: report::NewRun<'_>) -> Option<i64> {
  match report::record(&state.db(), run) {
    Ok(id) => Some(id),
    Err(e) => {
      log::error!("could not save network run to history: {e:?}");
      None
    }
  }
}

fn repair_status_for_history(status: RepairStatus) -> &'static str {
  match status {
    RepairStatus::Success | RepairStatus::Partial => "success",
    RepairStatus::Failed => "failed",
    RepairStatus::Cancelled => "cancelled",
  }
}

#[tauri::command]
pub async fn net_health(app: AppHandle) -> AppResult<NetworkHealth> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    Ok(diagnostics::health())
  })
  .await
}

#[tauri::command]
pub async fn net_adapters(app: AppHandle) -> AppResult<Vec<Adapter>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    adapters::list_all().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub async fn net_run_diagnostics(app: AppHandle) -> AppResult<DiagnosticReport> {
  run_blocking(app, |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let mut result = diagnostics::run_diagnostics();
    let mut logs = diagnostics::step_logs(&result.steps);
    let level = if result.healthy { Level::Info } else { Level::Error };
    logs.push(LogLine::new(level, format!("Conclusion: {}", result.summary)));
    for action in &result.recommended_repairs {
      logs.push(LogLine::new(Level::Info, format!("Recommended repair: {}", action.title())));
    }
    result.run_id = record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "network_diagnostics",
        title: "Connectivity diagnostics",
        status: if result.healthy { "success" } else { "failed" },
        summary: &result.summary,
        started_at,
        finished_at: auth::now(),
        logs: &logs,
      },
    );
    Ok(result)
  })
  .await
}

#[tauri::command]
pub async fn net_dns_lookup(app: AppHandle, domain: String, servers: Vec<String>) -> AppResult<DnsComparison> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let mut result = network::compare_dns(&domain, &servers)?;
    let answered = result.results.iter().filter(|r| r.error.is_none()).count();
    let summary = format!(
      "{answered} of {} resolvers answered{}",
      result.results.len(),
      if result.consistent { "" } else { "; answers differ" }
    );
    result.run_id = record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "dns_test",
        title: &format!("DNS lookup: {}", result.domain),
        status: if answered > 0 { "success" } else { "failed" },
        summary: &summary,
        started_at,
        finished_at: auth::now(),
        logs: &network::dns_logs(&result),
      },
    );
    Ok(result)
  })
  .await
}

#[tauri::command]
pub async fn net_repair(app: AppHandle, action: RepairAction) -> AppResult<RepairOutcome> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let mut outcome = repair::run(action);
    outcome.run_id = record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "network_repair",
        title: action.title(),
        status: repair_status_for_history(outcome.status),
        summary: &outcome.message,
        started_at,
        finished_at: auth::now(),
        logs: &outcome.logs(),
      },
    );
    Ok(outcome)
  })
  .await
}

#[tauri::command]
pub fn net_open_settings(state: State<'_, AppState>, page: SettingsPage) -> AppResult<()> {
  state.session.require_active()?;
  repair::open_settings(page)
}

#[tauri::command]
pub async fn net_performance_test(app: AppHandle, target: Option<String>, count: Option<u32>) -> AppResult<PerformanceResult> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let (label, address) = network::resolve_target(target.as_deref().unwrap_or("1.1.1.1"))?;
    let mut result = diagnostics::performance(&label, address, count.unwrap_or(20).clamp(5, 100));
    result.run_id = record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "network_performance",
        title: &format!("Performance test: {label}"),
        status: if result.internet.received > 0 { "success" } else { "failed" },
        summary: &format!("{}: {}", result.quality, result.assessment),
        started_at,
        finished_at: auth::now(),
        logs: &diagnostics::performance_logs(&result),
      },
    );
    Ok(result)
  })
  .await
}

#[tauri::command]
pub async fn net_sharing_overview(app: AppHandle) -> AppResult<SharingOverview> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    Ok(sharing::overview())
  })
  .await
}

#[tauri::command]
pub async fn net_discover_computers(app: AppHandle) -> AppResult<Discovery> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    Ok(sharing::discover())
  })
  .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareListing {
  pub host: String,
  pub shares: Vec<Share>,
  pub error: Option<NetError>,
}

#[tauri::command]
pub async fn net_list_shares(app: AppHandle, host: String) -> AppResult<ShareListing> {
  run_blocking(app, move |state| {
    state.session.require_active()?;
    let host = validate::host(&host)?;
    Ok(match sharing::list_shares(&host) {
      Ok(shares) => ShareListing { host, shares, error: None },
      Err(error) => ShareListing { host, shares: Vec::new(), error: Some(error) },
    })
  })
  .await
}

#[tauri::command]
pub async fn net_check_smb(app: AppHandle, host: String) -> AppResult<SmbCheck> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let host = validate::host(&host)?;
    let started_at = auth::now();
    let mut result = sharing::check_smb(&host);
    result.run_id = record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "file_sharing",
        title: &format!(r"File sharing check: \\{host}"),
        status: if result.healthy { "success" } else { "failed" },
        summary: &result.summary,
        started_at,
        finished_at: auth::now(),
        logs: &diagnostics::step_logs(&result.steps),
      },
    );
    Ok(result)
  })
  .await
}

#[tauri::command]
pub async fn net_test_share_access(app: AppHandle, path: String) -> AppResult<AccessResult> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let path = validate::unc_path(&path)?;
    let started_at = auth::now();
    let result = sharing::test_access(&path);
    let (level, message) = match &result.error {
      None => (Level::Info, format!("Opened {} ({} items).", result.path, result.entries.unwrap_or_default())),
      Some(e) => (Level::Error, format!("{}: {} {}", e.title, e.explanation, e.hint)),
    };
    record_network_run(
      state,
      report::NewRun {
        user_id: user.id,
        operation_type: "file_sharing",
        title: &format!("Share access test: {}", result.path),
        status: if result.ok { "success" } else { "failed" },
        summary: &message,
        started_at,
        finished_at: auth::now(),
        logs: &[LogLine::new(level, message.clone())],
      },
    );
    Ok(result)
  })
  .await
}

#[tauri::command]
pub fn net_open_share(state: State<'_, AppState>, path: String) -> AppResult<()> {
  state.session.require_active()?;
  sharing::open_in_explorer(&validate::unc_path(&path)?)
}

#[tauri::command]
pub async fn net_pick_folder(app: AppHandle) -> AppResult<Option<String>> {
  let handle = app.clone();
  run_blocking(app, move |state| {
    use tauri_plugin_dialog::DialogExt;
    state.session.require_active()?;
    let picked = handle.dialog().file().set_title("Choose a folder to share").blocking_pick_folder();
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
  })
  .await
}

fn record_share_change(state: &AppState, user_id: i64, title: &str, change: &mut ShareChange) {
  let now = auth::now();
  let level = match change.status {
    RepairStatus::Success => Level::Info,
    RepairStatus::Failed => Level::Error,
    _ => Level::Warning,
  };
  change.run_id = record_network_run(
    state,
    report::NewRun {
      user_id,
      operation_type: "file_sharing",
      title,
      status: repair_status_for_history(change.status),
      summary: &change.message,
      started_at: now,
      finished_at: now,
      logs: &[LogLine::new(level, change.message.clone())],
    },
  );
}

#[tauri::command]
pub async fn net_create_share(app: AppHandle, name: String, path: String, access: ShareAccess) -> AppResult<ShareChange> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let name = validate::share_name(&name)?;
    let folder = validate::local_folder(&path)?;
    let mut change = sharing::create_share(&name, &folder, access)?;
    record_share_change(state, user.id, &format!("Share folder: {name}"), &mut change);
    Ok(change)
  })
  .await
}

#[tauri::command]
pub async fn net_remove_share(app: AppHandle, name: String) -> AppResult<ShareChange> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let name = validate::share_name(&name)?;
    let mut change = sharing::remove_share(&name)?;
    record_share_change(state, user.id, &format!("Stop sharing: {name}"), &mut change);
    Ok(change)
  })
  .await
}

/// Reveals the connected Wi-Fi network's saved password (after UAC approval).
/// History records that it was viewed, never the password itself.
#[tauri::command]
pub async fn net_wifi_password(app: AppHandle, adapter_id: String) -> AppResult<Option<WifiPassword>> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let result = wifi::connected_password(&adapter_id)?;
    if let Some(wifi) = &result {
      let now = auth::now();
      let message = format!("Viewed the saved password for Wi-Fi network \"{}\".", wifi.ssid);
      record_network_run(
        state,
        report::NewRun {
          user_id: user.id,
          operation_type: "wifi_password",
          title: &format!("Wi-Fi password viewed: {}", wifi.ssid),
          status: "success",
          summary: &message,
          started_at: now,
          finished_at: now,
          logs: &[LogLine::new(Level::Info, message.clone())],
        },
      );
    }
    Ok(result)
  })
  .await
}

#[tauri::command]
pub fn net_history(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<ActivityItem>> {
  state.session.require_active()?;
  report::history(&state.db(), report::OPERATION_TYPES, limit.unwrap_or(50).clamp(1, 200))
}

#[tauri::command]
pub fn net_report(state: State<'_, AppState>, run_id: i64) -> AppResult<ReportDetail> {
  state.session.require_active()?;
  report::detail(&state.db(), report::OPERATION_TYPES, run_id)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
  Txt,
  Pdf,
}

/// Saves a report where the user chooses. Returns the saved path, or `None`
/// if the save dialog was cancelled.
#[tauri::command]
pub async fn net_export_report(
  app: AppHandle,
  run_id: i64,
  format: ExportFormat,
  utc_offset_minutes: i32,
) -> AppResult<Option<String>> {
  let handle = app.clone();
  run_blocking(app, move |state| {
    use tauri_plugin_dialog::DialogExt;
    state.session.require_active()?;
    let detail = report::detail(&state.db(), report::OPERATION_TYPES, run_id)?;
    let offset = utc_offset_minutes.clamp(-14 * 60, 14 * 60);
    let text = report::render_text(&detail, "Network Center", network::computer_name().as_deref(), offset);
    let (extension, filter, bytes) = match format {
      ExportFormat::Txt => ("txt", "Text file", text.into_bytes()),
      ExportFormat::Pdf => ("pdf", "PDF document", report::render_pdf(&text)),
    };
    let Some(picked) = handle
      .dialog()
      .file()
      .set_title("Save network report")
      .set_file_name(format!("VocaTechX-network-report-{run_id}.{extension}"))
      .add_filter(filter, &[extension])
      .blocking_save_file()
    else {
      return Ok(None);
    };
    let mut path = picked
      .into_path()
      .map_err(|_| AppError::validation("That location is not supported. Choose a folder on this computer."))?;
    if path.extension().is_none() {
      path.set_extension(extension);
    }
    std::fs::write(&path, bytes).map_err(|e| AppError::Network(format!("Could not save the report: {e}")))?;
    Ok(Some(path.to_string_lossy().into_owned()))
  })
  .await
}

// ---------------------------------------------------------------------------
// Printer & Devices

#[tauri::command]
pub async fn dev_printers(app: AppHandle) -> AppResult<Vec<PrinterInfo>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    printers::list().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub async fn dev_spooler_status(app: AppHandle) -> AppResult<SpoolerStatus> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    spooler::status().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub async fn dev_print_jobs(app: AppHandle) -> AppResult<Vec<PrintJob>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    jobs::list().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub async fn dev_devices(app: AppHandle) -> AppResult<Vec<DeviceInfo>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    hardware::list().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub async fn dev_drivers(app: AppHandle) -> AppResult<Vec<DriverInfo>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    hardware::drivers().map_err(AppError::Network)
  })
  .await
}

#[tauri::command]
pub fn dev_open_printer_settings(state: State<'_, AppState>) -> AppResult<()> {
  state.session.require_active()?;
  printers::open_settings()
}

#[tauri::command]
pub async fn dev_open_printer_window(app: AppHandle, name: String, window: PrinterWindow) -> AppResult<()> {
  run_blocking(app, move |state| {
    state.session.require_active()?;
    printers::open_window(&name, window)
  })
  .await
}

#[tauri::command]
pub fn dev_open_device_manager(state: State<'_, AppState>) -> AppResult<()> {
  state.session.require_active()?;
  hardware::open_device_manager()
}

#[tauri::command]
pub fn dev_open_device_properties(state: State<'_, AppState>, instance_id: String) -> AppResult<()> {
  state.session.require_active()?;
  hardware::open_device_properties(&instance_id)
}

#[tauri::command]
pub fn dev_history(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<ActivityItem>> {
  state.session.require_active()?;
  report::history(&state.db(), report::DEVICE_OPERATION_TYPES, limit.unwrap_or(50).clamp(1, 200))
}

#[tauri::command]
pub fn dev_report(state: State<'_, AppState>, run_id: i64) -> AppResult<ReportDetail> {
  state.session.require_active()?;
  report::detail(&state.db(), report::DEVICE_OPERATION_TYPES, run_id)
}

/// Saves a Printer & Devices report where the user chooses. Returns the saved
/// path, or `None` if the save dialog was cancelled.
#[tauri::command]
pub async fn dev_export_report(
  app: AppHandle,
  run_id: i64,
  format: ExportFormat,
  utc_offset_minutes: i32,
) -> AppResult<Option<String>> {
  let handle = app.clone();
  run_blocking(app, move |state| {
    use tauri_plugin_dialog::DialogExt;
    state.session.require_active()?;
    let detail = report::detail(&state.db(), report::DEVICE_OPERATION_TYPES, run_id)?;
    let offset = utc_offset_minutes.clamp(-14 * 60, 14 * 60);
    let text = report::render_text(&detail, "Printer & Devices", network::computer_name().as_deref(), offset);
    let (extension, filter, bytes) = match format {
      ExportFormat::Txt => ("txt", "Text file", text.into_bytes()),
      ExportFormat::Pdf => ("pdf", "PDF document", report::render_pdf(&text)),
    };
    let Some(picked) = handle
      .dialog()
      .file()
      .set_title("Save printer & devices report")
      .set_file_name(format!("VocaTechX-devices-report-{run_id}.{extension}"))
      .add_filter(filter, &[extension])
      .blocking_save_file()
    else {
      return Ok(None);
    };
    let mut path = picked
      .into_path()
      .map_err(|_| AppError::validation("That location is not supported. Choose a folder on this computer."))?;
    if path.extension().is_none() {
      path.set_extension(extension);
    }
    std::fs::write(&path, bytes).map_err(|e| AppError::Network(format!("Could not save the report: {e}")))?;
    Ok(Some(path.to_string_lossy().into_owned()))
  })
  .await
}

// ---------------------------------------------------------------------------
// Software Center

/// The `application` folder's contents, cheap enough to poll so installers
/// pasted into the folder appear on their own.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareLibrary {
  pub folder: String,
  pub folder_exists: bool,
  pub elevated: bool,
  pub installing: bool,
  pub categories: &'static [&'static str],
  pub apps: Vec<SoftwareApp>,
  pub pending: Vec<PendingInstaller>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareApp {
  pub id: String,
  pub name: String,
  pub category: String,
  pub description: String,
  pub installer: Option<String>,
  pub installer_type: Option<InstallerType>,
  pub version: Option<String>,
  pub publisher: Option<String>,
  pub size_bytes: Option<u64>,
  pub problem: Option<String>,
  /// Set when the installer can be set up (again) from the setup dialog.
  pub source: Option<String>,
  /// The rest of app.json, so the edit dialog can start from it.
  pub detect: Option<String>,
  pub args: Vec<String>,
  /// Changes when the app's icon does; `None` if it has none (yet).
  pub icon_version: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareStatus {
  pub id: String,
  pub state: InstallState,
  pub installed_version: Option<String>,
}

#[tauri::command]
pub async fn sw_library(app: AppHandle) -> AppResult<SoftwareLibrary> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    let center = &state.software;
    let scan = software::library::scan(center.folder());
    let apps = scan
      .apps
      .into_iter()
      .map(|a| {
        let config = a.config;
        SoftwareApp {
          name: config.as_ref().map_or_else(|| a.id.clone(), |c| c.name.clone()),
          category: config.as_ref().map_or_else(|| "Other".into(), |c| c.category.clone()),
          description: config.as_ref().map(|c| c.description.clone()).unwrap_or_default(),
          installer: config.as_ref().map(|c| c.installer.clone()),
          installer_type: config.as_ref().map(|c| c.installer_type),
          version: config.as_ref().and_then(|c| c.version.clone()),
          publisher: config.as_ref().and_then(|c| c.publisher.clone()),
          size_bytes: config.as_ref().map(|c| c.size_bytes),
          detect: config.as_ref().map(|c| c.detect.clone()),
          args: config.as_ref().map(|c| c.args.clone()).unwrap_or_default(),
          icon_version: software::icon::version(&a.dir),
          problem: a.problem,
          source: a.source,
          id: a.id,
        }
      })
      .collect();
    Ok(SoftwareLibrary {
      folder: center.folder().to_string_lossy().into_owned(),
      folder_exists: center.folder().is_dir(),
      elevated: network::sys::is_elevated(),
      installing: center.is_installing(),
      categories: software::library::CATEGORIES,
      apps,
      pending: scan.pending,
    })
  })
  .await
}

/// Whether each set-up app is installed, and how its version compares.
#[tauri::command]
pub async fn sw_status(app: AppHandle) -> AppResult<Vec<SoftwareStatus>> {
  run_blocking(app, |state| {
    state.session.require_active()?;
    let programs = software::detect::installed_programs().map_err(AppError::Software)?;
    let scan = software::library::scan(state.software.folder());
    let statuses = scan
      .apps
      .iter()
      .filter_map(|a| {
        let config = a.config.as_ref()?;
        let installed = software::detect::find(&programs, &config.detect);
        Some(SoftwareStatus {
          id: a.id.clone(),
          state: software::detect::state(installed, config.version.as_deref()),
          installed_version: installed.and_then(|p| p.version.clone()),
        })
      })
      .collect();
    // Apps set up before icons existed, or copied in with app.json, get one
    // now. This only does work the first time; the folder poll picks it up.
    software::icon::fill_missing(&scan.apps, &programs);
    Ok(statuses)
  })
  .await
}

/// An app's icon as a `data:` URL, or `None` if it has none.
#[tauri::command]
pub async fn sw_icon(app: AppHandle, id: String) -> AppResult<Option<String>> {
  run_blocking(app, move |state| {
    state.session.require_active()?;
    let scan = software::library::scan(state.software.folder());
    Ok(scan.apps.iter().find(|a| a.id == id).and_then(|a| software::icon::data_url(&a.dir)))
  })
  .await
}

/// Extracts the icons of these apps again, best effort.
fn refresh_icons(folder: &std::path::Path, ids: &[&str]) {
  let scan = software::library::scan(folder);
  let apps: Vec<_> = scan.apps.iter().filter(|a| ids.contains(&a.id.as_str())).collect();
  if !apps.is_empty() {
    software::icon::refresh(&apps, &software::detect::installed_programs().unwrap_or_default());
  }
}

#[tauri::command]
pub async fn sw_inspect(app: AppHandle, source: String) -> AppResult<InstallerDetails> {
  run_blocking(app, move |state| {
    state.session.require_active()?;
    let path = software::library::source_path(state.software.folder(), &source)
      .ok_or_else(|| AppError::validation("That installer is no longer in the application folder. Refresh the list."))?;
    software::inspect::details(&source, &path).map_err(AppError::Software)
  })
  .await
}

#[tauri::command]
pub async fn sw_save_app(app: AppHandle, setup: AppSetup) -> AppResult<String> {
  run_blocking(app, move |state| {
    state.session.require_active()?;
    if state.software.is_installing() {
      return Err(AppError::validation("Wait for the installation to finish before setting up apps."));
    }
    let folder = state.software.folder();
    let path = software::library::source_path(folder, &setup.source)
      .ok_or_else(|| AppError::validation("That installer is no longer in the application folder. Refresh the list."))?;
    // A file altered after it was signed is never trusted.
    if software::inspect::details(&setup.source, &path).map_err(AppError::Software)?.signature == Signature::Tampered {
      return Err(AppError::validation(
        "This installer's signature is broken: it was changed after its publisher signed it. Download it again from the publisher.",
      ));
    }
    let (dir, config) = software::library::save(folder, &setup, software::inspect::version_and_publisher).map_err(AppError::validation)?;
    if let Some(id) = dir.file_name().and_then(|n| n.to_str()) {
      refresh_icons(folder, &[id]);
    }
    Ok(config.name)
  })
  .await
}

#[tauri::command]
pub fn sw_open_folder(state: State<'_, AppState>) -> AppResult<()> {
  state.session.require_active()?;
  software::open_folder(&state.software).map_err(AppError::Software)
}

/// Installs the selected apps one at a time, streaming progress, and records
/// the batch in the history.
#[tauri::command]
pub async fn sw_install(app: AppHandle, ids: Vec<String>, on_event: Channel<InstallEvent>) -> AppResult<Vec<ItemResult>> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let results = software::install::run_batch(&state.software, &ids, &|event| {
      let _ = on_event.send(event);
    })?;
    record_batch(state, user.id, started_at, &results, false);
    // A fresh install exposes the program's own icon, which is usually better
    // than the installer's (often a generic "setup" icon).
    let installed: Vec<&str> = results
      .iter()
      .filter(|r| matches!(r.status, software::install::ItemStatus::Installed | software::install::ItemStatus::Updated))
      .map(|r| r.id.as_str())
      .collect();
    refresh_icons(state.software.folder(), &installed);
    Ok(results)
  })
  .await
}

/// Uninstalls the selected apps one at a time, streaming progress, and records
/// the batch in the history.
#[tauri::command]
pub async fn sw_uninstall(app: AppHandle, ids: Vec<String>, on_event: Channel<InstallEvent>) -> AppResult<Vec<ItemResult>> {
  run_blocking(app, move |state| {
    let user = state.session.require_active()?;
    let started_at = auth::now();
    let results = software::uninstall::run_batch(&state.software, &ids, &|event| {
      let _ = on_event.send(event);
    })?;
    record_batch(state, user.id, started_at, &results, true);
    Ok(results)
  })
  .await
}

fn record_batch(state: &AppState, user_id: i64, started_at: i64, results: &[ItemResult], uninstall: bool) {
  use software::install::ItemStatus as S;
  let count = |statuses: &[S]| results.iter().filter(|r| statuses.contains(&r.status)).count();
  let done = count(&[S::Installed, S::Updated, S::Uninstalled]);
  let problems = count(&[S::Failed, S::Unverified, S::StillRunning]);
  let cancelled = count(&[S::Cancelled]);
  let skipped = count(&[S::Skipped]);
  let (verb, done_label, operation_type) =
    if uninstall { ("Uninstall", "uninstalled", "software_uninstall") } else { ("Install", "installed", "software_install") };

  let mut parts = vec![format!("{done} {done_label}")];
  for (n, label) in [(skipped, "skipped"), (problems, "with problems"), (cancelled, "cancelled")] {
    if n > 0 {
      parts.push(format!("{n} {label}"));
    }
  }
  if results.iter().any(|r| r.reboot_required) {
    parts.push("restart required".into());
  }
  let logs: Vec<LogLine> = results
    .iter()
    .map(|r| {
      let level = match r.status {
        S::Installed | S::Updated | S::Uninstalled | S::Skipped => Level::Info,
        S::Cancelled | S::Unverified | S::StillRunning => Level::Warning,
        S::Failed => Level::Error,
      };
      let code = r.exit_code.map(|c| format!(" (exit code {c})")).unwrap_or_default();
      LogLine::new(level, format!("{}: {}{code}", r.name, r.message))
    })
    .collect();
  let title = if results.len() == 1 { format!("{verb} {}", results[0].name) } else { format!("{verb} {} apps", results.len()) };
  let status = if problems > 0 { "failed" } else if cancelled > 0 { "cancelled" } else { "success" };
  if let Err(e) = report::record(
    &state.db(),
    report::NewRun {
      user_id,
      operation_type,
      title: &title,
      status,
      summary: &parts.join(", "),
      started_at,
      finished_at: auth::now(),
      logs: &logs,
    },
  ) {
    log::warn!("could not record the software {done_label} batch: {e:?}");
  }
}

#[tauri::command]
pub fn sw_cancel_install(state: State<'_, AppState>) -> AppResult<()> {
  state.session.require_active()?;
  state.software.request_cancel();
  Ok(())
}

#[tauri::command]
pub fn sw_history(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<ActivityItem>> {
  state.session.require_active()?;
  report::history(&state.db(), report::SOFTWARE_OPERATION_TYPES, limit.unwrap_or(20).clamp(1, 200))
}

// ---------------------------------------------------------------------------
// CSS Learning Library

#[tauri::command]
pub fn learn_state(state: State<'_, AppState>) -> AppResult<learning::LearningState> {
  let user = state.session.require_active()?;
  learning::state(&state.db(), user.id)
}

#[tauri::command]
pub fn learn_update_progress(
  state: State<'_, AppState>,
  lesson_id: String,
  lesson_version: i64,
  last_step: i64,
  completed: bool,
) -> AppResult<()> {
  let user = state.session.require_active()?;
  learning::update_progress(&state.db(), user.id, &lesson_id, lesson_version, last_step, completed, auth::now())
}

#[tauri::command]
pub fn learn_set_bookmark(state: State<'_, AppState>, lesson_id: String, bookmarked: bool) -> AppResult<()> {
  let user = state.session.require_active()?;
  learning::set_bookmark(&state.db(), user.id, &lesson_id, bookmarked)
}

#[tauri::command]
pub fn learn_record_quiz(state: State<'_, AppState>, quiz_id: String, score: i64, max_score: i64, passed: bool) -> AppResult<()> {
  let user = state.session.require_active()?;
  learning::record_quiz(&state.db(), user.id, &quiz_id, score, max_score, passed)
}

#[tauri::command]
pub fn learn_record_lab(state: State<'_, AppState>, lab_id: String, mistakes: i64, hints: i64, duration_s: i64) -> AppResult<()> {
  let user = state.session.require_active()?;
  learning::record_lab(&state.db(), user.id, &lab_id, mistakes, hints, duration_s)
}
