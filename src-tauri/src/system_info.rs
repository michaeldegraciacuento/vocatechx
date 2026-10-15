use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System, MINIMUM_CPU_UPDATE_INTERVAL};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
  pub host_name: Option<String>,
  pub os: OsInfo,
  pub cpu: CpuInfo,
  /// `None` when the OS did not report memory figures.
  pub memory: Option<MemoryInfo>,
  pub storage: Vec<DiskInfo>,
  pub uptime_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
  pub name: Option<String>,
  pub version: Option<String>,
  pub long_version: Option<String>,
  pub kernel_version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
  pub brand: Option<String>,
  pub physical_cores: Option<usize>,
  pub logical_cores: usize,
  pub usage_percent: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
  pub total_bytes: u64,
  pub used_bytes: u64,
  pub available_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
  pub name: String,
  pub mount_point: String,
  pub file_system: String,
  pub total_bytes: u64,
  pub available_bytes: u64,
  pub removable: bool,
}

/// Keeps one `System` alive so CPU usage is measured between consecutive
/// refreshes, which is how sysinfo computes it.
pub struct SystemMonitor(Mutex<MonitorState>);

struct MonitorState {
  system: System,
  last_refresh: Instant,
}

fn refresh_kind() -> RefreshKind {
  RefreshKind::nothing()
    .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
    .with_memory(MemoryRefreshKind::nothing().with_ram())
}

impl SystemMonitor {
  pub fn new() -> Self {
    Self(Mutex::new(MonitorState {
      system: System::new_with_specifics(refresh_kind()),
      last_refresh: Instant::now(),
    }))
  }

  pub fn snapshot(&self) -> SystemOverview {
    let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());

    let elapsed = state.last_refresh.elapsed();
    if elapsed < MINIMUM_CPU_UPDATE_INTERVAL {
      std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL - elapsed);
    }
    state.system.refresh_specifics(refresh_kind());
    state.last_refresh = Instant::now();

    let system = &state.system;
    let cpus = system.cpus();
    let brand = cpus
      .first()
      .map(|cpu| cpu.brand().trim().to_string())
      .filter(|brand| !brand.is_empty());

    let memory = (system.total_memory() > 0).then(|| MemoryInfo {
      total_bytes: system.total_memory(),
      used_bytes: system.used_memory(),
      available_bytes: system.available_memory(),
    });

    let storage = Disks::new_with_refreshed_list()
      .list()
      .iter()
      .filter(|disk| disk.total_space() > 0)
      .map(|disk| DiskInfo {
        name: disk.name().to_string_lossy().into_owned(),
        mount_point: disk.mount_point().to_string_lossy().into_owned(),
        file_system: disk.file_system().to_string_lossy().into_owned(),
        total_bytes: disk.total_space(),
        available_bytes: disk.available_space(),
        removable: disk.is_removable(),
      })
      .collect();

    SystemOverview {
      host_name: System::host_name(),
      os: OsInfo {
        name: System::name(),
        version: System::os_version(),
        long_version: System::long_os_version(),
        kernel_version: System::kernel_version(),
      },
      cpu: CpuInfo {
        brand,
        physical_cores: system.physical_core_count(),
        logical_cores: cpus.len(),
        usage_percent: (!cpus.is_empty()).then(|| system.global_cpu_usage()),
      },
      memory,
      storage,
      uptime_seconds: System::uptime(),
    }
  }
}
