//! Temporary-file cleanup. Only files older than a day are removed, so
//! installers and programs that are running keep their temp files; files in
//! use are skipped. Links and junctions are never followed, so nothing outside
//! the temp folders can be touched.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Temp files younger than this are left alone.
pub const MIN_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CleanupResult {
  pub files_removed: u64,
  pub bytes_freed: u64,
  /// Files that were in use or protected.
  pub skipped: u64,
}

/// The two temp folders: this user's `%TEMP%` and Windows' own.
pub fn temp_folders() -> Vec<PathBuf> {
  let mut folders = vec![std::env::temp_dir()];
  let windows = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows")).join("Temp");
  if !folders.iter().any(|f| f.eq(&windows)) {
    folders.push(windows);
  }
  folders
}

fn is_link(meta: &fs::Metadata) -> bool {
  #[cfg(windows)]
  {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
      return true;
    }
  }
  meta.file_type().is_symlink()
}

/// Removes files at least `min_age` old inside `folder` (and empty subfolders), never the folder itself.
pub fn clean(folder: &Path, now: SystemTime, min_age: Duration, result: &mut CleanupResult) {
  let Ok(entries) = fs::read_dir(folder) else { return };
  for entry in entries.flatten() {
    let path = entry.path();
    let Ok(meta) = fs::symlink_metadata(&path) else { continue };
    if is_link(&meta) {
      // A link or junction could point anywhere: leave it, and never look inside.
      result.skipped += 1;
      continue;
    }
    if meta.is_dir() {
      clean(&path, now, min_age, result);
      let _ = fs::remove_dir(&path); // only succeeds when it is now empty
      continue;
    }
    let old = meta.modified().ok().and_then(|m| now.duration_since(m).ok()).is_some_and(|age| age >= min_age);
    if !old {
      continue;
    }
    match fs::remove_file(&path) {
      Ok(()) => {
        result.files_removed += 1;
        result.bytes_freed += meta.len();
      }
      Err(_) => result.skipped += 1,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn removes_only_old_files_and_keeps_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("old.tmp"), b"12345").unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    fs::write(dir.path().join("sub").join("old2.tmp"), b"abc").unwrap();
    fs::write(dir.path().join("new.tmp"), b"keep").unwrap();

    // Pretend it is two days later for the "old" files, by cleaning with a
    // `now` two days ahead, then check a fresh file survives a normal clean.
    let mut result = CleanupResult::default();
    clean(dir.path(), SystemTime::now() + Duration::from_secs(2 * 24 * 3600), MIN_AGE, &mut result);
    assert_eq!(result.files_removed, 3);
    assert_eq!(result.bytes_freed, 12);
    assert!(dir.path().exists(), "the temp folder itself stays");
    assert!(!dir.path().join("sub").exists(), "emptied subfolders go");

    fs::write(dir.path().join("fresh.tmp"), b"x").unwrap();
    let mut result = CleanupResult::default();
    clean(dir.path(), SystemTime::now(), MIN_AGE, &mut result);
    assert_eq!(result.files_removed, 0);
    assert!(dir.path().join("fresh.tmp").exists());
  }

  #[cfg(windows)]
  #[test]
  fn never_follows_a_junction_out_of_the_folder() {
    let temp = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("precious.txt"), b"do not delete").unwrap();
    // A directory junction inside the temp folder pointing outside it.
    let link = temp.path().join("link");
    let status = std::process::Command::new(crate::network::process::system32("cmd.exe"))
      .args(["/c", "mklink", "/J"])
      .arg(&link)
      .arg(outside.path())
      .output()
      .unwrap();
    assert!(status.status.success(), "{}", String::from_utf8_lossy(&status.stdout));

    let mut result = CleanupResult::default();
    clean(temp.path(), SystemTime::now() + Duration::from_secs(3 * 24 * 3600), MIN_AGE, &mut result);
    assert!(outside.path().join("precious.txt").exists(), "files behind the junction are untouched");
    assert!(result.skipped >= 1);
  }
}
