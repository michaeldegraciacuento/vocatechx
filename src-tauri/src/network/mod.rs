//! Network Center: adapter information, connectivity diagnosis, DNS tools,
//! quick repairs, performance tests, file sharing, and report history.
//!
//! Everything works without internet access. Tests that probe the internet
//! simply report it as unreachable.

pub mod adapters;
pub mod diagnostics;
pub mod dns;
mod probe;
mod process;
pub mod repair;
pub mod report;
pub mod sharing;
mod sys;
pub mod validate;
pub mod wifi;

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsServerResult {
  /// `system` for the Windows resolver, otherwise the server's IP address.
  pub server: String,
  pub addresses: Vec<String>,
  pub aliases: Vec<String>,
  pub elapsed_ms: Option<u32>,
  pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsComparison {
  pub run_id: Option<i64>,
  pub domain: String,
  pub results: Vec<DnsServerResult>,
  /// Every server that answered returned at least one address in common.
  pub consistent: bool,
}

const MAX_DNS_SERVERS: usize = 6;

/// Resolves `domain` through Windows and directly through each server, in parallel.
pub fn compare_dns(domain: &str, servers: &[String]) -> AppResult<DnsComparison> {
  let domain = validate::domain(domain)?;
  let mut parsed: Vec<IpAddr> = Vec::new();
  for server in servers.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
    let ip = server
      .parse::<IpAddr>()
      .map_err(|_| AppError::validation(format!("\"{server}\" is not a valid DNS server IP address.")))?;
    if !parsed.contains(&ip) {
      parsed.push(ip);
    }
  }
  if parsed.len() > MAX_DNS_SERVERS {
    return Err(AppError::validation(format!("Compare at most {MAX_DNS_SERVERS} DNS servers at a time.")));
  }

  let timeout = Duration::from_secs(4);
  let results: Vec<DnsServerResult> = std::thread::scope(|scope| {
    let system = scope.spawn(|| ("system".to_string(), dns::resolve_system(&domain, timeout)));
    let direct: Vec<_> = parsed
      .iter()
      .map(|&ip| {
        let domain = domain.as_str();
        scope.spawn(move || (ip.to_string(), dns::query_server(ip, domain, timeout)))
      })
      .collect();
    std::iter::once(system).chain(direct).filter_map(|h| h.join().ok()).collect::<Vec<_>>()
  })
  .into_iter()
  .map(|(server, result)| match result {
    Ok(lookup) => DnsServerResult {
      server,
      addresses: lookup.addresses.iter().map(IpAddr::to_string).collect(),
      aliases: lookup.aliases,
      elapsed_ms: Some(lookup.elapsed_ms),
      error: None,
    },
    Err(error) => DnsServerResult { server, addresses: vec![], aliases: vec![], elapsed_ms: None, error: Some(error) },
  })
  .collect();

  // The system resolver also returns IPv6 addresses; compare on IPv4 only.
  let answered: Vec<Vec<&String>> = results
    .iter()
    .filter(|r| r.error.is_none())
    .map(|r| r.addresses.iter().filter(|a| !a.contains(':')).collect())
    .collect();
  let consistent = answered.windows(2).all(|pair| pair[0].iter().any(|a| pair[1].contains(a)));

  Ok(DnsComparison { run_id: None, domain, results, consistent })
}

pub fn dns_logs(comparison: &DnsComparison) -> Vec<report::LogLine> {
  use report::{Level, LogLine};
  let mut logs: Vec<LogLine> = comparison
    .results
    .iter()
    .map(|r| {
      let server = if r.server == "system" { "Windows resolver".to_string() } else { format!("DNS server {}", r.server) };
      match &r.error {
        None => LogLine::new(
          Level::Info,
          format!("{server}: {} ({} ms)", r.addresses.join(", "), r.elapsed_ms.unwrap_or_default()),
        ),
        Some(e) => LogLine::new(Level::Error, format!("{server}: {e}")),
      }
    })
    .collect();
  if !comparison.consistent {
    logs.push(LogLine::new(
      Level::Warning,
      "Servers returned different addresses. Large sites often answer differently by location (CDNs), but a mismatch on a small site can mean a wrong or hijacked DNS server.",
    ));
  }
  logs
}

/// Resolves a performance-test target to an IPv4 address.
pub fn resolve_target(target: &str) -> AppResult<(String, Ipv4Addr)> {
  let host = validate::host(target)?;
  if let Ok(ip) = host.parse::<Ipv4Addr>() {
    return Ok((host, ip));
  }
  let lookup = dns::resolve_system(&host, Duration::from_secs(5)).map_err(|e| AppError::Network(format!("{host}: {e}")))?;
  lookup
    .addresses
    .iter()
    .find_map(|a| match a {
      IpAddr::V4(v4) => Some(*v4),
      IpAddr::V6(_) => None,
    })
    .map(|ip| (host.clone(), ip))
    .ok_or_else(|| AppError::Network(format!("{host} has no IPv4 address to test.")))
}

pub fn computer_name() -> Option<String> {
  std::env::var("COMPUTERNAME").ok()
}
