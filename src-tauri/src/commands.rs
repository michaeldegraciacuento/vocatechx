//! The only backend entry points the frontend can call. Each one is listed in
//! `build.rs` and granted in `capabilities/default.json`.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::activity::{self, ActivityItem};
use crate::conversations::{self, ChatMessage, ConversationSummary};
use crate::error::{AppError, AppResult};
use crate::ralp::{self, ImportProgress, RalpStatus};
use crate::session::SessionUser;
use crate::system_info::SystemOverview;
use crate::{auth, db, AppState};

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
