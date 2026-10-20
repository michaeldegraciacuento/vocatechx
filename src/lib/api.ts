import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export type SessionUser = {
  id: number;
  username: string;
  role: "admin" | "technician";
  mustChangePassword: boolean;
};

export type AppErrorCode =
  | "invalid_credentials"
  | "locked_out"
  | "unauthenticated"
  | "password_change_required"
  | "validation"
  | "ai"
  | "network"
  | "database"
  | "internal";

export type AppError = {
  code: AppErrorCode;
  message: string;
  retryAfterSeconds: number | null;
};

export type SystemOverview = {
  hostName: string | null;
  os: {
    name: string | null;
    version: string | null;
    longVersion: string | null;
    kernelVersion: string | null;
  };
  cpu: {
    brand: string | null;
    physicalCores: number | null;
    logicalCores: number;
    usagePercent: number | null;
  };
  memory: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
  storage: {
    name: string;
    mountPoint: string;
    fileSystem: string;
    totalBytes: number;
    availableBytes: number;
    removable: boolean;
  }[];
  uptimeSeconds: number;
};

export type ActivityItem = {
  id: number;
  operationType: string;
  title: string;
  status: "running" | "success" | "failed" | "cancelled";
  summary: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type RalpState = "runtime_missing" | "model_missing" | "stopped" | "starting" | "ready" | "error";

export type RalpStatus = {
  state: RalpState;
  message: string | null;
  modelName: string | null;
  /** Folder beside the installed app where the model file can be placed. */
  modelFolder: string;
};

export type ConversationSummary = { id: number; title: string; updatedAt: number };

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ChatEvent =
  | { type: "started"; conversationId: number; userMessage: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "done"; message: ChatMessage | null; cancelled: boolean };

export type ImportProgress = { copiedBytes: number; totalBytes: number };

export type SystemStatus = {
  databaseReady: boolean;
  schemaVersion: number;
  ralp: RalpStatus;
  networkRequired: boolean;
};

// ---------------------------------------------------------------------------
// Network Center

export type AdapterKind = "ethernet" | "wifi" | "virtual" | "other";
export type AdapterStatus = "connected" | "disconnected" | "disabled";
export type IpEntry = { address: string; prefixLength: number };

export type NetworkAdapter = {
  id: string;
  name: string;
  description: string;
  kind: AdapterKind;
  status: AdapterStatus;
  mac: string | null;
  ipv4: IpEntry[];
  ipv6: IpEntry[];
  gateways: string[];
  dnsServers: string[];
  dhcpEnabled: boolean | null;
  dhcpServer: string | null;
  /** Negotiated adapter link speed, not internet throughput. */
  linkSpeedBps: number | null;
  mtu: number | null;
  dnsSuffix: string | null;
  isPrimary: boolean;
  apipa: boolean;
};

export type NetworkHealth = {
  status: "connected" | "limited" | "disconnected";
  summary: string;
  adapter: NetworkAdapter | null;
  wifiSsid: string | null;
  internet: {
    reachable: boolean;
    latencyMs: number | null;
    dnsResolves: boolean;
    dnsMs: number | null;
    detail: string;
  };
  computerName: string | null;
  checkedAt: number;
};

export type StepStatus = "pass" | "warn" | "fail" | "skip";

export type TestStep = {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
  hint: string | null;
  durationMs: number;
};

export type RepairAction = "flush_dns" | "renew_dhcp" | "reset_winsock" | "reset_tcpip" | "start_sharing_services";
export type RepairStatus = "success" | "partial" | "failed" | "cancelled";

export type DiagnosticReport = {
  runId: number | null;
  steps: TestStep[];
  healthy: boolean;
  failurePoint: string | null;
  summary: string;
  recommendedRepairs: RepairAction[];
  adapterName: string | null;
};

export type DnsServerResult = {
  /** "system" for the Windows resolver, otherwise the server IP. */
  server: string;
  addresses: string[];
  aliases: string[];
  elapsedMs: number | null;
  error: string | null;
};

export type DnsComparison = { runId: number | null; domain: string; results: DnsServerResult[]; consistent: boolean };

export type RepairOutcome = {
  runId: number | null;
  action: RepairAction;
  title: string;
  status: RepairStatus;
  message: string;
  output: string | null;
  restartRequired: boolean;
};

export type SettingsPage = "network_status" | "wifi_settings" | "network_connections" | "advanced_sharing";

export type PingStats = {
  target: string;
  address: string;
  sent: number;
  received: number;
  lossPercent: number;
  minMs: number | null;
  maxMs: number | null;
  avgMs: number | null;
  jitterMs: number | null;
  samples: (number | null)[];
  lastError: string | null;
};

export type PerformanceResult = {
  runId: number | null;
  gateway: PingStats | null;
  internet: PingStats;
  adapterName: string | null;
  connectionType: AdapterKind | null;
  linkSpeedBps: number | null;
  quality: "Good" | "Fair" | "Poor" | "Unreachable";
  assessment: string;
};

export type NetError = { code: number; title: string; explanation: string; hint: string };
export type Listing<T> = { items: T[]; error: NetError | null };

export type Share = {
  name: string;
  kind: "folder" | "printer" | "device" | "ipc" | "other";
  special: boolean;
  remark: string | null;
  path: string | null;
  currentUses: number | null;
  unc: string;
};

export type SmbSession = { client: string; user: string; activeSeconds: number; idleSeconds: number };
export type SmbConnection = { local: string | null; remote: string; status: string };

export type DiscoveryStatus = {
  profiles: { name: string; interfaceAlias: string; category: string }[];
  networkDiscovery: { total: number; enabled: number };
  fileSharing: { total: number; enabled: number };
  services: { name: string; displayName: string; status: string; startType: string }[];
};

export type SharingOverview = {
  computerName: string | null;
  localShares: Listing<Share>;
  sessions: Listing<SmbSession>;
  connections: Listing<SmbConnection>;
  discovery: DiscoveryStatus | null;
  discoveryError: string | null;
  smbServerListening: boolean;
  elevated: boolean;
};

export type DiscoveredComputer = {
  name: string | null;
  address: string | null;
  mac: string | null;
  source: "browse_list" | "neighbor";
  smbOpen: boolean;
};

export type Discovery = { computers: DiscoveredComputer[]; browseError: NetError | null };
export type ShareListing = { host: string; shares: Share[]; error: NetError | null };
export type SmbCheck = { runId: number | null; host: string; steps: TestStep[]; healthy: boolean; summary: string; shares: Share[] };
export type AccessResult = { path: string; ok: boolean; entries: number | null; error: NetError | null };
export type WifiPassword = {
  ssid: string;
  profile: string;
  /** Windows' authentication name, e.g. WPA2PSK, WPA3SAE or open. */
  authentication: string;
  /** null for open networks. */
  password: string | null;
};

export type ShareChange = { runId: number | null; status: RepairStatus; message: string };

export type ReportDetail = {
  run: ActivityItem;
  username: string | null;
  logs: { level: "info" | "warning" | "error"; message: string }[];
};

// ---------------------------------------------------------------------------
// Printer & Devices

/** Status-indicator class shared by printers, devices and the spooler. */
export type Health = "ok" | "warn" | "error" | "offline";

export type PrinterInfo = {
  name: string;
  isDefault: boolean;
  shared: boolean;
  status: string;
  health: Health;
  connection: string;
  portName: string | null;
  driverName: string | null;
  manufacturer: string | null;
  location: string | null;
  comment: string | null;
  serverName: string | null;
};

export type SpoolerStatus = {
  exists: boolean;
  displayName: string;
  state: string;
  running: boolean;
  health: "ok" | "warn" | "error";
  startMode: string;
  startName: string | null;
  processId: number | null;
  exitCode: number;
  canStop: boolean;
  summary: string;
};

export type PrintJob = {
  id: number;
  printerName: string;
  documentName: string;
  owner: string | null;
  status: string;
  pages: number | null;
  sizeBytes: number | null;
  submittedAt: number | null;
  health: "ok" | "warn" | "error";
  needsAttention: boolean;
};

export type DeviceInfo = {
  instanceId: string;
  name: string;
  category: string;
  class: string | null;
  manufacturer: string | null;
  service: string | null;
  status: string;
  problemCode: number;
  problemText: string | null;
  health: "ok" | "warn" | "error";
  present: boolean;
};

export type DriverInfo = {
  deviceName: string;
  provider: string | null;
  version: string | null;
  date: string | null;
  category: string;
  class: string | null;
  manufacturer: string | null;
};

/** A native per-printer window the backend can open through printui.dll. */
export type PrinterWindow = "queue" | "properties" | "preferences";

export function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  if (!isTauri()) return "The VocaTechX backend is not available. Start the app with `npm run tauri dev`.";
  return "An unexpected error occurred. Please try again.";
}

export const api = {
  getSession: () => invoke<SessionUser | null>("get_session"),
  login: (username: string, password: string) => invoke<SessionUser>("login", { username, password }),
  logout: () => invoke<void>("logout"),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    invoke<SessionUser>("change_password", { currentPassword, newPassword, confirmPassword }),
  getSystemOverview: () => invoke<SystemOverview>("get_system_overview"),
  getRecentActivity: (limit?: number) => invoke<ActivityItem[]>("get_recent_activity", { limit }),
  getSystemStatus: () => invoke<SystemStatus>("get_system_status"),

  ralpStatus: () => invoke<RalpStatus>("ralp_status"),
  ralpStart: () => invoke<RalpStatus>("ralp_start"),
  ralpImportModel: (onProgress: (progress: ImportProgress) => void) => {
    const channel = new Channel<ImportProgress>();
    channel.onmessage = onProgress;
    return invoke<string | null>("ralp_import_model", { onProgress: channel });
  },
  ralpListConversations: () => invoke<ConversationSummary[]>("ralp_list_conversations"),
  ralpGetMessages: (conversationId: number) => invoke<ChatMessage[]>("ralp_get_messages", { conversationId }),
  ralpDeleteConversation: (conversationId: number) => invoke<void>("ralp_delete_conversation", { conversationId }),
  ralpSendMessage: (conversationId: number | null, message: string, onEvent: (event: ChatEvent) => void) => {
    const channel = new Channel<ChatEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("ralp_send_message", { conversationId, message, onEvent: channel });
  },
  ralpStopGeneration: () => invoke<void>("ralp_stop_generation"),

  netHealth: () => invoke<NetworkHealth>("net_health"),
  netAdapters: () => invoke<NetworkAdapter[]>("net_adapters"),
  netRunDiagnostics: () => invoke<DiagnosticReport>("net_run_diagnostics"),
  netDnsLookup: (domain: string, servers: string[]) => invoke<DnsComparison>("net_dns_lookup", { domain, servers }),
  netRepair: (action: RepairAction) => invoke<RepairOutcome>("net_repair", { action }),
  netOpenSettings: (page: SettingsPage) => invoke<void>("net_open_settings", { page }),
  netPerformanceTest: (target: string, count: number) => invoke<PerformanceResult>("net_performance_test", { target, count }),
  netSharingOverview: () => invoke<SharingOverview>("net_sharing_overview"),
  netDiscoverComputers: () => invoke<Discovery>("net_discover_computers"),
  netListShares: (host: string) => invoke<ShareListing>("net_list_shares", { host }),
  netCheckSmb: (host: string) => invoke<SmbCheck>("net_check_smb", { host }),
  netTestShareAccess: (path: string) => invoke<AccessResult>("net_test_share_access", { path }),
  netOpenShare: (path: string) => invoke<void>("net_open_share", { path }),
  netPickFolder: () => invoke<string | null>("net_pick_folder"),
  netCreateShare: (name: string, path: string, access: "read" | "change") =>
    invoke<ShareChange>("net_create_share", { name, path, access }),
  netRemoveShare: (name: string) => invoke<ShareChange>("net_remove_share", { name }),
  /** null if the administrator prompt was declined. */
  netWifiPassword: (adapterId: string) => invoke<WifiPassword | null>("net_wifi_password", { adapterId }),
  netHistory: (limit?: number) => invoke<ActivityItem[]>("net_history", { limit }),
  netReport: (runId: number) => invoke<ReportDetail>("net_report", { runId }),
  /** Returns the saved path, or null if the save dialog was cancelled. */
  netExportReport: (runId: number, format: "txt" | "pdf") =>
    invoke<string | null>("net_export_report", { runId, format, utcOffsetMinutes: -new Date().getTimezoneOffset() }),

  devPrinters: () => invoke<PrinterInfo[]>("dev_printers"),
  devSpoolerStatus: () => invoke<SpoolerStatus>("dev_spooler_status"),
  devPrintJobs: () => invoke<PrintJob[]>("dev_print_jobs"),
  devDevices: () => invoke<DeviceInfo[]>("dev_devices"),
  devDrivers: () => invoke<DriverInfo[]>("dev_drivers"),
  devOpenPrinterSettings: () => invoke<void>("dev_open_printer_settings"),
  devOpenPrinterWindow: (name: string, window: PrinterWindow) => invoke<void>("dev_open_printer_window", { name, window }),
  devOpenDeviceManager: () => invoke<void>("dev_open_device_manager"),
  devOpenDeviceProperties: (instanceId: string) => invoke<void>("dev_open_device_properties", { instanceId }),
  devHistory: (limit?: number) => invoke<ActivityItem[]>("dev_history", { limit }),
  devReport: (runId: number) => invoke<ReportDetail>("dev_report", { runId }),
  /** Returns the saved path, or null if the save dialog was cancelled. */
  devExportReport: (runId: number, format: "txt" | "pdf") =>
    invoke<string | null>("dev_export_report", { runId, format, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
};
