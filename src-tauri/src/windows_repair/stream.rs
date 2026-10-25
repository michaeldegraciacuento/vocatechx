//! Runs a Windows repair tool and streams its output line by line, so long
//! repairs (DISM, SFC, defrag) show live progress. Tools are started by
//! absolute System32 path with fixed arguments, never through a shell.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// How a tool run ended.
#[derive(Debug)]
pub enum Finished {
  Exited { code: Option<i32>, output: Vec<String> },
  /// Still running when the time limit passed; left running, never killed,
  /// because stopping DISM or SFC half-way can leave Windows in a worse state.
  StillRunning { output: Vec<String> },
}

/// Decodes tool output. SFC writes UTF-16LE when its output is redirected;
/// DISM, CHKDSK and defrag write single-byte text.
pub fn decode(bytes: &[u8]) -> String {
  let zeros = bytes.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
  if bytes.len() >= 4 && zeros * 3 >= bytes.len() / 2 {
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
    String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string()
  } else {
    String::from_utf8_lossy(bytes).into_owned()
  }
}

/// Splits decoded output into lines. DISM redraws its progress bar with `\r`,
/// so carriage returns end a line too.
pub fn lines(text: &str) -> impl Iterator<Item = &str> {
  text.split(['\r', '\n']).map(str::trim).filter(|l| !l.is_empty())
}

/// A percentage reported by a tool line, e.g. DISM's `[====  45.3% ]`,
/// SFC's `Verification 45% complete.` or defrag's `Optimize: 45% complete`.
pub fn percent(line: &str) -> Option<f32> {
  let end = line.find('%')?;
  let digits: String = line[..end].chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
  let value: f32 = digits.parse().ok()?;
  (0.0..=100.0).contains(&value).then_some(value)
}

/// Starts `program` and calls `on_line` for each output line as it arrives.
pub fn run(program: &Path, args: &[&str], timeout: Duration, on_line: &mut dyn FnMut(&str)) -> Result<Finished, String> {
  let mut command = Command::new(program);
  command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  let name = program.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
  let mut child = command.spawn().map_err(|e| format!("Windows could not start {name}: {e}"))?;

  // Both pipes feed one channel; a reader thread per pipe so neither blocks.
  let (tx, rx) = mpsc::channel::<Vec<u8>>();
  for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>)]
    .into_iter()
    .flatten()
  {
    let tx = tx.clone();
    std::thread::spawn(move || {
      let mut pipe = pipe;
      let mut buffer = [0u8; 4096];
      while let Ok(n) = pipe.read(&mut buffer) {
        if n == 0 || tx.send(buffer[..n].to_vec()).is_err() {
          break;
        }
      }
    });
  }
  drop(tx);

  let started = Instant::now();
  let mut raw: Vec<u8> = Vec::new();
  let mut emitted = 0usize;
  let mut output: Vec<String> = Vec::new();
  let mut flush = |raw: &[u8], emitted: &mut usize, output: &mut Vec<String>, done: bool| {
    // Decode everything so far and emit only the complete new lines.
    let text = decode(raw);
    let complete = if done { text.as_str() } else { text.rfind(['\r', '\n']).map_or("", |i| &text[..i]) };
    let all: Vec<&str> = lines(complete).collect();
    for line in &all[(*emitted).min(all.len())..] {
      on_line(line);
      output.push((*line).to_string());
    }
    *emitted = all.len();
  };

  loop {
    match rx.recv_timeout(Duration::from_millis(200)) {
      Ok(chunk) => {
        raw.extend_from_slice(&chunk);
        flush(&raw, &mut emitted, &mut output, false);
      }
      Err(mpsc::RecvTimeoutError::Timeout) => {}
      Err(mpsc::RecvTimeoutError::Disconnected) => break,
    }
    if started.elapsed() > timeout {
      flush(&raw, &mut emitted, &mut output, true);
      return Ok(Finished::StillRunning { output });
    }
  }
  flush(&raw, &mut emitted, &mut output, true);
  let status = child.wait().map_err(|e| format!("Lost track of {name}: {e}"))?;
  Ok(Finished::Exited { code: status.code(), output })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decodes_utf16_and_single_byte_output() {
    let utf16: Vec<u8> = "Verification 45% complete.\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(decode(&utf16), "Verification 45% complete.\r\n");
    assert_eq!(decode(b"The operation completed successfully."), "The operation completed successfully.");
  }

  #[test]
  fn splits_on_carriage_returns_like_dism_progress() {
    let text = "[==         5.0%    ]\r[=====     45.3%    ]\r\nThe restore operation completed successfully.\r\n";
    let all: Vec<&str> = lines(text).collect();
    assert_eq!(all.len(), 3);
    assert_eq!(all[2], "The restore operation completed successfully.");
  }

  #[test]
  fn reads_progress_percentages() {
    assert_eq!(percent("[=====      45.3%                ]"), Some(45.3));
    assert_eq!(percent("Verification 12% complete."), Some(12.0));
    assert_eq!(percent("Optimize: 100% complete."), Some(100.0));
    assert_eq!(percent("No progress here"), None);
    assert_eq!(percent("Use 250% zoom"), None);
  }

  #[cfg(windows)]
  #[test]
  fn streams_a_real_tool_line_by_line() {
    let mut seen = Vec::new();
    let finished = run(&crate::network::process::system32("cmd.exe"), &["/c", "echo one& echo two& exit 3"], Duration::from_secs(20), &mut |l| {
      seen.push(l.to_string())
    })
    .unwrap();
    assert_eq!(seen, ["one", "two"]);
    assert!(matches!(finished, Finished::Exited { code: Some(3), .. }));
  }
}
