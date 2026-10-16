//! Network adapters as shown in Network Center.

use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::process;
use super::sys::{self, RawAdapter, IF_TYPE_ETHERNET, IF_TYPE_LOOPBACK, IF_TYPE_TUNNEL, IF_TYPE_WIFI};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
  Ethernet,
  Wifi,
  Virtual,
  Other,
}

impl AdapterKind {
  pub fn label(self) -> &'static str {
    match self {
      Self::Ethernet => "Ethernet",
      Self::Wifi => "Wi-Fi",
      Self::Virtual => "Virtual",
      Self::Other => "Other",
    }
  }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterStatus {
  Connected,
  Disconnected,
  Disabled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpEntry {
  pub address: String,
  pub prefix_length: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
  pub id: String,
  pub name: String,
  pub description: String,
  pub kind: AdapterKind,
  pub status: AdapterStatus,
  pub mac: Option<String>,
  pub ipv4: Vec<IpEntry>,
  pub ipv6: Vec<IpEntry>,
  /// IPv4 gateways first.
  pub gateways: Vec<String>,
  pub dns_servers: Vec<String>,
  /// `None` for disabled adapters, whose configuration Windows does not report.
  pub dhcp_enabled: Option<bool>,
  pub dhcp_server: Option<String>,
  /// Negotiated link speed in bits per second, as reported by the driver.
  pub link_speed_bps: Option<u64>,
  pub mtu: Option<u32>,
  pub dns_suffix: Option<String>,
  /// Carries the default route, i.e. the adapter used to reach the internet.
  pub is_primary: bool,
  /// Has only a self-assigned 169.254.x.x address, usually a DHCP failure.
  pub apipa: bool,
}

impl Adapter {
  pub fn ipv4_address(&self) -> Option<Ipv4Addr> {
    self.ipv4.iter().filter_map(|e| e.address.parse::<Ipv4Addr>().ok()).find(|ip| !is_apipa(*ip)).or_else(|| {
      self.ipv4.first().and_then(|e| e.address.parse().ok())
    })
  }

  pub fn ipv4_gateway(&self) -> Option<Ipv4Addr> {
    self.gateways.iter().filter_map(|g| g.parse::<Ipv4Addr>().ok()).find(|g| !g.is_unspecified())
  }
}

pub fn is_apipa(ip: Ipv4Addr) -> bool {
  ip.octets()[0] == 169 && ip.octets()[1] == 254
}

const VIRTUAL_HINTS: &[&str] = &[
  "virtual", "hyper-v", "vmware", "virtualbox", "vbox", "tap-", "wan miniport", "vpn", "wireguard", "tailscale", "zerotier",
  "npcap", "wintun", "loopback", "teredo", "isatap", "6to4", "kernel debug", "wi-fi direct", "docker", "vethernet",
];

fn kind(raw: &RawAdapter, virtual_flag: Option<bool>) -> AdapterKind {
  let description = raw.description.to_lowercase();
  if virtual_flag == Some(true) || VIRTUAL_HINTS.iter().any(|h| description.contains(h) || raw.name.to_lowercase().contains(h)) {
    return AdapterKind::Virtual;
  }
  if description.contains("bluetooth") {
    return AdapterKind::Other;
  }
  match raw.if_type {
    IF_TYPE_WIFI => AdapterKind::Wifi,
    IF_TYPE_ETHERNET => AdapterKind::Ethernet,
    _ => AdapterKind::Other,
  }
}

fn has_ipv4_gateway(raw: &RawAdapter) -> bool {
  raw.gateways.iter().any(|g| matches!(g, IpAddr::V4(v4) if !v4.is_unspecified()))
}

/// The connected adapter that carries the IPv4 default route (lowest metric wins).
fn primary_guid(raws: &[RawAdapter]) -> Option<String> {
  raws
    .iter()
    .filter(|r| r.up && has_ipv4_gateway(r) && !r.ipv4.is_empty())
    .min_by_key(|r| r.ipv4_metric)
    .map(|r| r.guid.clone())
}

fn convert(raw: &RawAdapter, primary: Option<&str>, virtual_flag: Option<bool>) -> Adapter {
  // Like ipconfig's "Media disconnected": addresses Windows keeps on an
  // unplugged adapter (169.254.x.x, default DNS) are not in use, so hide them.
  if !raw.up {
    let mut adapter = convert(&RawAdapter { up: true, ..raw.clone() }, None, virtual_flag);
    adapter.status = AdapterStatus::Disconnected;
    adapter.ipv4.clear();
    adapter.ipv6.clear();
    adapter.gateways.clear();
    adapter.dns_servers.clear();
    adapter.dhcp_server = None;
    adapter.link_speed_bps = None;
    adapter.apipa = false;
    return adapter;
  }
  let mut gateways: Vec<IpAddr> = raw.gateways.clone();
  gateways.sort_by_key(|g| g.is_ipv6());
  let ipv4: Vec<IpEntry> =
    raw.ipv4.iter().map(|(ip, prefix)| IpEntry { address: ip.to_string(), prefix_length: *prefix }).collect();
  let apipa = !raw.ipv4.is_empty() && raw.ipv4.iter().all(|(ip, _)| is_apipa(*ip));
  Adapter {
    id: raw.guid.clone(),
    name: raw.name.clone(),
    description: raw.description.clone(),
    kind: kind(raw, virtual_flag),
    status: if raw.up { AdapterStatus::Connected } else { AdapterStatus::Disconnected },
    mac: raw.mac.clone(),
    ipv4,
    ipv6: raw.ipv6.iter().map(|(ip, prefix)| IpEntry { address: ip.to_string(), prefix_length: *prefix }).collect(),
    gateways: gateways.iter().map(IpAddr::to_string).collect(),
    dns_servers: raw.dns_servers.iter().map(IpAddr::to_string).collect(),
    dhcp_enabled: Some(raw.dhcp_enabled),
    dhcp_server: raw.dhcp_server.filter(|_| raw.dhcp_enabled).map(|ip| ip.to_string()),
    link_speed_bps: raw.up.then_some(raw.receive_bps.or(raw.transmit_bps)).flatten(),
    mtu: (raw.mtu > 0 && raw.mtu != u32::MAX).then_some(raw.mtu),
    dns_suffix: Some(raw.dns_suffix.clone()).filter(|s| !s.is_empty()),
    is_primary: primary == Some(raw.guid.as_str()),
    apipa: raw.up && apipa,
  }
}

fn listed(raw: &RawAdapter) -> bool {
  raw.if_type != IF_TYPE_LOOPBACK && raw.if_type != IF_TYPE_TUNNEL
}

/// Adapters Windows reports as present (enabled), from the IP Helper API.
/// Fast enough to poll.
pub fn list_enabled() -> Result<Vec<Adapter>, String> {
  let raws = sys::adapters().map_err(|code| format!("Windows could not list network adapters (error {code})."))?;
  let primary = primary_guid(&raws);
  let mut adapters: Vec<Adapter> = raws.iter().filter(|r| listed(r)).map(|r| convert(r, primary.as_deref(), None)).collect();
  sort(&mut adapters);
  Ok(adapters)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetAdapterInfo {
  guid: String,
  name: String,
  description: String,
  status: String,
  mac: Option<String>,
  #[serde(rename = "virtual")]
  is_virtual: bool,
}

const GET_NET_ADAPTER: &str = r#"
$items = @(Get-NetAdapter | ForEach-Object {
  [ordered]@{
    guid = [string]$_.InterfaceGuid
    name = [string]$_.Name
    description = [string]$_.InterfaceDescription
    status = [string]$_.Status
    mac = [string]$_.MacAddress
    virtual = [bool]$_.Virtual
  }
})
ConvertTo-Json -InputObject $items -Compress
"#;

/// Every adapter, including disabled ones, which only `Get-NetAdapter`
/// reports. Falls back to the enabled list if PowerShell is unavailable.
pub fn list_all() -> Result<Vec<Adapter>, String> {
  let raws = sys::adapters().map_err(|code| format!("Windows could not list network adapters (error {code})."))?;
  let primary = primary_guid(&raws);

  let extra: Vec<NetAdapterInfo> = match process::powershell(GET_NET_ADAPTER, Duration::from_secs(20)) {
    Ok(output) if output.success() => serde_json::from_str(output.stdout.trim()).unwrap_or_else(|e| {
      log::warn!("could not parse Get-NetAdapter output: {e}");
      Vec::new()
    }),
    Ok(output) => {
      log::warn!("Get-NetAdapter failed: {}", output.text());
      Vec::new()
    }
    Err(e) => {
      log::warn!("Get-NetAdapter failed: {e}");
      Vec::new()
    }
  };

  let key = |guid: &str| guid.trim_matches(|c| c == '{' || c == '}').to_ascii_uppercase();
  let virtual_flag = |guid: &str| extra.iter().find(|e| key(&e.guid) == key(guid)).map(|e| e.is_virtual);

  let mut adapters: Vec<Adapter> =
    raws.iter().filter(|r| listed(r)).map(|r| convert(r, primary.as_deref(), virtual_flag(&r.guid))).collect();
  let known: HashSet<String> = raws.iter().map(|r| key(&r.guid)).collect();

  for info in extra.iter().filter(|e| e.status.eq_ignore_ascii_case("Disabled") && !known.contains(&key(&e.guid))) {
    let description = info.description.to_lowercase();
    let kind = if info.is_virtual || VIRTUAL_HINTS.iter().any(|h| description.contains(h)) {
      AdapterKind::Virtual
    } else if description.contains("wireless") || description.contains("wi-fi") || description.contains("802.11") || description.contains("wlan") {
      AdapterKind::Wifi
    } else if description.contains("bluetooth") {
      AdapterKind::Other
    } else {
      AdapterKind::Ethernet
    };
    adapters.push(Adapter {
      id: info.guid.clone(),
      name: info.name.clone(),
      description: info.description.clone(),
      kind,
      status: AdapterStatus::Disabled,
      mac: info.mac.clone().filter(|m| !m.is_empty()),
      ipv4: Vec::new(),
      ipv6: Vec::new(),
      gateways: Vec::new(),
      dns_servers: Vec::new(),
      dhcp_enabled: None,
      dhcp_server: None,
      link_speed_bps: None,
      mtu: None,
      dns_suffix: None,
      is_primary: false,
      apipa: false,
    });
  }

  sort(&mut adapters);
  Ok(adapters)
}

/// Primary first, then connected physical adapters, then the rest.
fn sort(adapters: &mut [Adapter]) {
  adapters.sort_by_key(|a| {
    let status = match a.status {
      AdapterStatus::Connected => 0,
      AdapterStatus::Disconnected => 1,
      AdapterStatus::Disabled => 2,
    };
    (!a.is_primary, status, a.kind == AdapterKind::Virtual, a.name.to_lowercase())
  });
}

/// The SSID of the connected Wi-Fi network, from `netsh wlan show interfaces`.
pub fn wifi_ssid() -> Option<String> {
  let output = process::run(&process::system32("netsh.exe"), &["wlan", "show", "interfaces"], Duration::from_secs(8)).ok()?;
  parse_ssid(&output.stdout)
}

fn parse_ssid(text: &str) -> Option<String> {
  text.lines().find_map(|line| {
    let (key, value) = line.split_once(':')?;
    (key.trim() == "SSID").then(|| value.trim().to_string()).filter(|v| !v.is_empty())
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ssid_is_read_but_bssid_is_not() {
    let text = "    Name                   : Wi-Fi\n    SSID                   : Lab Network\n    BSSID                  : aa:bb:cc:dd:ee:ff\n";
    assert_eq!(parse_ssid(text), Some("Lab Network".into()));
    assert_eq!(parse_ssid("There is no wireless interface on the system."), None);
  }

  #[test]
  fn apipa_detection() {
    assert!(is_apipa(Ipv4Addr::new(169, 254, 10, 2)));
    assert!(!is_apipa(Ipv4Addr::new(192, 168, 1, 2)));
  }

  #[cfg(windows)]
  #[test]
  fn lists_adapters_on_this_machine() {
    // Smoke test: the API call succeeds and loopback is filtered out.
    let adapters = list_enabled().unwrap();
    assert!(adapters.iter().all(|a| !a.description.to_lowercase().contains("loopback pseudo")));
  }
}
