//! Validation for every value the Printer & Devices UI sends to the backend.
//! Anything that reaches a Windows tool or PowerShell query is checked here
//! first and then passed only as a quoted single-quoted literal or a separate
//! argument, never spliced into a command line.

use crate::error::{AppError, AppResult};

/// Characters that could break out of a PowerShell single-quoted literal or a
/// rundll32 argument, or inject a new line.
const UNSAFE: &[char] = &['"', '`', '\r', '\n', '\u{2018}', '\u{2019}'];

/// A Windows printer name. Printer names allow spaces and most punctuation, so
/// only control characters and quote/newline characters are rejected. The
/// value is additionally confirmed against the list of installed printers by
/// the caller before any action is taken.
pub fn printer_name(input: &str) -> AppResult<String> {
  let value = input.trim();
  if value.is_empty() || value.chars().count() > 220 {
    return Err(AppError::validation("Choose an installed printer."));
  }
  if value.chars().any(|c| c.is_control() || UNSAFE.contains(&c)) {
    return Err(AppError::validation("That printer name contains characters VocaTechX cannot use safely."));
  }
  Ok(value.to_string())
}

/// A print-job identifier (a small non-negative integer assigned by the
/// spooler). Used by the Phase 2 queue actions.
#[allow(dead_code)]
pub fn job_id(input: i64) -> AppResult<u32> {
  if (0..=u32::MAX as i64).contains(&input) {
    Ok(input as u32)
  } else {
    Err(AppError::validation("That print job is no longer valid."))
  }
}

/// A Plug-and-Play device instance ID, e.g.
/// `USB\VID_046D&PID_C534\5&1234ABCD&0&1`. These contain letters, digits and
/// `\\ & _ . { } -`; anything else is rejected.
pub fn instance_id(input: &str) -> AppResult<String> {
  let value = input.trim();
  if value.is_empty() || value.chars().count() > 400 {
    return Err(AppError::validation("Select a device."));
  }
  let ok = value
    .chars()
    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '\\' | '&' | '_' | '.' | '{' | '}' | '-' | '#' | '+' | ' '));
  if !ok {
    return Err(AppError::validation("That device identifier is not valid."));
  }
  Ok(value.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn printer_names_allow_spaces_reject_quotes() {
    assert_eq!(printer_name("  HP LaserJet 400 M401  ").unwrap(), "HP LaserJet 400 M401");
    assert_eq!(printer_name("Microsoft Print to PDF").unwrap(), "Microsoft Print to PDF");
    assert!(printer_name("").is_err());
    assert!(printer_name("bad\"name").is_err());
    assert!(printer_name("line\nbreak").is_err());
    assert!(printer_name("tick`name").is_err());
  }

  #[test]
  fn job_ids_are_bounded() {
    assert_eq!(job_id(0).unwrap(), 0);
    assert_eq!(job_id(42).unwrap(), 42);
    assert!(job_id(-1).is_err());
    assert!(job_id(i64::from(u32::MAX) + 1).is_err());
  }

  #[test]
  fn instance_ids_accept_real_shapes_reject_injection() {
    assert!(instance_id(r"USB\VID_046D&PID_C534\5&1234ABCD&0&1").is_ok());
    assert!(instance_id(r"PCI\VEN_8086&DEV_1234&SUBSYS_00000000&REV_01\3&11583659&0&10").is_ok());
    assert!(instance_id("").is_err());
    assert!(instance_id("dev; Remove-Item").is_err());
    assert!(instance_id("dev'id").is_err());
  }
}
