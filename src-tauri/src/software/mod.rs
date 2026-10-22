//! Software Center: installs the apps a technician has placed in the
//! `application` folder, silently and one at a time.
//!
//! Nothing is downloaded and no catalog is built in. Each app is a folder that
//! holds one installer plus an `app.json` VocaTechX writes when the technician
//! sets that installer up. `app.json` pins the installer's SHA-256, so a
//! replaced or damaged installer is refused before it ever runs.

pub mod detect;
pub mod icon;
pub mod inspect;
pub mod install;
pub mod library;
pub mod uninstall;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// The folder (beside VocaTechX.exe) that holds the technician's installers.
pub const FOLDER_NAME: &str = "application";

pub struct SoftwareCenter {
  folder: PathBuf,
  installing: AtomicBool,
  cancel_requested: AtomicBool,
}

impl SoftwareCenter {
  /// The `application` folder beside VocaTechX.exe, so it travels with the
  /// portable USB copy whatever drive letter it gets. During development the
  /// project's own `application` folder is used instead.
  pub fn resolve() -> Self {
    #[cfg(debug_assertions)]
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf).unwrap_or_default();
    #[cfg(not(debug_assertions))]
    let base = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)).unwrap_or_default();
    Self::new(base.join(FOLDER_NAME))
  }

  pub fn new(folder: PathBuf) -> Self {
    Self { folder, installing: AtomicBool::new(false), cancel_requested: AtomicBool::new(false) }
  }

  pub fn folder(&self) -> &Path {
    &self.folder
  }

  /// True while a batch install is running. The main window refuses to close
  /// during that time.
  pub fn is_installing(&self) -> bool {
    self.installing.load(Ordering::SeqCst)
  }

  /// Asks the running batch to stop once the current app has finished. An
  /// installer that has started is never killed.
  pub fn request_cancel(&self) {
    if self.is_installing() {
      self.cancel_requested.store(true, Ordering::SeqCst);
    }
  }

  fn cancel_requested(&self) -> bool {
    self.cancel_requested.load(Ordering::SeqCst)
  }

  /// Marks a batch as running, or returns `None` if one already is. The flag
  /// clears when the guard is dropped, even if the batch panics.
  fn begin_install(&self) -> Option<InstallGuard<'_>> {
    self.installing.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok()?;
    self.cancel_requested.store(false, Ordering::SeqCst);
    Some(InstallGuard(self))
  }
}

struct InstallGuard<'a>(&'a SoftwareCenter);

impl Drop for InstallGuard<'_> {
  fn drop(&mut self) {
    self.0.cancel_requested.store(false, Ordering::SeqCst);
    self.0.installing.store(false, Ordering::SeqCst);
  }
}

/// Opens the `application` folder in Explorer, creating it first if needed.
pub fn open_folder(center: &SoftwareCenter) -> Result<(), String> {
  std::fs::create_dir_all(center.folder())
    .map_err(|e| format!("Could not create {}: {e}", center.folder().display()))?;
  crate::network::process::launch(
    &crate::network::process::windows_dir("explorer.exe"),
    &[&center.folder().to_string_lossy()],
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_one_batch_at_a_time_and_cancel_resets() {
    let center = SoftwareCenter::new(PathBuf::from("unused"));
    center.request_cancel();
    assert!(!center.cancel_requested(), "cancel is ignored when nothing is running");

    let guard = center.begin_install().unwrap();
    assert!(center.is_installing());
    assert!(center.begin_install().is_none());
    center.request_cancel();
    assert!(center.cancel_requested());

    drop(guard);
    assert!(!center.is_installing());
    assert!(!center.cancel_requested());
  }
}
