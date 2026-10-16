//! Network health, the step-by-step connectivity diagnosis, and the
//! latency/packet-loss performance test.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::adapters::{self, Adapter, AdapterKind, AdapterStatus};
use super::probe::{self, PingStats, PUBLIC_TARGETS};
use super::repair::RepairAction;
use super::report::{Level, LogLine};
use super::dns;

/// A neutral, widely available name used for resolution tests.
pub const TEST_DOMAIN: &str = "www.microsoft.com";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
  Pass,
  Warn,
  Fail,
  Skip,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
  pub id: &'static str,
  pub title: String,
  pub status: StepStatus,
  pub detail: String,
  pub hint: Option<String>,
  pub duration_ms: u32,
}

impl Step {
  fn new(id: &'static str, title: &str, status: StepStatus, detail: impl Into<String>, started: Instant) -> Self {
    Self {
      id,
      title: title.into(),
      status,
      detail: detail.into(),
      hint: None,
      duration_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
    }
  }

  fn hint(mut self, hint: impl Into<String>) -> Self {
    self.hint = Some(hint.into());
    self
  }

  fn skipped(id: &'static str, title: &str) -> Self {
    Self::new(id, title, StepStatus::Skip, "Skipped because an earlier test failed.", Instant::now())
  }
}

/// Turns test steps into history log lines.
pub fn step_logs(steps: &[Step]) -> Vec<LogLine> {
  steps
    .iter()
    .map(|s| {
      let (level, tag) = match s.status {
        StepStatus::Pass => (Level::Info, "PASS"),
        StepStatus::Skip => (Level::Info, "SKIP"),
        StepStatus::Warn => (Level::Warning, "WARN"),
        StepStatus::Fail => (Level::Error, "FAIL"),
      };
      let mut message = format!("[{tag}] {}: {}", s.title, s.detail);
      if let Some(hint) = &s.hint {
        message.push_str(&format!(" Suggested fix: {hint}"));
      }
      LogLine::new(level, message)
    })
    .collect()
}

// ---------------------------------------------------------------------------
// Health

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
  /// Connected and the internet is reachable.
  Connected,
  /// Connected to a network, but the internet is not reachable.
  Limited,
  /// No connected adapter with an address.
  Disconnected,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternetCheck {
  pub reachable: bool,
  pub latency_ms: Option<u32>,
  pub dns_resolves: bool,
  pub dns_ms: Option<u32>,
  pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkHealth {
  pub status: HealthStatus,
  pub summary: String,
  pub adapter: Option<Adapter>,
  pub wifi_ssid: Option<String>,
  pub internet: InternetCheck,
  pub computer_name: Option<String>,
  pub checked_at: i64,
}

/// The adapter used for internet traffic, or failing that the first connected
/// physical adapter with an IPv4 address.
fn active_adapter(adapters: Vec<Adapter>) -> Option<Adapter> {
  let connected = |a: &&Adapter| a.status == AdapterStatus::Connected && !a.ipv4.is_empty();
  adapters
    .iter()
    .find(|a| a.is_primary)
    .or_else(|| adapters.iter().filter(connected).find(|a| a.kind != AdapterKind::Virtual))
    .or_else(|| adapters.iter().find(connected))
    .cloned()
}

fn internet_targets() -> Vec<SocketAddr> {
  PUBLIC_TARGETS.iter().map(|ip| SocketAddr::from((*ip, 443))).collect()
}

pub fn health() -> NetworkHealth {
  let adapter = adapters::list_enabled().ok().and_then(active_adapter);

  let (tcp, lookup) = std::thread::scope(|scope| {
    let tcp = scope.spawn(|| probe::first_reachable(&internet_targets(), Duration::from_millis(2500)));
    let lookup = scope.spawn(|| dns::resolve_system(TEST_DOMAIN, Duration::from_secs(4)));
    (tcp.join().unwrap_or_else(|_| Err("check failed".into())), lookup.join().unwrap_or_else(|_| Err("check failed".into())))
  });

  let internet = InternetCheck {
    reachable: tcp.is_ok(),
    latency_ms: tcp.as_ref().ok().map(|(_, ms)| *ms),
    dns_resolves: lookup.is_ok(),
    dns_ms: lookup.as_ref().ok().map(|l| l.elapsed_ms),
    detail: match (&tcp, &lookup) {
      (Ok((addr, ms)), Ok(_)) => format!("Reached {} in {ms} ms; names resolve.", addr.ip()),
      (Ok((addr, ms)), Err(e)) => format!("Reached {} in {ms} ms, but name resolution failed: {e}", addr.ip()),
      (Err(e), Ok(_)) => format!("Names resolve, but public addresses are unreachable: {e}"),
      (Err(e), Err(_)) => format!("Public addresses are unreachable: {e}"),
    },
  };

  let (status, summary) = match &adapter {
    None => (HealthStatus::Disconnected, "No network connection. Connect a cable or join a Wi-Fi network.".to_string()),
    Some(a) if a.apipa => (
      HealthStatus::Limited,
      format!("{} has a self-assigned address. The network's DHCP server did not respond.", a.name),
    ),
    Some(a) if internet.reachable && internet.dns_resolves => {
      (HealthStatus::Connected, format!("Connected to the internet through {}.", a.name))
    }
    Some(a) if internet.reachable => {
      (HealthStatus::Limited, format!("Connected through {}, but domain names are not resolving.", a.name))
    }
    Some(a) => (HealthStatus::Limited, format!("Connected to a local network through {}, but the internet is not reachable.", a.name)),
  };

  let wifi_ssid = adapter.as_ref().filter(|a| a.kind == AdapterKind::Wifi).and_then(|_| adapters::wifi_ssid());

  NetworkHealth {
    status,
    summary,
    adapter,
    wifi_ssid,
    internet,
    computer_name: std::env::var("COMPUTERNAME").ok(),
    checked_at: crate::auth::now(),
  }
}

// ---------------------------------------------------------------------------
// Connectivity diagnosis

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
  pub run_id: Option<i64>,
  pub steps: Vec<Step>,
  pub healthy: bool,
  /// Title of the first failing step: the most likely point of failure.
  pub failure_point: Option<String>,
  pub summary: String,
  pub recommended_repairs: Vec<RepairAction>,
  pub adapter_name: Option<String>,
}

fn link_detail(adapter: &Adapter) -> String {
  let speed = adapter.link_speed_bps.map(|bps| format!(", link speed {}", format_bps(bps))).unwrap_or_default();
  format!("{} ({}) is connected{speed}.", adapter.name, adapter.kind.label())
}

pub fn format_bps(bps: u64) -> String {
  match bps {
    b if b >= 1_000_000_000 => format!("{:.1} Gbps", b as f64 / 1e9).replace(".0 ", " "),
    b if b >= 1_000_000 => format!("{:.0} Mbps", b as f64 / 1e6),
    b if b >= 1_000 => format!("{:.0} Kbps", b as f64 / 1e3),
    b => format!("{b} bps"),
  }
}

fn ping_detail(stats: &PingStats) -> String {
  match stats.avg_ms {
    Some(avg) => format!("{} of {} replies from {}, average {avg:.0} ms.", stats.received, stats.sent, stats.address),
    None => format!(
      "No replies from {} ({} sent){}.",
      stats.address,
      stats.sent,
      stats.last_error.as_ref().map(|e| format!(": {e}")).unwrap_or_default()
    ),
  }
}

pub fn run_diagnostics() -> DiagnosticReport {
  let mut steps = Vec::new();

  // 1. Adapter
  let started = Instant::now();
  let listing = adapters::list_enabled();
  let adapter = listing.as_ref().ok().and_then(|list| active_adapter(list.clone()));
  let any_connected = listing.as_ref().map(|l| l.iter().any(|a| a.status == AdapterStatus::Connected)).unwrap_or(false);
  steps.push(match (&listing, &adapter) {
    (Err(e), _) => Step::new("adapter", "Network adapter", StepStatus::Fail, e.clone(), started)
      .hint("Open Device Manager and check the network adapters for errors."),
    (Ok(_), Some(a)) => Step::new("adapter", "Network adapter", StepStatus::Pass, link_detail(a), started),
    (Ok(_), None) if any_connected => Step::new(
      "adapter",
      "Network adapter",
      StepStatus::Fail,
      "An adapter is connected but has no IPv4 configuration.",
      started,
    )
    .hint("Check the adapter's IPv4 settings in Network Connections."),
    (Ok(_), None) => Step::new("adapter", "Network adapter", StepStatus::Fail, "No network adapter is connected.", started)
      .hint("Plug in the network cable or connect to Wi-Fi, and make sure the adapter is enabled (see the Adapters tab)."),
  });

  // 2. Local TCP/IP stack
  let started = Instant::now();
  let loopback = probe::ping_series("loopback", Ipv4Addr::LOCALHOST, 2, Duration::from_millis(50), 1000);
  steps.push(if loopback.received > 0 {
    Step::new("stack", "This computer (TCP/IP stack)", StepStatus::Pass, "The local TCP/IP stack answers on 127.0.0.1.", started)
  } else {
    Step::new(
      "stack",
      "This computer (TCP/IP stack)",
      StepStatus::Fail,
      format!("127.0.0.1 did not answer. {}", loopback.last_error.unwrap_or_default()),
      started,
    )
    .hint("Reset Winsock and the TCP/IP stack, then restart the computer.")
  });

  // 3. IP address
  let started = Instant::now();
  let ip_ok = match &adapter {
    None => {
      steps.push(Step::skipped("ip_address", "IP address"));
      false
    }
    Some(a) => match a.ipv4_address() {
      None => {
        steps.push(
          Step::new("ip_address", "IP address", StepStatus::Fail, format!("{} has no IPv4 address.", a.name), started)
            .hint("Renew the DHCP address, or check the static IPv4 settings."),
        );
        false
      }
      Some(_) if a.apipa => {
        steps.push(
          Step::new(
            "ip_address",
            "IP address",
            StepStatus::Fail,
            format!("{} only has a self-assigned 169.254.x.x address: no DHCP server answered.", a.name),
            started,
          )
          .hint("Renew the DHCP address. If that fails, restart the router and check the cable or Wi-Fi connection."),
        );
        false
      }
      Some(ip) => {
        let prefix = a.ipv4.iter().find(|e| e.address == ip.to_string()).map(|e| e.prefix_length).unwrap_or(0);
        let source = if a.dhcp_enabled == Some(true) { "assigned by DHCP" } else { "static" };
        steps.push(Step::new("ip_address", "IP address", StepStatus::Pass, format!("{ip}/{prefix} ({source})."), started));
        true
      }
    },
  };

  // 4. Default gateway (final status decided after the internet test)
  let started = Instant::now();
  let gateway = adapter.as_ref().and_then(Adapter::ipv4_gateway);
  let gateway_stats = match (ip_ok, gateway) {
    (true, Some(gw)) => Some(probe::ping_series("gateway", gw, 4, Duration::from_millis(200), 1000)),
    _ => None,
  };
  let gateway_elapsed = started;

  // 5. Public IP connectivity
  let started = Instant::now();
  let internet_ok = if ip_ok {
    let pings: Vec<PingStats> = std::thread::scope(|scope| {
      let handles: Vec<_> = PUBLIC_TARGETS
        .iter()
        .map(|&ip| scope.spawn(move || probe::ping_series("internet", ip, 3, Duration::from_millis(200), 1500)))
        .collect();
      handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    let tcp = probe::first_reachable(&internet_targets(), Duration::from_secs(3));
    let best = pings.iter().filter(|p| p.received > 0).min_by(|a, b| a.avg_ms.partial_cmp(&b.avg_ms).unwrap());
    let (status, detail) = match (best, &tcp) {
      (Some(p), _) => (StepStatus::Pass, ping_detail(p)),
      (None, Ok((addr, ms))) => (
        StepStatus::Pass,
        format!("Ping is blocked, but a connection to {} succeeded in {ms} ms.", addr.ip()),
      ),
      (None, Err(e)) => (StepStatus::Fail, format!("1.1.1.1 and 8.8.8.8 are unreachable by ping and HTTPS. {e}.")),
    };
    let mut step = Step::new("internet_ip", "Internet (public IP)", status, detail, started);
    if status == StepStatus::Fail {
      step = step.hint(
        "The local network works but the internet does not. Restart the modem/router, check its internet light, or contact the internet provider.",
      );
    }
    let ok = step.status == StepStatus::Pass;
    // Insert the gateway result first so steps stay in network order.
    steps.push(gateway_step(gateway, gateway_stats.as_ref(), ok, ip_ok, gateway_elapsed));
    steps.push(step);
    ok
  } else {
    steps.push(gateway_step(gateway, None, false, false, gateway_elapsed));
    steps.push(Step::skipped("internet_ip", "Internet (public IP)"));
    false
  };

  // 6. DNS resolution
  let started = Instant::now();
  let resolved = if ip_ok {
    let lookup = dns::resolve_system(TEST_DOMAIN, Duration::from_secs(5));
    let configured = adapter.as_ref().map(|a| a.dns_servers.clone()).unwrap_or_default();
    let step = match &lookup {
      Ok(l) => Step::new(
        "dns",
        "DNS resolution",
        StepStatus::Pass,
        format!(
          "{TEST_DOMAIN} resolved to {} in {} ms (DNS servers: {}).",
          l.addresses.iter().take(2).map(IpAddr::to_string).collect::<Vec<_>>().join(", "),
          l.elapsed_ms,
          if configured.is_empty() { "none listed".into() } else { configured.join(", ") }
        ),
        started,
      ),
      Err(e) => {
        // Ask the configured server directly to tell "server down" from "cache/client issue".
        let direct = configured
          .iter()
          .filter_map(|s| s.parse::<IpAddr>().ok())
          .next()
          .map(|server| (server, dns::query_server(server, TEST_DOMAIN, Duration::from_secs(3))));
        let extra = match &direct {
          Some((server, Ok(_))) => format!(" However, {server} answered a direct query, so the local DNS cache or client may be at fault."),
          Some((server, Err(e))) => format!(" A direct query to {server} also failed: {e}"),
          None => " No DNS servers are configured on the active adapter.".into(),
        };
        let hint = if internet_ok {
          "The internet works but names do not resolve. Flush the DNS cache; if that does not help, set the adapter's DNS servers to 1.1.1.1 and 8.8.8.8 or restart the router."
        } else {
          "Fix the internet connection first; DNS needs it."
        };
        Step::new("dns", "DNS resolution", StepStatus::Fail, format!("{e}{extra}"), started).hint(hint)
      }
    };
    steps.push(step);
    lookup.ok()
  } else {
    steps.push(Step::skipped("dns", "DNS resolution"));
    None
  };

  // 7. Web connection
  let started = Instant::now();
  match resolved.and_then(|l| l.addresses.into_iter().next()) {
    Some(addr) if internet_ok => {
      let result = probe::tcp_check(SocketAddr::new(addr, 443), Duration::from_secs(4));
      steps.push(match result {
        Ok(ms) => Step::new("web", "Website connection", StepStatus::Pass, format!("Connected to {TEST_DOMAIN} (HTTPS) in {ms} ms."), started),
        Err(e) => Step::new("web", "Website connection", StepStatus::Fail, e, started)
          .hint("A firewall, proxy or security software may be blocking web traffic."),
      });
    }
    _ => steps.push(Step::skipped("web", "Website connection")),
  }

  conclude(steps, adapter.map(|a| a.name))
}

fn gateway_step(gateway: Option<Ipv4Addr>, stats: Option<&PingStats>, internet_ok: bool, ip_ok: bool, started: Instant) -> Step {
  const TITLE: &str = "Default gateway (router)";
  match (gateway, stats) {
    _ if !ip_ok => Step::skipped("gateway", TITLE),
    (None, _) => Step::new("gateway", TITLE, StepStatus::Fail, "No default gateway is configured.", started)
      .hint("Renew the DHCP address, or add the router's address as the gateway in the static IPv4 settings."),
    (Some(_), Some(s)) if s.received > 0 => Step::new("gateway", TITLE, StepStatus::Pass, ping_detail(s), started),
    (Some(gw), _) if internet_ok => Step::new(
      "gateway",
      TITLE,
      StepStatus::Warn,
      format!("{gw} did not answer ping, but the internet is reachable, so the router probably just blocks ping."),
      started,
    ),
    (Some(_), Some(s)) => Step::new("gateway", TITLE, StepStatus::Fail, ping_detail(s), started)
      .hint("Check the cable or Wi-Fi signal and restart the router. Make sure you are on the right network."),
    (Some(gw), None) => Step::new("gateway", TITLE, StepStatus::Fail, format!("{gw} was not tested."), started),
  }
}

fn conclude(steps: Vec<Step>, adapter_name: Option<String>) -> DiagnosticReport {
  let failed = steps.iter().find(|s| s.status == StepStatus::Fail);
  let warned = steps.iter().any(|s| s.status == StepStatus::Warn);
  let (summary, recommended_repairs) = match failed.map(|s| s.id) {
    None if warned => ("The connection works, with warnings. See the details below.".to_string(), vec![]),
    None => ("All tests passed. The network connection is working.".to_string(), vec![]),
    Some("adapter") => ("This computer is not connected to a network.".into(), vec![]),
    Some("stack") => (
      "Windows' TCP/IP networking components are not working.".into(),
      vec![RepairAction::ResetWinsock, RepairAction::ResetTcpip],
    ),
    Some("ip_address") => ("The computer did not get a valid IP address from the network (DHCP).".into(), vec![RepairAction::RenewDhcp]),
    Some("gateway") => ("The computer cannot reach the router (default gateway).".into(), vec![RepairAction::RenewDhcp]),
    Some("internet_ip") => ("The router is reachable, but the internet is not.".into(), vec![]),
    Some("dns") => (
      "The internet is reachable by IP address, but domain names cannot be resolved (DNS).".into(),
      vec![RepairAction::FlushDns],
    ),
    Some("web") => ("DNS works, but websites cannot be reached. A firewall or proxy may be blocking them.".into(), vec![]),
    Some(_) => ("A test failed. See the details below.".into(), vec![]),
  };
  DiagnosticReport {
    run_id: None,
    healthy: failed.is_none(),
    failure_point: failed.map(|s| s.title.clone()),
    summary,
    recommended_repairs,
    adapter_name,
    steps,
  }
}

// ---------------------------------------------------------------------------
// Performance

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceResult {
  pub run_id: Option<i64>,
  pub gateway: Option<PingStats>,
  pub internet: PingStats,
  pub adapter_name: Option<String>,
  pub connection_type: Option<AdapterKind>,
  /// Negotiated adapter link speed. This is not internet throughput.
  pub link_speed_bps: Option<u64>,
  pub quality: &'static str,
  pub assessment: String,
}

/// Pings the router and an internet host side by side, so local and
/// upstream problems can be told apart.
pub fn performance(target_label: &str, target: Ipv4Addr, count: u32) -> PerformanceResult {
  let adapter = adapters::list_enabled().ok().and_then(active_adapter);
  let gateway = adapter.as_ref().and_then(Adapter::ipv4_gateway);
  let interval = Duration::from_millis(250);

  let (gateway_stats, internet) = std::thread::scope(|scope| {
    let gw = gateway.map(|gw| scope.spawn(move || probe::ping_series("Default gateway", gw, count, interval, 1000)));
    let internet = probe::ping_series(target_label, target, count, interval, 2000);
    (gw.and_then(|h| h.join().ok()), internet)
  });

  let (quality, assessment) = assess(gateway_stats.as_ref(), &internet);
  PerformanceResult {
    run_id: None,
    adapter_name: adapter.as_ref().map(|a| a.name.clone()),
    connection_type: adapter.as_ref().map(|a| a.kind),
    link_speed_bps: adapter.as_ref().and_then(|a| a.link_speed_bps),
    gateway: gateway_stats,
    internet,
    quality,
    assessment,
  }
}

fn assess(gateway: Option<&PingStats>, internet: &PingStats) -> (&'static str, String) {
  if internet.received == 0 {
    return ("Unreachable", format!("{} did not answer any of {} requests.", internet.target, internet.sent));
  }
  let avg = internet.avg_ms.unwrap_or_default();
  let jitter = internet.jitter_ms.unwrap_or_default();
  let loss = internet.loss_percent;
  let quality = if loss > 5.0 || avg > 150.0 || jitter > 50.0 {
    "Poor"
  } else if loss > 1.0 || avg > 80.0 || jitter > 20.0 {
    "Fair"
  } else {
    "Good"
  };

  let local_loss = gateway.map(|g| g.loss_percent).unwrap_or(0.0);
  let local_avg = gateway.and_then(|g| g.avg_ms).unwrap_or(0.0);
  let location = if quality == "Good" {
    "Suitable for browsing, streaming and video calls.".to_string()
  } else if gateway.is_some() && (local_loss > 1.0 || local_avg > 20.0) {
    "The router link itself shows loss or delay, so the problem is on the local network: check the cable, Wi-Fi signal strength or interference.".to_string()
  } else if gateway.is_some() {
    "The router link is clean, so the delay or loss is upstream: the internet provider or a busy internet connection.".to_string()
  } else {
    "The router could not be tested separately.".to_string()
  };
  (quality, format!("{loss:.0}% loss, {avg:.0} ms average, {jitter:.1} ms jitter. {location}"))
}

pub fn performance_logs(result: &PerformanceResult) -> Vec<LogLine> {
  let line = |s: &PingStats| {
    format!(
      "{} ({}): sent {}, received {}, loss {:.0}%, min/avg/max {}/{}/{} ms, jitter {} ms",
      s.target,
      s.address,
      s.sent,
      s.received,
      s.loss_percent,
      s.min_ms.map_or("-".into(), |v| v.to_string()),
      s.avg_ms.map_or("-".into(), |v| format!("{v:.1}")),
      s.max_ms.map_or("-".into(), |v| v.to_string()),
      s.jitter_ms.map_or("-".into(), |v| format!("{v:.1}")),
    )
  };
  let mut logs = Vec::new();
  if let Some(name) = &result.adapter_name {
    logs.push(LogLine::new(
      Level::Info,
      format!(
        "Adapter: {name}, link speed {} (link speed is the adapter connection, not internet throughput)",
        result.link_speed_bps.map_or("unknown".into(), format_bps)
      ),
    ));
  }
  if let Some(gw) = &result.gateway {
    logs.push(LogLine::new(if gw.loss_percent > 1.0 { Level::Warning } else { Level::Info }, line(gw)));
  }
  let level = match result.quality {
    "Good" => Level::Info,
    "Fair" => Level::Warning,
    _ => Level::Error,
  };
  logs.push(LogLine::new(level, line(&result.internet)));
  logs.push(LogLine::new(level, format!("Quality: {}. {}", result.quality, result.assessment)));
  logs
}

#[cfg(test)]
mod tests {
  use super::*;

  fn step(id: &'static str, status: StepStatus) -> Step {
    Step::new(id, id, status, "", Instant::now())
  }

  #[test]
  fn first_failure_is_the_failure_point() {
    let report = conclude(
      vec![step("adapter", StepStatus::Pass), step("dns", StepStatus::Fail), step("web", StepStatus::Skip)],
      None,
    );
    assert!(!report.healthy);
    assert_eq!(report.failure_point.as_deref(), Some("dns"));
    assert_eq!(report.recommended_repairs, vec![RepairAction::FlushDns]);
  }

  #[test]
  fn all_passing_is_healthy() {
    let report = conclude(vec![step("adapter", StepStatus::Pass), step("gateway", StepStatus::Warn)], None);
    assert!(report.healthy);
    assert!(report.summary.contains("warnings"));
  }

  #[test]
  fn link_speeds_are_humanized() {
    assert_eq!(format_bps(1_000_000_000), "1 Gbps");
    assert_eq!(format_bps(2_500_000_000), "2.5 Gbps");
    assert_eq!(format_bps(866_700_000), "867 Mbps");
  }

  #[test]
  fn upstream_problems_are_told_apart_from_local_ones() {
    let clean = probe::summarize("gw", Ipv4Addr::LOCALHOST, vec![Some(2); 10], None);
    let lossy = probe::summarize("net", Ipv4Addr::LOCALHOST, vec![Some(30), None, Some(30), None, Some(30)], None);
    let (quality, text) = assess(Some(&clean), &lossy);
    assert_eq!(quality, "Poor");
    assert!(text.contains("upstream"));
  }
}
