//! Ralp, the AI Troubleshooter. Runs the bundled llama.cpp server
//! (`llama-server.exe`) as a background process bound to 127.0.0.1 with a
//! random port and access key, and talks to it over its OpenAI-compatible API.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::{OsRng, RngCore};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::conversations::ChatMessage;
use crate::error::{AppError, AppResult};

pub const MODEL_FILE: &str = "qwen2.5-3b-instruct-q4_k_m.gguf";
const SERVER_EXE: &str = "llama-server.exe";
const CONTEXT_TOKENS: u32 = 8192;
const MAX_REPLY_TOKENS: u32 = 1024;
/// Roughly 3,000–4,000 tokens of history, leaving room for the system prompt and reply.
pub const HISTORY_CHAR_BUDGET: usize = 12_000;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);
const REPLY_READ_TIMEOUT: Duration = Duration::from_secs(300);

const SYSTEM_PROMPT: &str = "You are Ralp, the AI troubleshooting assistant built into VocaTechX, a toolkit for \
computer systems servicing (CSS) technicians and students. You help diagnose and fix problems with desktop and \
laptop PCs, Windows 10 and 11, hardware components, peripherals, printers, and networks.

Guidelines:
- Start with the most likely and least invasive causes. Give clear, numbered, step-by-step checks.
- If key details are missing (symptoms, Windows version, exact error message or code, recent changes), ask a short clarifying question first.
- Before any step that can cause data loss or damage (formatting, partitioning, BIOS or firmware updates, registry edits, opening a power supply), warn clearly and recommend a backup.
- Prefer built-in Windows tools such as Device Manager, Event Viewer, Task Manager, Command Prompt, sfc, DISM, chkdsk, ipconfig, and ping.
- You cannot see or control this computer and cannot run commands. Never claim you did. Tell the user what to run and what to look for in the result.
- If you are not sure, say so. Do not invent error codes, part numbers, or facts. BIOS beep codes differ by manufacturer (AMI, Award, Phoenix, Dell, HP), so ask which one before interpreting them.
- Reply in the language the user writes in (English, Filipino, or Taglish).
- Keep answers concise and practical. Use Markdown lists and **bold** for key actions.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RalpState {
  /// `llama-server.exe` is not where VocaTechX expects it (a broken install).
  RuntimeMissing,
  /// No `.gguf` model file was found.
  ModelMissing,
  /// Ready to start; nothing running.
  Stopped,
  Starting,
  Ready,
  Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RalpStatus {
  pub state: RalpState,
  pub message: Option<String>,
  pub model_name: Option<String>,
  /// Folder next to the installed app where a model file can be placed.
  pub model_folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
  pub copied_bytes: u64,
  pub total_bytes: u64,
}

/// Where VocaTechX looks for the engine and the model, in priority order.
pub struct Locations {
  runtime_dirs: Vec<PathBuf>,
  model_dirs: Vec<PathBuf>,
  /// Models chosen with "Import model file…" are copied here.
  import_dir: PathBuf,
  /// Folder beside the installed VocaTechX.exe, shown to the user.
  app_model_dir: PathBuf,
  log_file: PathBuf,
}

impl Locations {
  pub fn resolve(app: &AppHandle) -> tauri::Result<Self> {
    let data_dir = app.path().app_data_dir()?;
    let import_dir = data_dir.join("ai").join("models");
    let exe_dir = std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(Path::to_path_buf))
      .unwrap_or_default();
    let app_model_dir = exe_dir.join("ai").join("models");

    let mut runtime_dirs = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
      runtime_dirs.push(resources.join("ai").join("runtime"));
    }
    runtime_dirs.push(exe_dir.join("ai").join("runtime"));
    let mut model_dirs = vec![import_dir.clone(), app_model_dir.clone()];

    // During development, use the project's ai/ folder directly.
    #[cfg(debug_assertions)]
    {
      let project_ai = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("ai");
      runtime_dirs.push(project_ai.join("runtime"));
      model_dirs.push(project_ai.join("models"));
    }

    Ok(Self {
      runtime_dirs,
      model_dirs,
      import_dir,
      app_model_dir,
      log_file: data_dir.join("logs").join("ralp-engine.log"),
    })
  }

  fn find_runtime(&self) -> Option<PathBuf> {
    self.runtime_dirs.iter().map(|dir| dir.join(SERVER_EXE)).find(|exe| exe.is_file())
  }

  /// The expected model file if present, otherwise any `.gguf` file.
  fn find_model(&self) -> Option<PathBuf> {
    for dir in &self.model_dirs {
      let preferred = dir.join(MODEL_FILE);
      if preferred.is_file() {
        return Some(preferred);
      }
      let mut others: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && has_gguf_extension(path))
        .collect();
      others.sort();
      if let Some(model) = others.into_iter().next() {
        return Some(model);
      }
    }
    None
  }
}

fn has_gguf_extension(path: &Path) -> bool {
  path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
}

fn file_name(path: &Path) -> String {
  path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

struct Server {
  state: RalpState,
  error: Option<String>,
  child: Option<Child>,
  port: u16,
  api_key: String,
  model: Option<PathBuf>,
}

pub struct Ralp {
  locations: Locations,
  server: Mutex<Server>,
  generating: AtomicBool,
  cancel_requested: AtomicBool,
  /// Kills the engine with VocaTechX, even if VocaTechX crashes.
  #[cfg(windows)]
  job: Option<job::KillOnCloseJob>,
}

impl Ralp {
  pub fn new(locations: Locations) -> Self {
    Self {
      locations,
      server: Mutex::new(Server {
        state: RalpState::Stopped,
        error: None,
        child: None,
        port: 0,
        api_key: String::new(),
        model: None,
      }),
      generating: AtomicBool::new(false),
      cancel_requested: AtomicBool::new(false),
      #[cfg(windows)]
      job: job::KillOnCloseJob::new(),
    }
  }

  fn lock(&self) -> MutexGuard<'_, Server> {
    self.server.lock().unwrap_or_else(|e| e.into_inner())
  }

  pub fn status(&self) -> RalpStatus {
    let mut server = self.lock();
    self.detect_exit(&mut server);

    let (state, message, model) = match server.state {
      RalpState::Starting | RalpState::Ready | RalpState::Error => {
        (server.state, server.error.clone(), server.model.clone())
      }
      _ => match (self.locations.find_runtime(), self.locations.find_model()) {
        (None, _) => (
          RalpState::RuntimeMissing,
          Some("Ralp's AI engine is missing from this installation. Reinstall VocaTechX to restore it.".into()),
          None,
        ),
        (Some(_), None) => (RalpState::ModelMissing, None, None),
        (Some(_), Some(model)) => (RalpState::Stopped, None, Some(model)),
      },
    };

    RalpStatus {
      state,
      message,
      model_name: model.as_deref().map(file_name),
      model_folder: self.locations.app_model_dir.display().to_string(),
    }
  }

  fn detect_exit(&self, server: &mut Server) {
    let Some(child) = server.child.as_mut() else { return };
    if let Ok(Some(exit)) = child.try_wait() {
      server.child = None;
      server.state = RalpState::Error;
      server.error = Some(format!(
        "Ralp's AI engine stopped unexpectedly ({exit}). Details are in {}.",
        self.locations.log_file.display()
      ));
      log::error!("llama-server exited: {exit}");
    }
  }

  /// Starts the engine if needed and waits until the model is loaded.
  pub fn start(&self) -> AppResult<RalpStatus> {
    let (port, api_key) = {
      let mut server = self.lock();
      self.detect_exit(&mut server);
      match server.state {
        RalpState::Ready | RalpState::Starting => return Ok(self.status_locked(&server)),
        _ => {}
      }

      let runtime = self.locations.find_runtime().ok_or_else(|| {
        AppError::Ai("Ralp's AI engine is missing from this installation. Reinstall VocaTechX to restore it.".into())
      })?;
      let model = self
        .locations
        .find_model()
        .ok_or_else(|| AppError::Ai("No model file found. Import Ralp's model file to continue.".into()))?;

      let (child, port, api_key) = self.spawn(&runtime, &model)?;
      server.child = Some(child);
      server.port = port;
      server.api_key = api_key.clone();
      server.model = Some(model);
      server.state = RalpState::Starting;
      server.error = None;
      (port, api_key)
    };

    let result = self.wait_until_ready(port, &api_key);
    let mut server = self.lock();
    match result {
      Ok(()) => {
        server.state = RalpState::Ready;
        log::info!("Ralp is ready on 127.0.0.1:{port}");
      }
      Err(message) => {
        if let Some(mut child) = server.child.take() {
          let _ = child.kill();
          let _ = child.wait();
        }
        server.state = RalpState::Error;
        server.error = Some(message);
      }
    }
    Ok(self.status_locked(&server))
  }

  fn status_locked(&self, server: &Server) -> RalpStatus {
    RalpStatus {
      state: server.state,
      message: server.error.clone(),
      model_name: server.model.as_deref().map(file_name),
      model_folder: self.locations.app_model_dir.display().to_string(),
    }
  }

  fn spawn(&self, runtime: &Path, model: &Path) -> AppResult<(Child, u16, String)> {
    let port = TcpListener::bind("127.0.0.1:0")
      .and_then(|listener| listener.local_addr())
      .map(|addr| addr.port())
      .map_err(|e| AppError::Internal(format!("no free local port: {e}")))?;

    let mut key_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut key_bytes);
    let api_key: String = key_bytes.iter().map(|b| format!("{b:02x}")).collect();

    if let Some(dir) = self.locations.log_file.parent() {
      fs::create_dir_all(dir).map_err(|e| AppError::Internal(format!("create log dir: {e}")))?;
    }
    let log = File::create(&self.locations.log_file).map_err(|e| AppError::Internal(format!("create engine log: {e}")))?;
    let log_err = log.try_clone().map_err(|e| AppError::Internal(format!("clone engine log: {e}")))?;

    let threads = sysinfo::System::new().physical_core_count().unwrap_or(4).max(1);
    let mut command = Command::new(runtime);
    command
      .arg("--model")
      .arg(model)
      .args(["--host", "127.0.0.1", "--port", &port.to_string()])
      .args(["--ctx-size", &CONTEXT_TOKENS.to_string(), "--parallel", "1"])
      .args(["--threads", &threads.to_string()])
      .args(["--no-webui", "--offline"])
      // Passed by environment so it does not appear in process listings.
      .env("LLAMA_API_KEY", &api_key)
      .stdin(Stdio::null())
      .stdout(log)
      .stderr(log_err);
    if let Some(dir) = runtime.parent() {
      command.current_dir(dir);
    }
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x0800_0000;
      command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
      .spawn()
      .map_err(|e| AppError::Ai(format!("Could not start Ralp's AI engine: {e}")))?;
    #[cfg(windows)]
    if let Some(job) = &self.job {
      job.assign(&child);
    }
    log::info!("started llama-server (pid {}) with model {}", child.id(), model.display());
    Ok((child, port, api_key))
  }

  fn wait_until_ready(&self, port: u16, api_key: &str) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
      .timeout_connect(Duration::from_secs(2))
      .timeout_read(Duration::from_secs(5))
      .build();
    let url = format!("http://127.0.0.1:{port}/health");
    let deadline = Instant::now() + STARTUP_TIMEOUT;

    while Instant::now() < deadline {
      {
        let mut server = self.lock();
        self.detect_exit(&mut server);
        if server.state != RalpState::Starting {
          return Err(server.error.clone().unwrap_or_else(|| "Ralp's AI engine stopped while loading.".into()));
        }
      }
      if let Ok(response) = agent.get(&url).set("Authorization", &format!("Bearer {api_key}")).call() {
        if response.status() == 200 {
          return Ok(());
        }
      }
      std::thread::sleep(Duration::from_millis(500));
    }
    Err("Ralp took too long to load the model. Close other programs to free memory and try again.".into())
  }

  /// Fails with a user-facing message unless the engine is running.
  pub fn ensure_ready(&self) -> AppResult<()> {
    let mut server = self.lock();
    self.detect_exit(&mut server);
    if server.state == RalpState::Ready {
      Ok(())
    } else {
      Err(AppError::Ai("Ralp is not running yet. Start Ralp and try again.".into()))
    }
  }

  pub fn request_cancel(&self) {
    self.cancel_requested.store(true, Ordering::SeqCst);
  }

  /// Streams Ralp's reply to `history`, calling `on_text` for each piece.
  /// Returns the full reply and whether it was stopped early.
  pub fn chat(&self, history: &[ChatMessage], mut on_text: impl FnMut(&str) -> bool) -> AppResult<(String, bool)> {
    let (port, api_key) = {
      let mut server = self.lock();
      self.detect_exit(&mut server);
      if server.state != RalpState::Ready {
        return Err(AppError::Ai("Ralp is not running. Start Ralp and try again.".into()));
      }
      (server.port, server.api_key.clone())
    };

    if self.generating.swap(true, Ordering::SeqCst) {
      return Err(AppError::Ai("Ralp is still answering. Wait for the reply or press Stop.".into()));
    }
    struct Busy<'a>(&'a AtomicBool);
    impl Drop for Busy<'_> {
      fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
      }
    }
    let _busy = Busy(&self.generating);
    self.cancel_requested.store(false, Ordering::SeqCst);

    let mut messages = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    messages.extend(history.iter().map(|m| json!({ "role": m.role, "content": m.content })));
    let body = json!({
      "messages": messages,
      "stream": true,
      "max_tokens": MAX_REPLY_TOKENS,
      "temperature": 0.4,
      "top_p": 0.9,
      "cache_prompt": true,
    });

    let agent = ureq::AgentBuilder::new()
      .timeout_connect(Duration::from_secs(2))
      .timeout_read(REPLY_READ_TIMEOUT)
      .build();
    let response = agent
      .post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
      .set("Authorization", &format!("Bearer {api_key}"))
      .set("Content-Type", "application/json")
      .send_string(&body.to_string())
      .map_err(|e| {
        log::error!("chat request failed: {e}");
        AppError::Ai("Ralp could not process that message. Please try again.".into())
      })?;

    let mut reply = String::new();
    let mut cancelled = false;
    for line in BufReader::new(response.into_reader()).lines() {
      if self.cancel_requested.load(Ordering::SeqCst) {
        cancelled = true;
        break;
      }
      let line = line.map_err(|e| {
        log::error!("reading reply failed: {e}");
        AppError::Ai("Ralp stopped responding. Please try again.".into())
      })?;
      let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
      if data == "[DONE]" {
        break;
      }
      let event: Value = serde_json::from_str(data).map_err(|e| AppError::Internal(format!("bad stream event: {e}")))?;
      if let Some(error) = event.get("error") {
        log::error!("llama-server error: {error}");
        return Err(AppError::Ai("Ralp ran into a problem while answering. Please try again.".into()));
      }
      if let Some(text) = event["choices"][0]["delta"]["content"].as_str().filter(|t| !t.is_empty()) {
        reply.push_str(text);
        if !on_text(text) {
          cancelled = true;
          break;
        }
      }
    }
    // Dropping the response closes the connection, which stops generation early.
    Ok((reply, cancelled))
  }

  /// Lets the user pick a `.gguf` file and copies it into VocaTechX's data
  /// folder. Returns `None` if the picker was cancelled.
  pub fn import_model(&self, app: &AppHandle, mut on_progress: impl FnMut(ImportProgress)) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let Some(picked) = app
      .dialog()
      .file()
      .set_title("Select Ralp's model file (.gguf)")
      .add_filter("GGUF model", &["gguf"])
      .blocking_pick_file()
    else {
      return Ok(None);
    };
    let source = picked
      .into_path()
      .map_err(|_| AppError::validation("That file location is not supported. Choose a file on this computer."))?;

    let invalid = || AppError::validation("That file is not a GGUF model. Choose a file ending in .gguf.");
    if !has_gguf_extension(&source) {
      return Err(invalid());
    }
    let mut input = File::open(&source).map_err(|e| AppError::validation(format!("Could not open that file: {e}")))?;
    let mut magic = [0u8; 4];
    if input.read_exact(&mut magic).is_err() || &magic != b"GGUF" {
      return Err(invalid());
    }
    let total_bytes = input.metadata().map(|m| m.len()).unwrap_or(0);

    let name = file_name(&source);
    let destination = self.locations.import_dir.join(&name);
    if fs::canonicalize(&source).ok() == fs::canonicalize(&destination).ok() {
      return Ok(Some(name));
    }
    fs::create_dir_all(&self.locations.import_dir).map_err(|e| AppError::Internal(format!("create model dir: {e}")))?;

    let partial = destination.with_extension("gguf.part");
    let mut copy = || -> std::io::Result<()> {
      let mut output = File::create(&partial)?;
      output.write_all(&magic)?;
      let mut buffer = vec![0u8; 8 * 1024 * 1024];
      let mut copied = magic.len() as u64;
      loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
          break;
        }
        output.write_all(&buffer[..read])?;
        copied += read as u64;
        on_progress(ImportProgress { copied_bytes: copied, total_bytes });
      }
      output.sync_all()?;
      fs::rename(&partial, &destination)
    };
    if let Err(e) = copy() {
      let _ = fs::remove_file(&partial);
      log::error!("model import failed: {e}");
      return Err(AppError::Ai(format!(
        "Could not copy the model file. Make sure there is at least {} GB of free space and try again.",
        (total_bytes / 1_000_000_000).max(1) + 1
      )));
    }
    log::info!("imported model {name}");
    Ok(Some(name))
  }

  pub fn shutdown(&self) {
    let mut server = self.lock();
    if let Some(mut child) = server.child.take() {
      let _ = child.kill();
      let _ = child.wait();
      log::info!("stopped llama-server");
    }
    server.state = RalpState::Stopped;
  }
}

#[cfg(windows)]
mod job {
  use std::os::windows::io::AsRawHandle;
  use std::process::Child;

  use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
  use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };

  /// A Windows job object that terminates its processes when VocaTechX exits,
  /// so the engine never outlives the app.
  pub struct KillOnCloseJob(HANDLE);

  // The handle is only used through thread-safe Win32 calls.
  unsafe impl Send for KillOnCloseJob {}
  unsafe impl Sync for KillOnCloseJob {}

  impl KillOnCloseJob {
    pub fn new() -> Option<Self> {
      unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
          return None;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
          handle,
          JobObjectExtendedLimitInformation,
          &info as *const _ as *const _,
          std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
          CloseHandle(handle);
          return None;
        }
        Some(Self(handle))
      }
    }

    pub fn assign(&self, child: &Child) {
      let ok = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
      if ok == 0 {
        log::warn!("could not tie llama-server to VocaTechX's lifetime");
      }
    }
  }

  impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
      unsafe { CloseHandle(self.0) };
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn project_locations(log_dir: &Path) -> Locations {
    let ai = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("ai");
    Locations {
      runtime_dirs: vec![ai.join("runtime")],
      model_dirs: vec![ai.join("models")],
      import_dir: log_dir.join("imported"),
      app_model_dir: ai.join("models"),
      log_file: log_dir.join("ralp-engine.log"),
    }
  }

  fn message(role: &str, content: &str) -> ChatMessage {
    ChatMessage { id: 0, role: role.into(), content: content.into(), created_at: 0 }
  }

  #[test]
  fn missing_files_are_reported() {
    let dir = tempfile::tempdir().unwrap();
    let ralp = Ralp::new(Locations {
      runtime_dirs: vec![dir.path().into()],
      model_dirs: vec![dir.path().into()],
      import_dir: dir.path().into(),
      app_model_dir: dir.path().into(),
      log_file: dir.path().join("log.txt"),
    });
    assert_eq!(ralp.status().state, RalpState::RuntimeMissing);
    assert!(ralp.start().is_err());
    assert!(ralp.ensure_ready().is_err());
    assert!(ralp.chat(&[message("user", "hi")], |_| true).is_err());
  }

  /// Loads the real model (about 10–20 s). Run with:
  /// `cargo test ralp_end_to_end -- --ignored --nocapture`
  #[test]
  #[ignore]
  fn ralp_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let ralp = Ralp::new(project_locations(dir.path()));
    assert_eq!(ralp.status().state, RalpState::Stopped);

    let status = ralp.start().unwrap();
    assert_eq!(status.state, RalpState::Ready, "{:?}", status.message);

    let mut pieces = 0;
    let (reply, cancelled) = ralp
      .chat(&[message("user", "In one short sentence: what does ipconfig /flushdns do?")], |_| {
        pieces += 1;
        true
      })
      .unwrap();
    println!("Ralp ({pieces} pieces): {reply}");
    assert!(!cancelled);
    assert!(pieces > 1, "reply should stream in pieces");
    assert!(reply.to_lowercase().contains("dns"));

    // Stopping early ends the stream after the current piece.
    let (partial, cancelled) = ralp
      .chat(&[message("user", "List 20 common causes of a slow PC.")], |_| {
        ralp.request_cancel();
        true
      })
      .unwrap();
    assert!(cancelled);
    assert!(partial.len() < 200);

    ralp.shutdown();
    assert_eq!(ralp.status().state, RalpState::Stopped);
  }
}
