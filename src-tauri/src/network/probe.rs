//! Reachability probes: ICMP ping series and TCP connection checks.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::sys::{self, PingReply};

/// Public resolvers used as well-known internet reachability targets.
pub const PUBLIC_TARGETS: [Ipv4Addr; 2] = [Ipv4Addr::new(1, 1, 1, 1), Ipv4Addr::new(8, 8, 8, 8)];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingStats {
  pub target: String,
  pub address: String,
  pub sent: u32,
  pub received: u32,
  pub loss_percent: f64,
  pub min_ms: Option<u32>,
  pub max_ms: Option<u32>,
  pub avg_ms: Option<f64>,
  /// Mean difference between consecutive round-trip times.
  pub jitter_ms: Option<f64>,
  /// One entry per request: the round-trip time, or `None` if lost.
  pub samples: Vec<Option<u32>>,
  /// Why the last lost request failed, when Windows said more than "timed out".
  pub last_error: Option<String>,
}

pub fn ping_series(target: &str, address: Ipv4Addr, count: u32, interval: Duration, timeout_ms: u32) -> PingStats {
  let mut samples = Vec::with_capacity(count as usize);
  let mut last_error = None;
  for i in 0..count {
    let started = Instant::now();
    match sys::ping(address, timeout_ms) {
      PingReply::Reply { rtt_ms } => samples.push(Some(rtt_ms)),
      PingReply::Timeout => samples.push(None),
      PingReply::Error { status } => {
        samples.push(None);
        last_error = Some(describe_icmp_status(status));
      }
    }
    if i + 1 < count {
      if let Some(rest) = interval.checked_sub(started.elapsed()) {
        std::thread::sleep(rest);
      }
    }
  }
  summarize(target, address, samples, last_error)
}

pub fn summarize(target: &str, address: Ipv4Addr, samples: Vec<Option<u32>>, last_error: Option<String>) -> PingStats {
  let received: Vec<u32> = samples.iter().flatten().copied().collect();
  let sent = samples.len() as u32;
  let avg_ms = (!received.is_empty()).then(|| received.iter().map(|&v| v as f64).sum::<f64>() / received.len() as f64);
  let jitter_ms = (received.len() >= 2).then(|| {
    let diffs: Vec<f64> = received.windows(2).map(|w| (w[1] as f64 - w[0] as f64).abs()).collect();
    diffs.iter().sum::<f64>() / diffs.len() as f64
  });
  PingStats {
    target: target.to_string(),
    address: address.to_string(),
    sent,
    received: received.len() as u32,
    loss_percent: if sent == 0 { 0.0 } else { (sent - received.len() as u32) as f64 * 100.0 / sent as f64 },
    min_ms: received.iter().min().copied(),
    max_ms: received.iter().max().copied(),
    avg_ms,
    jitter_ms,
    samples,
    last_error,
  }
}

pub fn describe_icmp_status(status: u32) -> String {
  match status {
    11002 => "Destination network unreachable".into(),
    11003 => "Destination host unreachable".into(),
    11004 => "Destination protocol unreachable".into(),
    11005 => "Destination port unreachable".into(),
    11013 | 11014 => "The request expired in transit (TTL expired)".into(),
    11050 => "General failure (no route or the adapter is down)".into(),
    1231 => "The network location cannot be reached".into(),
    1232 => "The host is unreachable".into(),
    sys::NOT_SUPPORTED => "Ping is not supported on this system".into(),
    other => format!("Ping failed (status {other})"),
  }
}

/// Opens and closes a TCP connection. Returns the connect time in ms.
pub fn tcp_check(addr: SocketAddr, timeout: Duration) -> Result<u32, String> {
  let started = Instant::now();
  match TcpStream::connect_timeout(&addr, timeout) {
    Ok(_) => Ok(started.elapsed().as_millis().min(u32::MAX as u128) as u32),
    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Err(format!("No response from {addr} within {} s", timeout.as_secs_f32())),
    Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => Err(format!("{addr} refused the connection")),
    Err(e) => Err(format!("Could not connect to {addr}: {e}")),
  }
}

/// The first successful TCP check against several targets, run in parallel.
pub fn first_reachable(targets: &[SocketAddr], timeout: Duration) -> Result<(SocketAddr, u32), String> {
  let results: Vec<(SocketAddr, Result<u32, String>)> = std::thread::scope(|scope| {
    let handles: Vec<_> = targets.iter().map(|&addr| scope.spawn(move || (addr, tcp_check(addr, timeout)))).collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
  });
  let mut last_error = String::from("No targets to check");
  for (addr, result) in results {
    match result {
      Ok(ms) => return Ok((addr, ms)),
      Err(e) => last_error = e,
    }
  }
  Err(last_error)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn summarizes_loss_latency_and_jitter() {
    let stats = summarize("t", Ipv4Addr::LOCALHOST, vec![Some(10), None, Some(20), Some(14)], None);
    assert_eq!(stats.sent, 4);
    assert_eq!(stats.received, 3);
    assert_eq!(stats.loss_percent, 25.0);
    assert_eq!(stats.min_ms, Some(10));
    assert_eq!(stats.max_ms, Some(20));
    assert!((stats.avg_ms.unwrap() - 44.0 / 3.0).abs() < 1e-9);
    assert_eq!(stats.jitter_ms, Some(8.0)); // |20-10| and |14-20| -> mean 8
  }

  #[test]
  fn total_loss_has_no_latency_figures() {
    let stats = summarize("t", Ipv4Addr::LOCALHOST, vec![None, None], None);
    assert_eq!(stats.loss_percent, 100.0);
    assert!(stats.avg_ms.is_none() && stats.jitter_ms.is_none() && stats.min_ms.is_none());
  }

  #[cfg(windows)]
  #[test]
  fn loopback_answers_ping() {
    let stats = ping_series("localhost", Ipv4Addr::LOCALHOST, 2, Duration::from_millis(10), 1000);
    assert_eq!(stats.received, 2, "{stats:?}");
  }
}
