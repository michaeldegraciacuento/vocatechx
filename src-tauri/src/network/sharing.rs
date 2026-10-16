//! Windows file sharing (SMB): this computer's shares and sessions, finding
//! shared folders on other computers, connection checks, and explanations
//! for the credential and permission errors people actually hit.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::diagnostics::{Step, StepStatus};
use super::process::{self, Elevated};
use super::{dns, probe, sys, validate};
use crate::error::{AppError, AppResult};

const SMB_PORT: u16 = 445;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetError {
  pub code: u32,
  pub title: String,
  pub explanation: String,
  pub hint: String,
}

/// Plain-language explanations for the Windows errors SMB access produces.
pub fn describe_error(code: u32) -> NetError {
  let (title, explanation, hint) = match code {
    5 => (
      "Access denied",
      "The account you are signed in with does not have permission to this resource.",
      "On the other computer, check the share permissions (Advanced Sharing) and the folder's Security tab. Or connect with an account that has access: open the path in File Explorer and enter that account's user name and password.",
    ),
    53 => (
      "Network path not found",
      "The computer could not be reached over file sharing.",
      "Check the computer name or use its IP address. Make sure both computers are on the same network, File and Printer Sharing is on, the network is set to Private, and the firewall allows SMB (port 445).",
    ),
    64 => (
      "Connection dropped",
      "The network connection to the computer was lost during the request.",
      "Check the network connection on both computers and try again.",
    ),
    67 => (
      "Share not found",
      "The computer was reached, but it has no share with that name.",
      "Check the spelling of the share name, or list the computer's shares to see the available names.",
    ),
    86 | 1326 => (
      "Wrong user name or password",
      "The other computer rejected the credentials.",
      "Use an account that exists on the other computer, written as COMPUTER-NAME\\username, and check the password. Accounts without a password cannot sign in over the network.",
    ),
    1219 => (
      "Conflicting credentials",
      "This computer is already connected to that computer with a different user name.",
      "Disconnect the existing connections to that computer (see Connections from this computer), or restart, then connect again with one account.",
    ),
    1222 | 1231 => (
      "Network unreachable",
      "This computer is not connected to a network that can reach the other computer.",
      "Check this computer's network connection first (run the connectivity diagnostics).",
    ),
    1232 => ("Host unreachable", "The other computer did not respond.", "Make sure it is turned on, awake and connected to the same network."),
    1272 => (
      "Guest access blocked",
      "The other computer only allows guest (password-less) access, which Windows blocks for security.",
      "Create a user account with a password on the other computer and give it access to the share, then connect with that account.",
    ),
    1327 => (
      "Account restriction",
      "The account may have a blank password, or it is not allowed to sign in over the network.",
      "Set a password on the account, or use a different account.",
    ),
    1330 => ("Password expired", "The account's password has expired.", "Change the password on the other computer, then try again."),
    1331 => ("Account disabled", "The account is disabled on the other computer.", "Enable the account or use a different one."),
    1909 => ("Account locked out", "Too many failed sign-ins locked the account.", "Wait for the lockout to expire or ask the administrator to unlock it."),
    2114 => (
      "Server service not running",
      "The Server service (LanmanServer), which provides file sharing, is stopped.",
      "Use the \"Start file sharing services\" repair, or start the Server service in services.msc.",
    ),
    2138 => (
      "Workstation service not running",
      "The Workstation service (LanmanWorkstation), which this computer uses to open shared folders, is stopped.",
      "Use the \"Start file sharing services\" repair, or start the Workstation service in services.msc and set it to Automatic.",
    ),
    2184 => (
      "Browse service not running",
      "The service that keeps Windows' old network computer list is not running. This is normal on Windows 10 and 11.",
      "Use the devices found on the local network below, or type the computer's name or IP address.",
    ),
    6118 => (
      "No browse list",
      "Windows' old Computer Browser list is unavailable. This is normal on Windows 10 and 11.",
      "Use the devices found on the local network below, or type the computer's name or IP address.",
    ),
    sys::NOT_SUPPORTED => ("Not supported", "This feature is not supported on this system.", "File sharing tools require Windows."),
    _ => ("Windows error", "Windows reported an error.", "Try again, or run the connectivity diagnostics."),
  };
  NetError {
    code,
    title: title.into(),
    explanation: if title == "Windows error" { format!("Windows reported error {code}.") } else { explanation.into() },
    hint: hint.into(),
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
  pub name: String,
  pub kind: &'static str,
  /// Administrative shares such as `C$`, `ADMIN$` and `IPC$`.
  pub special: bool,
  pub remark: Option<String>,
  pub path: Option<String>,
  pub current_uses: Option<u32>,
  pub unc: String,
}

fn convert_share(host: &str, entry: sys::ShareEntry) -> Share {
  Share {
    unc: format!(r"\\{host}\{}", entry.name),
    kind: match entry.kind {
      0 => "folder",
      1 => "printer",
      2 => "device",
      3 => "ipc",
      _ => "other",
    },
    special: entry.special,
    remark: Some(entry.remark).filter(|r| !r.is_empty()),
    path: entry.path,
    current_uses: entry.current_uses,
    name: entry.name,
  }
}

fn sorted(mut shares: Vec<Share>) -> Vec<Share> {
  shares.sort_by_key(|s| (s.special, s.kind != "folder", s.name.to_lowercase()));
  shares
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing<T> {
  pub items: Vec<T>,
  pub error: Option<NetError>,
}

impl<T> Listing<T> {
  fn from(result: Result<Vec<T>, u32>) -> Self {
    match result {
      Ok(items) => Self { items, error: None },
      Err(code) => Self { items: Vec::new(), error: Some(describe_error(code)) },
    }
  }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
  pub client: String,
  pub user: String,
  pub active_seconds: u32,
  pub idle_seconds: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
  pub local: Option<String>,
  pub remote: String,
  pub status: &'static str,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NetworkProfile {
  pub name: String,
  pub interface_alias: String,
  /// `Public`, `Private` or `DomainAuthenticated`.
  pub category: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuleState {
  /// Firewall rules in the group that apply to the current network profile.
  pub total: u32,
  pub enabled: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServiceState {
  pub name: String,
  pub display_name: String,
  pub status: String,
  pub start_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscoveryStatus {
  pub profiles: Vec<NetworkProfile>,
  pub network_discovery: RuleState,
  pub file_sharing: RuleState,
  pub services: Vec<ServiceState>,
}

const DISCOVERY_SCRIPT: &str = r#"
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; interfaceAlias = [string]$_.InterfaceAlias; category = [string]$_.NetworkCategory }
})
# The firewall COM API is readable without administrator rights (unlike
# Get-NetFirewallRule) and does not depend on the Windows display language.
$fw = New-Object -ComObject HNetCfg.FwPolicy2
$active = $fw.CurrentProfileTypes
$inbound = @($fw.Rules | Where-Object { $_.Direction -eq 1 })
function RuleState([string]$group) {
  $applicable = @($inbound | Where-Object { $_.Grouping -eq $group -and ($_.Profiles -band $active) -ne 0 })
  [ordered]@{ total = $applicable.Count; enabled = @($applicable | Where-Object { $_.Enabled }).Count }
}
$services = @(Get-Service -Name FDResPub, fdPHost, LanmanServer, LanmanWorkstation, SSDPSRV -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; status = [string]$_.Status; startType = [string]$_.StartType }
})
$result = [ordered]@{
  profiles = $profiles
  networkDiscovery = RuleState '@FirewallAPI.dll,-32752'
  fileSharing = RuleState '@FirewallAPI.dll,-28502'
  services = $services
}
ConvertTo-Json -InputObject $result -Depth 4 -Compress
"#;

fn discovery_status() -> Result<DiscoveryStatus, String> {
  let output = process::powershell(DISCOVERY_SCRIPT, Duration::from_secs(45))?;
  if !output.success() {
    return Err(format!("Could not read the sharing settings: {}", output.text()));
  }
  serde_json::from_str(output.stdout.trim()).map_err(|e| format!("Could not read the sharing settings: {e}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingOverview {
  pub computer_name: Option<String>,
  pub local_shares: Listing<Share>,
  pub sessions: Listing<Session>,
  pub connections: Listing<Connection>,
  pub discovery: Option<DiscoveryStatus>,
  pub discovery_error: Option<String>,
  /// This computer accepts SMB connections (the Server service is listening).
  pub smb_server_listening: bool,
  pub elevated: bool,
}

pub fn overview() -> SharingOverview {
  let computer_name = std::env::var("COMPUTERNAME").ok();
  let host = computer_name.clone().unwrap_or_else(|| "localhost".into());
  let (discovery, listening) = std::thread::scope(|scope| {
    let discovery = scope.spawn(discovery_status);
    let listening = probe::tcp_check(SocketAddr::from((Ipv4Addr::LOCALHOST, SMB_PORT)), Duration::from_secs(2)).is_ok();
    (discovery.join().unwrap_or_else(|_| Err("Could not read the sharing settings.".into())), listening)
  });

  SharingOverview {
    local_shares: Listing::from(sys::shares(None).map(|list| sorted(list.into_iter().map(|e| convert_share(&host, e)).collect()))),
    sessions: Listing::from(sys::sessions().map(|list| {
      list
        .into_iter()
        .map(|s| Session { client: s.client, user: s.user, active_seconds: s.active_seconds, idle_seconds: s.idle_seconds })
        .collect()
    })),
    connections: Listing::from(sys::connections().map(|list| {
      list
        .into_iter()
        .map(|u| Connection {
          local: u.local,
          remote: u.remote,
          status: match u.status {
            0 => "Connected",
            1 => "Paused",
            2 => "Disconnected",
            3 => "Network error",
            4 => "Connecting",
            5 => "Reconnecting",
            _ => "Unknown",
          },
        })
        .collect()
    })),
    discovery_error: discovery.as_ref().err().cloned(),
    discovery: discovery.ok(),
    smb_server_listening: listening,
    elevated: sys::is_elevated(),
    computer_name,
  }
}

// ---------------------------------------------------------------------------
// Discovery

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredComputer {
  pub name: Option<String>,
  pub address: Option<String>,
  pub mac: Option<String>,
  /// `browse_list` (named by Windows) or `neighbor` (seen on the local network).
  pub source: &'static str,
  /// Port 445 accepted a connection, i.e. the device offers file sharing.
  pub smb_open: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
  pub computers: Vec<DiscoveredComputer>,
  pub browse_error: Option<NetError>,
}

fn is_private(ip: Ipv4Addr) -> bool {
  ip.is_private() || ip.is_link_local()
}

pub fn discover() -> Discovery {
  let own = std::env::var("COMPUTERNAME").unwrap_or_default();
  let (browse, browse_error) = match sys::browse_list() {
    Ok(list) => (list.into_iter().filter(|s| !s.name.eq_ignore_ascii_case(&own)).collect::<Vec<_>>(), None),
    Err(code) => (Vec::new(), Some(describe_error(code))),
  };
  let neighbors: Vec<sys::Neighbor> =
    sys::neighbors().unwrap_or_default().into_iter().filter(|n| is_private(n.ip)).take(256).collect();

  let mut computers: Vec<DiscoveredComputer> = browse
    .into_iter()
    .map(|s| DiscoveredComputer { name: Some(s.name), address: None, mac: None, source: "browse_list", smb_open: false })
    .chain(neighbors.into_iter().map(|n| DiscoveredComputer {
      name: None,
      address: Some(n.ip.to_string()),
      mac: Some(n.mac),
      source: "neighbor",
      smb_open: false,
    }))
    .collect();

  // Probe port 445 on every candidate, 32 at a time.
  for chunk in computers.chunks_mut(32) {
    std::thread::scope(|scope| {
      for computer in chunk.iter_mut() {
        scope.spawn(move || {
          let target = computer.address.clone().or_else(|| computer.name.clone()).unwrap_or_default();
          let addr = (target.as_str(), SMB_PORT).to_socket_addrs().ok().and_then(|mut it| it.find(SocketAddr::is_ipv4));
          if let Some(addr) = addr {
            if computer.address.is_none() {
              computer.address = Some(addr.ip().to_string());
            }
            computer.smb_open = probe::tcp_check(addr, Duration::from_millis(800)).is_ok();
          }
        });
      }
    });
  }

  computers.sort_by_key(|c| (!c.smb_open, c.name.is_none(), c.address.as_ref().and_then(|a| a.parse::<Ipv4Addr>().ok())));
  Discovery { computers, browse_error }
}

// ---------------------------------------------------------------------------
// Remote shares and checks

/// The Workstation service (SMB client) is stopped, so no shared folder on
/// another computer can be opened.
pub fn workstation_stopped() -> bool {
  matches!(sys::connections(), Err(2138))
}

/// Damage that stops the Workstation service from starting at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkstationDefect {
  None,
  /// `Parameters\ServiceDll` is missing, so svchost cannot find the service
  /// ("The system cannot find the file specified", event 7023).
  RegistrationMissing,
  /// `wkssvc.dll` itself is missing from System32.
  DllFileMissing,
}

/// Checks the Workstation service's installation. Needs no administrator rights.
pub fn workstation_defect() -> WorkstationDefect {
  if !process::system32("wkssvc.dll").is_file() {
    return WorkstationDefect::DllFileMissing;
  }
  // reg.exe exits with 1 when the value does not exist; the exit code does not
  // depend on the Windows display language.
  let query = process::run(
    &process::system32("reg.exe"),
    &["query", r"HKLM\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters", "/v", "ServiceDll"],
    Duration::from_secs(10),
  );
  match query {
    Ok(output) if output.code == Some(1) => WorkstationDefect::RegistrationMissing,
    _ => WorkstationDefect::None,
  }
}

const WORKSTATION_EVENT_SCRIPT: &str = r#"
$name = (Get-Service -Name LanmanWorkstation).DisplayName
Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; Id = 7000, 7001, 7023, 7024; StartTime = (Get-Date).AddMinutes(-10) } -MaxEvents 50 -ErrorAction SilentlyContinue |
  Where-Object { $_.Properties.Count -gt 0 -and $_.Properties[0].Value -eq $name } |
  Select-Object -First 1 -ExpandProperty Message
"#;

/// Windows' own explanation for the latest failed Workstation start in the
/// last 10 minutes, from the System event log.
pub fn workstation_start_error() -> Option<String> {
  let output = process::powershell(WORKSTATION_EVENT_SCRIPT, Duration::from_secs(30)).ok()?;
  let message = output.stdout.split_whitespace().collect::<Vec<_>>().join(" ");
  (!message.is_empty()).then_some(message)
}

pub fn list_shares(host: &str) -> Result<Vec<Share>, NetError> {
  sys::shares(Some(host))
    .map(|list| sorted(list.into_iter().map(|e| convert_share(host, e)).collect()))
    .map_err(explain_remote_error)
}

/// A stopped Workstation service makes every remote path look "not found";
/// report the real cause instead.
fn explain_remote_error(code: u32) -> NetError {
  if code == 53 && workstation_stopped() { describe_error(2138) } else { describe_error(code) }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbCheck {
  pub run_id: Option<i64>,
  pub host: String,
  pub steps: Vec<Step>,
  pub healthy: bool,
  pub summary: String,
  pub shares: Vec<Share>,
}

fn step(id: &'static str, title: &str, status: StepStatus, detail: impl Into<String>, started: Instant, hint: Option<String>) -> Step {
  Step {
    id,
    title: title.into(),
    status,
    detail: detail.into(),
    hint,
    duration_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
  }
}

/// Walks through name resolution, reachability, the SMB port and share
/// access, stopping at the first hard failure.
pub fn check_smb(host: &str) -> SmbCheck {
  let mut steps = Vec::new();
  let mut shares = Vec::new();
  let skip = |id, title: &str| step(id, title, StepStatus::Skip, "Skipped because an earlier test failed.", Instant::now(), None);

  // 0. This computer's SMB client. NetUseEnum fails with 2138 when it is stopped.
  let started = Instant::now();
  if workstation_stopped() {
    let error = describe_error(2138);
    let detail = match workstation_defect() {
      WorkstationDefect::RegistrationMissing => format!(
        "{} It cannot start because its registration is damaged: the ServiceDll registry value is missing.",
        error.explanation
      ),
      WorkstationDefect::DllFileMissing => format!("{} Its program file, wkssvc.dll, is missing from Windows.", error.explanation),
      WorkstationDefect::None => error.explanation,
    };
    steps.push(step("client", "This computer's file sharing client", StepStatus::Fail, detail, started, Some(error.hint)));
    for (id, title) in [
      ("resolve", "Find the computer"),
      ("ping", "Reachability (ping)"),
      ("smb_port", "File sharing port (SMB 445)"),
      ("shares", "Shared folders"),
    ] {
      steps.push(skip(id, title));
    }
    return finish_check(host, steps, shares);
  }
  steps.push(step(
    "client",
    "This computer's file sharing client",
    StepStatus::Pass,
    "The Workstation service is running.",
    started,
    None,
  ));

  // 1. Name resolution
  let started = Instant::now();
  let address: Option<IpAddr> = match host.parse::<Ipv4Addr>() {
    Ok(ip) => {
      steps.push(step("resolve", "Find the computer", StepStatus::Pass, format!("Using the IP address {ip}."), started, None));
      Some(IpAddr::V4(ip))
    }
    Err(_) => match dns::resolve_system(host, Duration::from_secs(6)) {
      Ok(lookup) => {
        let ip = lookup.addresses.iter().find(|a| a.is_ipv4()).or(lookup.addresses.first()).copied();
        steps.push(step(
          "resolve",
          "Find the computer",
          StepStatus::Pass,
          format!("{host} is at {}.", lookup.addresses.iter().map(IpAddr::to_string).collect::<Vec<_>>().join(", ")),
          started,
          None,
        ));
        ip
      }
      Err(e) => {
        steps.push(step(
          "resolve",
          "Find the computer",
          StepStatus::Fail,
          format!("{host} could not be found: {e}"),
          started,
          Some("Check the computer name, or use its IP address (run ipconfig on that computer). Both computers must be on the same network, with network discovery turned on.".into()),
        ));
        None
      }
    },
  };

  let Some(address) = address else {
    steps.push(skip("ping", "Reachability (ping)"));
    steps.push(skip("smb_port", "File sharing port (SMB 445)"));
    steps.push(skip("shares", "Shared folders"));
    return finish_check(host, steps, shares);
  };

  // 2. Ping (informational: Windows blocks ping by default on Public networks)
  let started = Instant::now();
  match address {
    IpAddr::V4(v4) => {
      let stats = probe::ping_series(host, v4, 3, Duration::from_millis(150), 1000);
      steps.push(if stats.received > 0 {
        step("ping", "Reachability (ping)", StepStatus::Pass, format!("{v4} answered {} of 3 pings.", stats.received), started, None)
      } else {
        step(
          "ping",
          "Reachability (ping)",
          StepStatus::Warn,
          format!("{v4} did not answer ping. Windows' firewall blocks ping by default, so this alone is not a problem."),
          started,
          None,
        )
      });
    }
    IpAddr::V6(_) => steps.push(skip("ping", "Reachability (ping)")),
  }

  // 3. SMB port
  let started = Instant::now();
  let port = probe::tcp_check(SocketAddr::new(address, SMB_PORT), Duration::from_secs(3));
  match port {
    Ok(ms) => steps.push(step(
      "smb_port",
      "File sharing port (SMB 445)",
      StepStatus::Pass,
      format!("{address} accepts file sharing connections ({ms} ms)."),
      started,
      None,
    )),
    Err(e) => {
      steps.push(step(
        "smb_port",
        "File sharing port (SMB 445)",
        StepStatus::Fail,
        e,
        started,
        Some("On the other computer: turn on File and Printer Sharing (Advanced sharing settings), set the network to Private, and make sure its firewall allows File and Printer Sharing.".into()),
      ));
      steps.push(skip("shares", "Shared folders"));
      return finish_check(host, steps, shares);
    }
  }

  // 4. Shares
  let started = Instant::now();
  match list_shares(host) {
    Ok(list) => {
      let visible: Vec<&Share> = list.iter().filter(|s| !s.special && s.kind == "folder").collect();
      steps.push(if visible.is_empty() {
        step(
          "shares",
          "Shared folders",
          StepStatus::Warn,
          "Connected, but the computer has no shared folders (only administrative shares).",
          started,
          Some("Share a folder on that computer: right-click the folder > Properties > Sharing.".into()),
        )
      } else {
        step(
          "shares",
          "Shared folders",
          StepStatus::Pass,
          format!(
            "{} shared folder{}: {}.",
            visible.len(),
            if visible.len() == 1 { "" } else { "s" },
            visible.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ")
          ),
          started,
          None,
        )
      });
      shares = list;
    }
    Err(error) => steps.push(step(
      "shares",
      "Shared folders",
      StepStatus::Fail,
      format!("{}: {}", error.title, error.explanation),
      started,
      Some(error.hint),
    )),
  }

  finish_check(host, steps, shares)
}

fn finish_check(host: &str, steps: Vec<Step>, shares: Vec<Share>) -> SmbCheck {
  let failed = steps.iter().find(|s| s.status == StepStatus::Fail);
  let summary = match failed {
    None => format!("File sharing with {host} works."),
    Some(s) => format!("File sharing with {host} failed at: {}.", s.title),
  };
  SmbCheck { run_id: None, host: host.into(), healthy: failed.is_none(), summary, steps, shares }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessResult {
  pub path: String,
  pub ok: bool,
  /// Number of items in the folder, when it could be listed.
  pub entries: Option<usize>,
  pub error: Option<NetError>,
}

/// Tries to list a network folder with the current user's credentials.
pub fn test_access(path: &validate::UncPath) -> AccessResult {
  let (tx, rx) = mpsc::channel();
  let full = path.full.clone();
  std::thread::spawn(move || {
    let result = std::fs::read_dir(Path::new(&full)).map(|entries| entries.take(10_000).count());
    let _ = tx.send(result);
  });
  let base = AccessResult { path: path.full.clone(), ok: false, entries: None, error: None };
  match rx.recv_timeout(Duration::from_secs(45)) {
    Ok(Ok(count)) => AccessResult { ok: true, entries: Some(count), ..base },
    Ok(Err(e)) => AccessResult {
      error: Some(match e.raw_os_error() {
        Some(code) => explain_remote_error(code as u32),
        None => NetError { code: 0, title: "Could not open the folder".into(), explanation: e.to_string(), hint: String::new() },
      }),
      ..base
    },
    Err(_) => AccessResult {
      error: Some(NetError {
        code: 0,
        title: "No response".into(),
        explanation: "The computer did not respond within 45 seconds.".into(),
        hint: "Run the file sharing check for this computer to see where the connection stops.".into(),
      }),
      ..base
    },
  }
}

/// Opens a network folder in File Explorer, which prompts for credentials if needed.
pub fn open_in_explorer(path: &validate::UncPath) -> AppResult<()> {
  process::launch(&process::windows_dir("explorer.exe"), &[&path.full]).map_err(AppError::Network)
}

// ---------------------------------------------------------------------------
// Configure sharing on this computer

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShareAccess {
  Read,
  Change,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareChange {
  pub run_id: Option<i64>,
  pub status: super::repair::RepairStatus,
  pub message: String,
}

fn local_share_exists(name: &str) -> Option<bool> {
  sys::shares(None).ok().map(|list| list.iter().any(|s| s.name.eq_ignore_ascii_case(name)))
}

fn change(status: super::repair::RepairStatus, message: impl Into<String>) -> ShareChange {
  ShareChange { run_id: None, status, message: message.into() }
}

/// Shares a folder with Everyone (by well-known SID, so it works on any
/// Windows language). Folder (NTFS) permissions still apply on top.
pub fn create_share(name: &str, folder: &Path, access: ShareAccess) -> AppResult<ShareChange> {
  use super::repair::RepairStatus;

  if local_share_exists(name) == Some(true) {
    return Err(AppError::validation(format!("A share named \"{name}\" already exists on this computer.")));
  }
  let access_flag = match access {
    ShareAccess::Read => "-ReadAccess",
    ShareAccess::Change => "-ChangeAccess",
  };
  let script = format!(
    "$ErrorActionPreference = 'Stop'\n\
     $everyone = (New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')).Translate([System.Security.Principal.NTAccount]).Value\n\
     New-SmbShare -Name {} -Path {} {access_flag} $everyone | Out-Null",
    process::ps_quote(name),
    process::ps_quote(&folder.to_string_lossy()),
  );
  match process::powershell_elevated(&script, Duration::from_secs(90)).map_err(AppError::Network)? {
    Elevated::Cancelled => Ok(change(RepairStatus::Cancelled, "The Windows administrator prompt was declined, so nothing was changed.")),
    Elevated::Completed(output) => {
      if local_share_exists(name) == Some(true) {
        let level = if access == ShareAccess::Read { "read-only" } else { "read and write" };
        Ok(change(
          RepairStatus::Success,
          format!(
            r"Shared {} as \\{}\{name} with {level} access for network users. Their access is also limited by the folder's own Security (NTFS) permissions.",
            folder.display(),
            std::env::var("COMPUTERNAME").unwrap_or_else(|_| "THIS-PC".into())
          ),
        ))
      } else {
        let detail = output.text();
        Ok(change(
          RepairStatus::Failed,
          if detail.is_empty() {
            "Windows could not create the share. The folder may be on a drive that cannot be shared.".to_string()
          } else {
            format!("Windows could not create the share: {detail}")
          },
        ))
      }
    }
  }
}

pub fn remove_share(name: &str) -> AppResult<ShareChange> {
  use super::repair::RepairStatus;

  if local_share_exists(name) == Some(false) {
    return Err(AppError::validation(format!("There is no share named \"{name}\" on this computer.")));
  }
  let script = format!("$ErrorActionPreference = 'Stop'\nRemove-SmbShare -Name {} -Force", process::ps_quote(name));
  match process::powershell_elevated(&script, Duration::from_secs(60)).map_err(AppError::Network)? {
    Elevated::Cancelled => Ok(change(RepairStatus::Cancelled, "The Windows administrator prompt was declined, so nothing was changed.")),
    Elevated::Completed(output) => Ok(if local_share_exists(name) == Some(false) {
      change(RepairStatus::Success, format!("Stopped sharing \"{name}\". The folder and its files were not changed."))
    } else {
      change(RepairStatus::Failed, format!("Windows could not stop sharing \"{name}\". {}", output.text()))
    }),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn common_errors_have_specific_explanations() {
    assert_eq!(describe_error(1326).title, "Wrong user name or password");
    assert_eq!(describe_error(86).title, "Wrong user name or password");
    assert_eq!(describe_error(53).title, "Network path not found");
    assert!(describe_error(99999).explanation.contains("99999"));
  }

  #[test]
  fn shares_sort_folders_before_admin_shares() {
    let entry = |name: &str, kind, special| sys::ShareEntry {
      name: name.into(),
      kind,
      special,
      remark: String::new(),
      path: None,
      current_uses: None,
    };
    let shares = sorted(vec![
      convert_share("pc", entry("C$", 0, true)),
      convert_share("pc", entry("Printer", 1, false)),
      convert_share("pc", entry("Projects", 0, false)),
    ]);
    let names: Vec<_> = shares.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["Projects", "Printer", "C$"]);
    assert_eq!(shares[0].unc, r"\\pc\Projects");
  }
}
