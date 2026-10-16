//! Quick repairs. Each one runs a built-in Windows tool, asks for
//! administrator rights through UAC when Windows requires them, and checks
//! the result where it can instead of trusting the exit code alone.

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::adapters::{self, AdapterKind, AdapterStatus};
use super::process::{self, CommandOutput, Elevated};
use super::sharing::WorkstationDefect;
use super::{probe, sharing};
use super::report::{Level, LogLine};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepairAction {
  FlushDns,
  RenewDhcp,
  ResetWinsock,
  ResetTcpip,
  StartSharingServices,
}

impl RepairAction {
  pub fn title(self) -> &'static str {
    match self {
      Self::FlushDns => "Flush DNS cache",
      Self::RenewDhcp => "Renew DHCP IP address",
      Self::ResetWinsock => "Reset Winsock",
      Self::ResetTcpip => "Reset TCP/IP stack",
      Self::StartSharingServices => "Start file sharing services",
    }
  }

  fn command(self) -> &'static str {
    match self {
      Self::FlushDns => "ipconfig /flushdns",
      Self::RenewDhcp => "ipconfig /renew",
      Self::ResetWinsock => "netsh winsock reset",
      Self::ResetTcpip => "netsh int ip reset",
      Self::StartSharingServices => "Start-Service LanmanWorkstation, LanmanServer",
    }
  }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepairStatus {
  Success,
  /// Completed, but Windows reported a problem with part of it.
  Partial,
  Failed,
  /// The user declined the administrator prompt.
  Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairOutcome {
  pub run_id: Option<i64>,
  pub action: RepairAction,
  pub title: &'static str,
  pub status: RepairStatus,
  pub message: String,
  /// Tool output, when it could be captured.
  pub output: Option<String>,
  pub restart_required: bool,
}

impl RepairOutcome {
  fn new(action: RepairAction, status: RepairStatus, message: impl Into<String>) -> Self {
    Self { run_id: None, action, title: action.title(), status, message: message.into(), output: None, restart_required: false }
  }

  fn output(mut self, output: &CommandOutput) -> Self {
    let text = output.text();
    self.output = (!text.is_empty()).then_some(text);
    self
  }

  pub fn logs(&self) -> Vec<LogLine> {
    let level = match self.status {
      RepairStatus::Success => Level::Info,
      RepairStatus::Partial | RepairStatus::Cancelled => Level::Warning,
      RepairStatus::Failed => Level::Error,
    };
    let mut logs = vec![
      LogLine::new(Level::Info, format!("Repair attempted: {} ({})", self.title, self.action.command())),
      LogLine::new(level, self.message.clone()),
    ];
    if let Some(output) = &self.output {
      logs.push(LogLine::new(Level::Info, format!("Output:\n{output}")));
    }
    if self.restart_required {
      logs.push(LogLine::new(Level::Warning, "A restart is required to finish this repair."));
    }
    logs
  }
}

const UAC_DECLINED: &str = "The Windows administrator prompt was declined, so nothing was changed.";

fn elevated(action: RepairAction, program: &str, args: &[&str], timeout: Duration) -> Result<CommandOutput, RepairOutcome> {
  match process::run_elevated(&process::system32(program), args, timeout) {
    Ok(Elevated::Completed(output)) => Ok(output),
    Ok(Elevated::Cancelled) => Err(RepairOutcome::new(action, RepairStatus::Cancelled, UAC_DECLINED)),
    Err(e) => Err(RepairOutcome::new(action, RepairStatus::Failed, e)),
  }
}

pub fn run(action: RepairAction) -> RepairOutcome {
  match action {
    RepairAction::FlushDns => flush_dns(),
    RepairAction::RenewDhcp => renew_dhcp(),
    RepairAction::ResetWinsock | RepairAction::ResetTcpip => reset_stack(action),
    RepairAction::StartSharingServices => start_sharing_services(),
  }
}

/// Restores the Workstation service's Windows-default `ServiceDll` value. Only
/// added to the script when that value is missing.
const RESTORE_WORKSTATION_DLL: &str = r"
$params = 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters'
New-ItemProperty -Path $params -Name ServiceDll -PropertyType ExpandString -Value '%SystemRoot%\System32\wkssvc.dll' -Force | Out-Null
New-ItemProperty -Path $params -Name ServiceDllUnloadOnStop -PropertyType DWord -Value 1 -Force | Out-Null
";

/// Sets the Workstation (SMB client) and Server (SMB server) services to start
/// automatically and starts them. If the Workstation service cannot start
/// because its registration is damaged (missing `ServiceDll`), the Windows
/// default is restored first.
fn start_sharing_services() -> RepairOutcome {
  let action = RepairAction::StartSharingServices;

  let defect = sharing::workstation_defect();
  if defect == WorkstationDefect::DllFileMissing {
    return RepairOutcome::new(
      action,
      RepairStatus::Failed,
      "The Workstation service's program file (wkssvc.dll) is missing from Windows, so the service cannot start. \
       Run System File Checker as administrator (sfc /scannow) to restore Windows system files, then restart.",
    );
  }
  let restore = defect == WorkstationDefect::RegistrationMissing;

  let script = sharing_services_script(restore);
  let output = match process::powershell_elevated(&script, Duration::from_secs(90)) {
    Ok(Elevated::Completed(output)) => output,
    Ok(Elevated::Cancelled) => return RepairOutcome::new(action, RepairStatus::Cancelled, UAC_DECLINED),
    Err(e) => return RepairOutcome::new(action, RepairStatus::Failed, e),
  };

  let restored_note = if restore && sharing::workstation_defect() == WorkstationDefect::None {
    "Restored the Workstation service's missing registration (ServiceDll = %SystemRoot%\\System32\\wkssvc.dll, the Windows default). "
  } else {
    ""
  };
  let client = !sharing::workstation_stopped();
  let server = probe::tcp_check(SocketAddr::from((Ipv4Addr::LOCALHOST, 445)), Duration::from_secs(2)).is_ok();
  match (client, server) {
    (true, true) => RepairOutcome::new(
      action,
      RepairStatus::Success,
      format!("{restored_note}The Workstation and Server services are running and set to start automatically."),
    ),
    (true, false) => RepairOutcome::new(
      action,
      RepairStatus::Partial,
      format!(
        "{restored_note}The Workstation service is running, so this computer can open shared folders. The Server service is not accepting connections, so other computers cannot open this computer's shares."
      ),
    ),
    _ => {
      let reason = match sharing::workstation_start_error() {
        Some(event) => format!("Windows reported: \"{event}\""),
        None => "Windows did not record a reason. Check Event Viewer > Windows Logs > System for Service Control Manager errors.".into(),
      };
      RepairOutcome::new(action, RepairStatus::Failed, format!("{restored_note}The Workstation service could not be started. {reason}"))
    }
  }
  .output(&output)
}

/// The elevated script for [`start_sharing_services`]. Each service is
/// attempted even if the other fails; exit code 2 means a start failed.
fn sharing_services_script(restore_registration: bool) -> String {
  format!(
    "$ErrorActionPreference = 'Stop'
{}
$failed = $false
foreach ($name in 'LanmanServer', 'LanmanWorkstation') {{
  try {{
    Set-Service -Name $name -StartupType Automatic
    Start-Service -Name $name
  }} catch {{
    [Console]::Error.WriteLine(\"${{name}}: $($_.Exception.Message)\")
    $failed = $true
  }}
}}
if ($failed) {{ exit 2 }}",
    if restore_registration { RESTORE_WORKSTATION_DLL } else { "" }
  )
}

fn flush_dns() -> RepairOutcome {
  let action = RepairAction::FlushDns;
  match process::run(&process::system32("ipconfig.exe"), &["/flushdns"], Duration::from_secs(60)) {
    Ok(output) if output.success() => RepairOutcome::new(
      action,
      RepairStatus::Success,
      "The DNS resolver cache was cleared. Names will be looked up fresh from the DNS server.",
    )
    .output(&output),
    Ok(output) => RepairOutcome::new(action, RepairStatus::Failed, "ipconfig could not flush the DNS cache.").output(&output),
    Err(e) => RepairOutcome::new(action, RepairStatus::Failed, e),
  }
}

fn renew_dhcp() -> RepairOutcome {
  let action = RepairAction::RenewDhcp;
  let dhcp_adapters = |list: &[adapters::Adapter]| -> Vec<adapters::Adapter> {
    list
      .iter()
      .filter(|a| a.status == AdapterStatus::Connected && a.dhcp_enabled == Some(true) && a.kind != AdapterKind::Virtual)
      .cloned()
      .collect()
  };

  let before = match adapters::list_enabled() {
    Ok(list) => dhcp_adapters(&list),
    Err(e) => return RepairOutcome::new(action, RepairStatus::Failed, e),
  };
  if before.is_empty() {
    return RepairOutcome::new(
      action,
      RepairStatus::Failed,
      "No connected adapter uses DHCP, so there is no address to renew. Connect to the network first, or check whether the adapter uses a static IP address.",
    );
  }

  // ipconfig exits non-zero when any adapter (even a disconnected one) fails,
  // so the result is judged by the addresses afterwards instead.
  let output = match elevated(action, "ipconfig.exe", &["/renew"], Duration::from_secs(150)) {
    Ok(output) => output,
    Err(outcome) => return outcome,
  };

  let after = adapters::list_enabled().map(|l| dhcp_adapters(&l)).unwrap_or_default();
  let results: Vec<(String, Option<String>)> = before
    .iter()
    .map(|b| {
      let address = after.iter().find(|a| a.id == b.id).filter(|a| !a.apipa).and_then(|a| a.ipv4_address()).map(|ip| ip.to_string());
      (b.name.clone(), address)
    })
    .collect();
  let ok = results.iter().filter(|(_, a)| a.is_some()).count();
  let detail = results
    .iter()
    .map(|(name, addr)| match addr {
      Some(ip) => format!("{name}: {ip}"),
      None => format!("{name}: no valid address"),
    })
    .collect::<Vec<_>>()
    .join("; ");

  let outcome = if ok == results.len() {
    RepairOutcome::new(action, RepairStatus::Success, format!("New DHCP lease obtained. {detail}."))
  } else if ok > 0 {
    RepairOutcome::new(action, RepairStatus::Partial, format!("Only some adapters obtained an address. {detail}."))
  } else {
    RepairOutcome::new(
      action,
      RepairStatus::Failed,
      format!("No DHCP server answered. {detail}. Check the cable or Wi-Fi connection and restart the router."),
    )
  };
  outcome.output(&output)
}

fn reset_stack(action: RepairAction) -> RepairOutcome {
  let args: &[&str] = if action == RepairAction::ResetWinsock { &["winsock", "reset"] } else { &["int", "ip", "reset"] };
  let output = match elevated(action, "netsh.exe", args, Duration::from_secs(120)) {
    Ok(output) => output,
    Err(outcome) => return outcome,
  };
  let mut outcome = match (action, output.success()) {
    (RepairAction::ResetWinsock, true) => {
      RepairOutcome::new(action, RepairStatus::Success, "The Winsock catalog was reset to its default configuration.")
    }
    (_, true) => RepairOutcome::new(action, RepairStatus::Success, "TCP/IP settings were reset to their defaults."),
    // `netsh int ip reset` commonly fails on one protected registry key while
    // resetting everything else.
    (RepairAction::ResetTcpip, false) => RepairOutcome::new(
      action,
      RepairStatus::Partial,
      format!(
        "netsh finished with exit code {}. Some settings may not have been reset (one protected setting often reports \"Access is denied\"; that is usually harmless).",
        output.code.unwrap_or(-1)
      ),
    ),
    (_, false) => RepairOutcome::new(
      action,
      RepairStatus::Failed,
      format!("netsh reported an error (exit code {}).", output.code.unwrap_or(-1)),
    ),
  }
  .output(&output);
  outcome.restart_required = outcome.status != RepairStatus::Failed;
  outcome
}

/// Windows settings pages Network Center can open.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingsPage {
  NetworkStatus,
  WifiSettings,
  NetworkConnections,
  AdvancedSharing,
}

pub fn open_settings(page: SettingsPage) -> AppResult<()> {
  let result = match page {
    SettingsPage::NetworkStatus => process::launch(&process::windows_dir("explorer.exe"), &["ms-settings:network-status"]),
    SettingsPage::WifiSettings => process::launch(&process::windows_dir("explorer.exe"), &["ms-settings:network-wifi"]),
    SettingsPage::NetworkConnections => process::launch(&process::system32("control.exe"), &["ncpa.cpl"]),
    SettingsPage::AdvancedSharing => process::launch(
      &process::system32("control.exe"),
      &["/name", "Microsoft.NetworkAndSharingCenter", "/page", "Advanced"],
    ),
  };
  result.map_err(AppError::Network)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The elevated scripts cannot run in tests, so check that PowerShell parses them.
  #[cfg(windows)]
  #[test]
  fn sharing_services_scripts_parse() {
    for restore in [false, true] {
      let check = format!(
        "$errors = $null
[System.Management.Automation.Language.Parser]::ParseInput({}, [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count) {{ $errors | ForEach-Object {{ $_.Message }}; exit 1 }}",
        process::ps_quote(&sharing_services_script(restore))
      );
      let output = process::powershell(&check, Duration::from_secs(60)).unwrap();
      assert!(output.success(), "restore={restore}: {}", output.text());
    }
    assert!(sharing_services_script(true).contains("wkssvc.dll"));
    assert!(!sharing_services_script(false).contains("ServiceDll"));
  }
}
