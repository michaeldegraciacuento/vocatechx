//! Runs the built-in Windows tools Network Center relies on (ipconfig, netsh,
//! PowerShell) without a console window and with a time limit. Programs are
//! started by absolute System32 path, never through a shell, and user input is
//! never placed in a command line unquoted.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::sys;

#[derive(Debug, Clone)]
pub struct CommandOutput {
  pub code: Option<i32>,
  pub stdout: String,
  pub stderr: String,
}

impl CommandOutput {
  pub fn success(&self) -> bool {
    self.code == Some(0)
  }

  /// Non-empty output lines, for logs and the UI.
  pub fn text(&self) -> String {
    let combined = format!("{}\n{}", self.stdout, self.stderr);
    combined.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n")
  }
}

/// Exit code reported when the user declines the UAC prompt (`ERROR_CANCELLED`).
const UAC_CANCELLED: i32 = 1223;

#[derive(Debug)]
pub enum Elevated {
  /// The command ran as administrator. Output is only captured when
  /// VocaTechX itself is elevated; otherwise only the exit code is known.
  Completed(CommandOutput),
  /// The user declined the Windows administrator prompt.
  Cancelled,
}

/// `C:\Windows\System32\<exe>`.
pub fn system32(exe: &str) -> PathBuf {
  let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
  root.join("System32").join(exe)
}

/// `C:\Windows\<exe>`.
pub fn windows_dir(exe: &str) -> PathBuf {
  std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows")).join(exe)
}

fn powershell_exe() -> PathBuf {
  system32(r"WindowsPowerShell\v1.0\powershell.exe")
}

/// Starts a GUI program (Explorer, Control Panel) without waiting for it.
pub fn launch(program: &PathBuf, args: &[&str]) -> Result<(), String> {
  Command::new(program)
    .args(args)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("Could not open {}: {e}", program.display()))
}

pub fn run(program: &PathBuf, args: &[&str], timeout: Duration) -> Result<CommandOutput, String> {
  let mut command = Command::new(program);
  command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }

  let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let mut child = command.spawn().map_err(|e| format!("Could not start {name}: {e}"))?;

  // Drain both pipes on their own threads so a full pipe never blocks the child.
  let drain = |pipe: Option<Box<dyn Read + Send>>| {
    std::thread::spawn(move || {
      let mut bytes = Vec::new();
      if let Some(mut pipe) = pipe {
        let _ = pipe.read_to_end(&mut bytes);
      }
      String::from_utf8_lossy(&bytes).into_owned()
    })
  };
  let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
  let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

  let started = Instant::now();
  let status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status,
      Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(40)),
      Ok(None) => {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("{name} did not finish within {} seconds.", timeout.as_secs()));
      }
      Err(e) => return Err(format!("Could not wait for {name}: {e}")),
    }
  };

  Ok(CommandOutput {
    code: status.code(),
    stdout: stdout.join().unwrap_or_default(),
    stderr: stderr.join().unwrap_or_default(),
  })
}

/// Runs a PowerShell script passed as `-EncodedCommand`, so nothing in it is
/// re-parsed by a command line. Output is forced to UTF-8.
pub fn powershell(script: &str, timeout: Duration) -> Result<CommandOutput, String> {
  let script = format!(
    "$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n{script}"
  );
  let encoded = encode_command(&script);
  run(
    &powershell_exe(),
    &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded],
    timeout,
  )
}

/// Runs a System32 program as administrator. If VocaTechX is already elevated
/// it runs directly (and its output is captured); otherwise Windows shows the
/// UAC prompt.
pub fn run_elevated(program: &PathBuf, args: &[&str], timeout: Duration) -> Result<Elevated, String> {
  if sys::is_elevated() {
    return run(program, args, timeout).map(Elevated::Completed);
  }

  let arg_list = if args.is_empty() {
    String::new()
  } else {
    format!("-ArgumentList @({}) ", args.iter().map(|a| ps_quote(a)).collect::<Vec<_>>().join(", "))
  };
  let script = format!(
    r#"try {{
  $p = Start-Process -FilePath {program} {arg_list}-Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
  exit $p.ExitCode
}} catch {{
  $e = $_.Exception
  while ($e) {{
    if ($e -is [System.ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq 1223) {{ exit {UAC_CANCELLED} }}
    $e = $e.InnerException
  }}
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}}"#,
    program = ps_quote(&program.to_string_lossy()),
  );
  let output = powershell(&script, timeout)?;
  if output.code == Some(UAC_CANCELLED) {
    Ok(Elevated::Cancelled)
  } else {
    Ok(Elevated::Completed(output))
  }
}

/// Runs a PowerShell script as administrator (see [`run_elevated`]).
pub fn powershell_elevated(script: &str, timeout: Duration) -> Result<Elevated, String> {
  if sys::is_elevated() {
    return powershell(script, timeout).map(Elevated::Completed);
  }
  let script = format!("$ProgressPreference = 'SilentlyContinue'\n{script}");
  let encoded = encode_command(&script);
  run_elevated(
    &powershell_exe(),
    &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", &encoded],
    timeout,
  )
}

/// A PowerShell single-quoted string literal. PowerShell also treats the
/// typographic single quotes as quote characters, so all of them are doubled.
pub fn ps_quote(value: &str) -> String {
  let mut out = String::with_capacity(value.len() + 2);
  out.push('\'');
  for c in value.chars() {
    if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
      out.push(c);
    }
    out.push(c);
  }
  out.push('\'');
  out
}

/// Base64 of the UTF-16LE script, as `powershell -EncodedCommand` expects.
fn encode_command(script: &str) -> String {
  let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
  base64(&bytes)
}

pub(crate) fn base64(bytes: &[u8]) -> String {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
    out.push(TABLE[(n >> 18) as usize & 63] as char);
    out.push(TABLE[(n >> 12) as usize & 63] as char);
    out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
    out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn base64_matches_reference_vectors() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    assert_eq!(base64(b"foobar"), "Zm9vYmFy");
  }

  #[test]
  fn ps_quote_doubles_every_single_quote_form() {
    assert_eq!(ps_quote("C:\\Shared"), "'C:\\Shared'");
    assert_eq!(ps_quote("it's"), "'it''s'");
    assert_eq!(ps_quote("a\u{2019}b"), "'a\u{2019}\u{2019}b'");
  }

  #[cfg(windows)]
  #[test]
  fn powershell_round_trips_unicode_output() {
    let output = powershell("Write-Output 'café ✓'", Duration::from_secs(60)).unwrap();
    assert!(output.success(), "{output:?}");
    assert_eq!(output.stdout.trim(), "café ✓");
  }
}
