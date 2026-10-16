//! Safe wrappers over the Windows networking APIs Network Center reads from.
//! Everything here is read-only. Other platforms get stubs that report
//! `ERROR_NOT_SUPPORTED`, so the rest of the module compiles everywhere.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// `ERROR_NOT_SUPPORTED`, returned by the non-Windows stubs.
#[cfg_attr(windows, allow(dead_code))]
pub const NOT_SUPPORTED: u32 = 50;

#[derive(Debug, Clone)]
pub struct RawAdapter {
  /// The adapter GUID, e.g. `{4D36E972-...}`.
  pub guid: String,
  pub name: String,
  pub description: String,
  pub if_type: u32,
  pub up: bool,
  pub mac: Option<String>,
  pub ipv4: Vec<(Ipv4Addr, u8)>,
  pub ipv6: Vec<(Ipv6Addr, u8)>,
  pub gateways: Vec<IpAddr>,
  pub dns_servers: Vec<IpAddr>,
  pub dns_suffix: String,
  pub dhcp_enabled: bool,
  pub dhcp_server: Option<IpAddr>,
  pub transmit_bps: Option<u64>,
  pub receive_bps: Option<u64>,
  pub mtu: u32,
  pub ipv4_metric: u32,
}

pub const IF_TYPE_ETHERNET: u32 = 6;
pub const IF_TYPE_WIFI: u32 = 71;
pub const IF_TYPE_LOOPBACK: u32 = 24;
pub const IF_TYPE_TUNNEL: u32 = 131;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PingReply {
  Reply { rtt_ms: u32 },
  Timeout,
  /// An ICMP status such as "destination host unreachable", or a Win32 error.
  Error { status: u32 },
}

#[derive(Debug, Clone)]
pub struct Neighbor {
  pub ip: Ipv4Addr,
  pub mac: String,
}

#[derive(Debug, Clone)]
pub struct ShareEntry {
  pub name: String,
  /// Low byte of the share type: 0 disk, 1 printer, 2 device, 3 IPC.
  pub kind: u32,
  /// Administrative shares such as `C$`, `ADMIN$` and `IPC$`.
  pub special: bool,
  pub remark: String,
  /// Only known for shares on this computer, and only when Windows allows it.
  pub path: Option<String>,
  pub current_uses: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct SessionEntry {
  pub client: String,
  pub user: String,
  pub active_seconds: u32,
  pub idle_seconds: u32,
}

#[derive(Debug, Clone)]
pub struct UseEntry {
  pub local: Option<String>,
  pub remote: String,
  pub status: u32,
}

#[derive(Debug, Clone)]
pub struct ServerEntry {
  pub name: String,
}

#[derive(Debug, Clone)]
pub struct WifiConnection {
  /// The interface GUID, matching `RawAdapter::guid`.
  pub interface_guid: String,
  /// The saved Wi-Fi profile in use (usually, but not always, the SSID).
  pub profile: String,
  pub ssid: String,
}

pub use imp::*;

#[cfg(windows)]
mod imp {
  use std::ffi::{c_char, c_void, CStr};
  use std::mem::size_of;
  use std::ptr;

  use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
  use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetAdaptersAddresses, GetIpNetTable2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, GAA_FLAG_INCLUDE_GATEWAYS,
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST, ICMP_ECHO_REPLY, IP_ADAPTER_ADDRESSES_LH, IP_ADAPTER_DHCP_ENABLED, IP_REQ_TIMED_OUT,
    IP_SUCCESS, MIB_IPNET_TABLE2,
  };
  use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
  use windows_sys::Win32::NetworkManagement::NetManagement::{
    NetApiBufferFree, NetServerEnum, NetUseEnum, MAX_PREFERRED_LENGTH, SERVER_INFO_101, SV_TYPE_WORKSTATION, USE_INFO_1,
  };
  use windows_sys::Win32::NetworkManagement::WiFi::{
    wlan_interface_state_connected, wlan_intf_opcode_current_connection, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory,
    WlanGetProfile, WlanOpenHandle, WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST,
    WLAN_PROFILE_GET_PLAINTEXT_KEY,
  };
  use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_INET, SOCKET_ADDRESS};
  use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
  use windows_sys::Win32::Storage::FileSystem::{NetSessionEnum, NetShareEnum, SESSION_INFO_10, SHARE_INFO_1, SHARE_INFO_2, STYPE_SPECIAL};
  use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

  use super::*;

  const ERROR_BUFFER_OVERFLOW: u32 = 111;
  const ERROR_NO_DATA: u32 = 232;
  const ERROR_MORE_DATA: u32 = 234;
  const SV_TYPE_SERVER: u32 = 2;

  /// Reads a NUL-terminated UTF-16 string owned by Windows.
  unsafe fn wide(p: *const u16) -> String {
    if p.is_null() {
      return String::new();
    }
    let mut len = 0;
    while unsafe { *p.add(len) } != 0 {
      len += 1;
    }
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(p, len) })
  }

  fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
  }

  /// Decodes an IPv4/IPv6 `SOCKADDR` without relying on union field layouts.
  unsafe fn socket_ip(addr: &SOCKET_ADDRESS) -> Option<IpAddr> {
    if addr.lpSockaddr.is_null() || addr.iSockaddrLength < 8 {
      return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(addr.lpSockaddr as *const u8, addr.iSockaddrLength as usize) };
    sockaddr_bytes_ip(bytes)
  }

  fn sockaddr_bytes_ip(bytes: &[u8]) -> Option<IpAddr> {
    match u16::from_ne_bytes([bytes[0], bytes[1]]) {
      2 if bytes.len() >= 8 => Some(IpAddr::V4(Ipv4Addr::new(bytes[4], bytes[5], bytes[6], bytes[7]))),
      23 if bytes.len() >= 24 => {
        let mut octets = [0u8; 16];
        octets.copy_from_slice(&bytes[8..24]);
        Some(IpAddr::V6(Ipv6Addr::from(octets)))
      }
      _ => None,
    }
  }

  fn format_mac(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 6 || bytes.iter().all(|&b| b == 0) || bytes.iter().all(|&b| b == 0xff) {
      return None;
    }
    Some(bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join("-"))
  }

  fn link_speed(bps: u64) -> Option<u64> {
    (bps != 0 && bps != u64::MAX).then_some(bps)
  }

  pub fn adapters() -> Result<Vec<RawAdapter>, u32> {
    let flags = GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST;
    let mut size: u32 = 32 * 1024;
    for _ in 0..4 {
      // u64 elements keep the buffer aligned for the structs Windows writes.
      let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
      let first = buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
      let rc = unsafe { GetAdaptersAddresses(0, flags, ptr::null(), first, &mut size) };
      match rc {
        0 => return Ok(unsafe { collect_adapters(first) }),
        ERROR_BUFFER_OVERFLOW => continue,
        ERROR_NO_DATA => return Ok(Vec::new()),
        error => return Err(error),
      }
    }
    Err(ERROR_BUFFER_OVERFLOW)
  }

  unsafe fn collect_adapters(mut node: *const IP_ADAPTER_ADDRESSES_LH) -> Vec<RawAdapter> {
    let mut out = Vec::new();
    while let Some(a) = unsafe { node.as_ref() } {
      let mut ipv4 = Vec::new();
      let mut ipv6 = Vec::new();
      let mut unicast = a.FirstUnicastAddress;
      while let Some(entry) = unsafe { unicast.as_ref() } {
        match unsafe { socket_ip(&entry.Address) } {
          Some(IpAddr::V4(ip)) => ipv4.push((ip, entry.OnLinkPrefixLength)),
          Some(IpAddr::V6(ip)) => ipv6.push((ip, entry.OnLinkPrefixLength)),
          None => {}
        }
        unicast = entry.Next;
      }

      let mut gateways = Vec::new();
      let mut gateway = a.FirstGatewayAddress;
      while let Some(entry) = unsafe { gateway.as_ref() } {
        gateways.extend(unsafe { socket_ip(&entry.Address) });
        gateway = entry.Next;
      }

      let mut dns_servers = Vec::new();
      let mut dns = a.FirstDnsServerAddress;
      while let Some(entry) = unsafe { dns.as_ref() } {
        dns_servers.extend(unsafe { socket_ip(&entry.Address) });
        dns = entry.Next;
      }

      let mac_len = (a.PhysicalAddressLength as usize).min(a.PhysicalAddress.len());
      let flags = unsafe { a.Anonymous2.Flags };
      let guid = if a.AdapterName.is_null() {
        String::new()
      } else {
        unsafe { CStr::from_ptr(a.AdapterName as *const c_char) }.to_string_lossy().into_owned()
      };

      out.push(RawAdapter {
        guid,
        name: unsafe { wide(a.FriendlyName) },
        description: unsafe { wide(a.Description) },
        if_type: a.IfType,
        up: a.OperStatus == IfOperStatusUp,
        mac: format_mac(&a.PhysicalAddress[..mac_len]),
        ipv4,
        ipv6,
        gateways,
        dns_servers,
        dns_suffix: unsafe { wide(a.DnsSuffix) },
        dhcp_enabled: flags & IP_ADAPTER_DHCP_ENABLED != 0,
        dhcp_server: unsafe { socket_ip(&a.Dhcpv4Server) },
        transmit_bps: link_speed(a.TransmitLinkSpeed),
        receive_bps: link_speed(a.ReceiveLinkSpeed),
        mtu: a.Mtu,
        ipv4_metric: a.Ipv4Metric,
      });
      node = a.Next;
    }
    out
  }

  /// Sends one ICMP echo request. Needs no administrator rights.
  pub fn ping(ip: Ipv4Addr, timeout_ms: u32) -> PingReply {
    let payload = [b'v'; 32];
    let mut reply = vec![0u64; (size_of::<ICMP_ECHO_REPLY>() + payload.len() + 64).div_ceil(8)];
    unsafe {
      let handle: HANDLE = IcmpCreateFile();
      if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        return PingReply::Error { status: GetLastError() };
      }
      let count = IcmpSendEcho(
        handle,
        u32::from_ne_bytes(ip.octets()),
        payload.as_ptr() as *const c_void,
        payload.len() as u16,
        ptr::null(),
        reply.as_mut_ptr() as *mut c_void,
        (reply.len() * 8) as u32,
        timeout_ms,
      );
      let error = GetLastError();
      IcmpCloseHandle(handle);
      if count == 0 {
        return if error == IP_REQ_TIMED_OUT { PingReply::Timeout } else { PingReply::Error { status: error } };
      }
      let echo = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
      match echo.Status {
        IP_SUCCESS => PingReply::Reply { rtt_ms: echo.RoundTripTime },
        IP_REQ_TIMED_OUT => PingReply::Timeout,
        status => PingReply::Error { status },
      }
    }
  }

  /// IPv4 entries in the ARP/neighbor cache: devices this computer has
  /// recently talked to on the local network.
  pub fn neighbors() -> Result<Vec<Neighbor>, u32> {
    let mut table: *mut MIB_IPNET_TABLE2 = ptr::null_mut();
    let rc = unsafe { GetIpNetTable2(AF_INET, &mut table) };
    if rc != 0 {
      return Err(rc);
    }
    let mut out = Vec::new();
    unsafe {
      let count = (*table).NumEntries as usize;
      let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
      for row in rows {
        // Skip unreachable/incomplete entries (states 0 and 1).
        if row.State < 2 {
          continue;
        }
        let bytes = std::slice::from_raw_parts(&row.Address as *const SOCKADDR_INET as *const u8, size_of::<SOCKADDR_INET>());
        let Some(IpAddr::V4(ip)) = sockaddr_bytes_ip(bytes) else { continue };
        let mac_len = (row.PhysicalAddressLength as usize).min(row.PhysicalAddress.len());
        let Some(mac) = format_mac(&row.PhysicalAddress[..mac_len]) else { continue };
        if ip.is_multicast() || ip.is_broadcast() || ip.is_unspecified() || ip.octets()[3] == 255 {
          continue;
        }
        out.push(Neighbor { ip, mac });
      }
      FreeMibTable(table as *const c_void);
    }
    Ok(out)
  }

  /// Frees a NetApi buffer when dropped.
  struct NetBuffer(*mut u8);

  impl Drop for NetBuffer {
    fn drop(&mut self) {
      if !self.0.is_null() {
        unsafe { NetApiBufferFree(self.0 as *const c_void) };
      }
    }
  }

  /// Runs a NetApi enumeration call that fills a buffer of `T` records.
  fn enumerate<T, R>(call: impl FnOnce(*mut *mut u8, *mut u32, *mut u32) -> u32, map: impl Fn(&T) -> R) -> Result<Vec<R>, u32> {
    let mut buffer: *mut u8 = ptr::null_mut();
    let mut read = 0u32;
    let mut total = 0u32;
    let rc = call(&mut buffer, &mut read, &mut total);
    let guard = NetBuffer(buffer);
    if rc != 0 && rc != ERROR_MORE_DATA {
      return Err(rc);
    }
    if guard.0.is_null() {
      return Ok(Vec::new());
    }
    let items = unsafe { std::slice::from_raw_parts(guard.0 as *const T, read as usize) };
    Ok(items.iter().map(map).collect())
  }

  fn server_name(host: Option<&str>) -> Option<Vec<u16>> {
    host.map(|h| to_wide(&format!(r"\\{h}")))
  }

  fn share_type(raw: u32) -> (u32, bool) {
    (raw & 0xff, raw & STYPE_SPECIAL != 0)
  }

  /// Shares on `host`, or on this computer when `host` is `None`.
  pub fn shares(host: Option<&str>) -> Result<Vec<ShareEntry>, u32> {
    let server = server_name(host);
    let server_ptr = server.as_ref().map_or(ptr::null(), |w| w.as_ptr());

    // Level 2 includes local paths but needs administrator rights.
    if host.is_none() {
      let detailed = enumerate(
        |buf, read, total| unsafe { NetShareEnum(server_ptr, 2, buf, MAX_PREFERRED_LENGTH, read, total, ptr::null_mut()) },
        |s: &SHARE_INFO_2| {
          let (kind, special) = share_type(s.shi2_type);
          ShareEntry {
            name: unsafe { wide(s.shi2_netname) },
            kind,
            special,
            remark: unsafe { wide(s.shi2_remark) },
            path: Some(unsafe { wide(s.shi2_path) }).filter(|p| !p.is_empty()),
            current_uses: Some(s.shi2_current_uses),
          }
        },
      );
      if let Ok(shares) = detailed {
        return Ok(shares);
      }
    }

    enumerate(
      |buf, read, total| unsafe { NetShareEnum(server_ptr, 1, buf, MAX_PREFERRED_LENGTH, read, total, ptr::null_mut()) },
      |s: &SHARE_INFO_1| {
        let (kind, special) = share_type(s.shi1_type);
        ShareEntry {
          name: unsafe { wide(s.shi1_netname) },
          kind,
          special,
          remark: unsafe { wide(s.shi1_remark) },
          path: None,
          current_uses: None,
        }
      },
    )
  }

  /// Other computers currently connected to this computer's shares.
  pub fn sessions() -> Result<Vec<SessionEntry>, u32> {
    enumerate(
      |buf, read, total| unsafe {
        NetSessionEnum(ptr::null(), ptr::null(), ptr::null(), 10, buf, MAX_PREFERRED_LENGTH, read, total, ptr::null_mut())
      },
      |s: &SESSION_INFO_10| SessionEntry {
        client: unsafe { wide(s.sesi10_cname) },
        user: unsafe { wide(s.sesi10_username) },
        active_seconds: s.sesi10_time,
        idle_seconds: s.sesi10_idle_time,
      },
    )
  }

  /// This computer's connections to shares on other computers.
  pub fn connections() -> Result<Vec<UseEntry>, u32> {
    enumerate(
      |buf, read, total| unsafe { NetUseEnum(ptr::null(), 1, buf, MAX_PREFERRED_LENGTH, read, total, ptr::null_mut()) },
      |u: &USE_INFO_1| UseEntry {
        local: Some(unsafe { wide(u.ui1_local) }).filter(|l| !l.is_empty()),
        remote: unsafe { wide(u.ui1_remote) },
        status: u.ui1_status,
      },
    )
  }

  /// The legacy Computer Browser list. Often empty on modern Windows.
  pub fn browse_list() -> Result<Vec<ServerEntry>, u32> {
    enumerate(
      |buf, read, total| unsafe {
        NetServerEnum(
          ptr::null(),
          101,
          buf,
          MAX_PREFERRED_LENGTH,
          read,
          total,
          SV_TYPE_WORKSTATION | SV_TYPE_SERVER,
          ptr::null(),
          ptr::null_mut(),
        )
      },
      |s: &SERVER_INFO_101| ServerEntry { name: unsafe { wide(s.sv101_name) } },
    )
  }

  /// An open WLAN API session, closed when dropped.
  struct Wlan(HANDLE);

  impl Wlan {
    fn open() -> Result<Self, u32> {
      let mut version = 0u32;
      let mut handle: HANDLE = ptr::null_mut();
      match unsafe { WlanOpenHandle(2, ptr::null(), &mut version, &mut handle) } {
        0 => Ok(Self(handle)),
        error => Err(error),
      }
    }

    fn interfaces(&self) -> Result<Vec<windows_sys::core::GUID>, u32> {
      let mut list: *mut WLAN_INTERFACE_INFO_LIST = ptr::null_mut();
      let rc = unsafe { WlanEnumInterfaces(self.0, ptr::null(), &mut list) };
      if rc != 0 {
        return Err(rc);
      }
      let guids = unsafe {
        let count = (*list).dwNumberOfItems as usize;
        let items = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), count);
        let guids = items.iter().filter(|i| i.isState == wlan_interface_state_connected).map(|i| i.InterfaceGuid).collect();
        WlanFreeMemory(list as *const c_void);
        guids
      };
      Ok(guids)
    }
  }

  impl Drop for Wlan {
    fn drop(&mut self) {
      unsafe { WlanCloseHandle(self.0, ptr::null()) };
    }
  }

  fn guid_string(g: &windows_sys::core::GUID) -> String {
    format!(
      "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
      g.data1, g.data2, g.data3, g.data4[0], g.data4[1], g.data4[2], g.data4[3], g.data4[4], g.data4[5], g.data4[6], g.data4[7]
    )
  }

  /// Wi-Fi interfaces that are connected, with the profile they use.
  pub fn wifi_connections() -> Result<Vec<WifiConnection>, u32> {
    let wlan = Wlan::open()?;
    let mut out = Vec::new();
    for guid in wlan.interfaces()? {
      let mut size = 0u32;
      let mut data: *mut c_void = ptr::null_mut();
      let rc = unsafe {
        WlanQueryInterface(wlan.0, &guid, wlan_intf_opcode_current_connection, ptr::null(), &mut size, &mut data, ptr::null_mut())
      };
      if rc != 0 || data.is_null() {
        continue;
      }
      unsafe {
        let attrs = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
        let ssid = &attrs.wlanAssociationAttributes.dot11Ssid;
        let ssid_len = (ssid.uSSIDLength as usize).min(ssid.ucSSID.len());
        out.push(WifiConnection {
          interface_guid: guid_string(&guid),
          profile: wide(attrs.strProfileName.as_ptr()),
          ssid: String::from_utf8_lossy(&ssid.ucSSID[..ssid_len]).into_owned(),
        });
        WlanFreeMemory(data);
      }
    }
    Ok(out)
  }

  /// A saved profile's XML. The key is only in plain text when VocaTechX
  /// runs as administrator; otherwise Windows returns it encrypted.
  pub fn wifi_profile_xml(profile: &str) -> Result<String, u32> {
    let wlan = Wlan::open()?;
    let name = to_wide(profile);
    let mut last_error = 1168; // ERROR_NOT_FOUND
    for guid in wlan.interfaces()? {
      let mut xml: windows_sys::core::PWSTR = ptr::null_mut();
      let mut flags = WLAN_PROFILE_GET_PLAINTEXT_KEY;
      let mut access = 0u32;
      let rc = unsafe { WlanGetProfile(wlan.0, &guid, name.as_ptr(), ptr::null(), &mut xml, &mut flags, &mut access) };
      if rc == 0 && !xml.is_null() {
        let text = unsafe { wide(xml) };
        unsafe { WlanFreeMemory(xml as *const c_void) };
        return Ok(text);
      }
      last_error = rc;
    }
    Err(last_error)
  }

  /// Whether VocaTechX itself is running as administrator.
  pub fn is_elevated() -> bool {
    unsafe {
      let mut token: HANDLE = ptr::null_mut();
      if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
        return false;
      }
      let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
      let mut returned = 0u32;
      let ok = GetTokenInformation(
        token,
        TokenElevation,
        &mut elevation as *mut TOKEN_ELEVATION as *mut c_void,
        size_of::<TOKEN_ELEVATION>() as u32,
        &mut returned,
      );
      CloseHandle(token);
      ok != 0 && elevation.TokenIsElevated != 0
    }
  }
}

#[cfg(not(windows))]
mod imp {
  use super::*;

  pub fn adapters() -> Result<Vec<RawAdapter>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn ping(_ip: Ipv4Addr, _timeout_ms: u32) -> PingReply {
    PingReply::Error { status: NOT_SUPPORTED }
  }
  pub fn neighbors() -> Result<Vec<Neighbor>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn shares(_host: Option<&str>) -> Result<Vec<ShareEntry>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn sessions() -> Result<Vec<SessionEntry>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn connections() -> Result<Vec<UseEntry>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn browse_list() -> Result<Vec<ServerEntry>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn is_elevated() -> bool {
    false
  }
  pub fn wifi_connections() -> Result<Vec<WifiConnection>, u32> {
    Err(NOT_SUPPORTED)
  }
  pub fn wifi_profile_xml(_profile: &str) -> Result<String, u32> {
    Err(NOT_SUPPORTED)
  }
}
