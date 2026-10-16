//! Validation for every value the user types into Network Center. Anything
//! that reaches a Windows API or tool goes through one of these first.

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Characters Windows does not allow in share names.
const SHARE_NAME_FORBIDDEN: &[char] = &['"', '/', '\\', '[', ']', ':', '|', '<', '>', '+', '=', ';', ',', '*', '?'];
/// Quote characters that could end a quoted value in PowerShell or a command line.
const QUOTES: &[char] = &['"', '\'', '`', '\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}', '\u{201C}', '\u{201D}'];

fn is_label(label: &str) -> bool {
  !label.is_empty()
    && label.len() <= 63
    && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    && !label.starts_with('-')
    && !label.ends_with('-')
}

/// A domain name such as `www.example.com`.
pub fn domain(input: &str) -> AppResult<String> {
  let value = input.trim().trim_end_matches('.').to_ascii_lowercase();
  let value = value.strip_prefix("https://").or_else(|| value.strip_prefix("http://")).unwrap_or(&value);
  let value = value.split('/').next().unwrap_or_default();
  if value.is_empty() || value.len() > 253 || !value.split('.').all(is_label) {
    return Err(AppError::validation("Enter a domain name such as www.example.com."));
  }
  Ok(value.to_string())
}

/// A computer name, fully qualified name or IPv4 address, with or without a
/// leading `\\`.
pub fn host(input: &str) -> AppResult<String> {
  let value = input.trim().trim_start_matches('\\').trim_end_matches('\\').trim();
  if value.parse::<Ipv4Addr>().is_ok() {
    return Ok(value.to_string());
  }
  if value.is_empty() || value.len() > 253 || !value.trim_end_matches('.').split('.').all(is_label) {
    return Err(AppError::validation(
      "Enter a computer name (such as LAB-PC-01) or an IPv4 address (such as 192.168.1.20).",
    ));
  }
  Ok(value.trim_end_matches('.').to_string())
}

/// A name for a new share on this computer.
pub fn share_name(input: &str) -> AppResult<String> {
  let value = input.trim();
  if value.is_empty() || value.chars().count() > 80 {
    return Err(AppError::validation("Enter a share name of 1 to 80 characters."));
  }
  if value.ends_with('$') {
    return Err(AppError::validation("Hidden share names ending in $ are not supported here."));
  }
  if value.chars().any(|c| c.is_control() || SHARE_NAME_FORBIDDEN.contains(&c) || QUOTES.contains(&c)) {
    return Err(AppError::validation(
      "Share names cannot contain quotes or any of these characters: \" / \\ [ ] : | < > + = ; , * ?",
    ));
  }
  Ok(value.to_string())
}

/// A UNC path such as `\\LAB-PC-01\Projects\Week 3`.
pub struct UncPath {
  pub full: String,
}

pub fn unc_path(input: &str) -> AppResult<UncPath> {
  let invalid = || AppError::validation(r"Enter a network path in the form \\COMPUTER-NAME\ShareName.");
  let value = input.trim().replace('/', "\\");
  let rest = value.strip_prefix(r"\\").ok_or_else(invalid)?;
  let mut parts = rest.split('\\').filter(|p| !p.is_empty());
  let host = host(parts.next().ok_or_else(invalid)?).map_err(|_| invalid())?;
  let share = parts.next().ok_or_else(invalid)?.to_string();
  if share.chars().any(|c| c.is_control() || SHARE_NAME_FORBIDDEN.contains(&c) || QUOTES.contains(&c)) {
    return Err(invalid());
  }
  let folders: Vec<&str> = parts.collect();
  if folders.iter().any(|f| *f == ".." || f.chars().any(|c| c.is_control() || QUOTES.contains(&c) || "<>|*?\"".contains(c))) {
    return Err(invalid());
  }
  let mut full = format!(r"\\{host}\{share}");
  for folder in folders {
    full.push('\\');
    full.push_str(folder);
  }
  Ok(UncPath { full })
}

/// An existing local folder to share.
pub fn local_folder(input: &str) -> AppResult<PathBuf> {
  let path = Path::new(input.trim());
  let text = path.to_string_lossy();
  if !path.is_absolute() || text.starts_with(r"\\") {
    return Err(AppError::validation("Choose a folder on this computer."));
  }
  if text.chars().any(|c| c.is_control() || QUOTES.contains(&c)) {
    return Err(AppError::validation("Folders whose path contains quote characters cannot be shared from VocaTechX."));
  }
  if !path.is_dir() {
    return Err(AppError::validation("That folder does not exist. Choose an existing folder."));
  }
  Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn domains_are_normalized_and_checked() {
    assert_eq!(domain(" WWW.Example.com. ").unwrap(), "www.example.com");
    assert_eq!(domain("https://example.org/path").unwrap(), "example.org");
    assert!(domain("").is_err());
    assert!(domain("bad domain.com").is_err());
    assert!(domain("-bad.com").is_err());
    assert!(domain("a..b").is_err());
  }

  #[test]
  fn hosts_accept_names_and_ipv4() {
    assert_eq!(host(r"\\LAB-PC-01").unwrap(), "LAB-PC-01");
    assert_eq!(host("192.168.1.20").unwrap(), "192.168.1.20");
    assert!(host("pc; rm").is_err());
    assert!(host("pc&calc").is_err());
    assert!(host("").is_err());
  }

  #[test]
  fn share_names_reject_unsafe_characters() {
    assert_eq!(share_name(" Projects ").unwrap(), "Projects");
    assert!(share_name("C$").is_err());
    assert!(share_name("a'b").is_err());
    assert!(share_name("a/b").is_err());
    assert!(share_name("").is_err());
  }

  #[test]
  fn unc_paths_are_parsed() {
    let p = unc_path(r"\\LAB-PC-01\Projects\Week 3").unwrap();
    assert_eq!(p.full, r"\\LAB-PC-01\Projects\Week 3");
    assert_eq!(unc_path("//server/share").unwrap().full, r"\\server\share");
    assert!(unc_path(r"\\server").is_err());
    assert!(unc_path(r"C:\folder").is_err());
    assert!(unc_path(r"\\server\share\..\x").is_err());
    assert!(unc_path(r#"\\server\sh"are"#).is_err());
  }
}
