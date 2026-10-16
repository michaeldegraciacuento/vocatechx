import { Globe2, Plug, RefreshCw, Router, Stethoscope, WifiOff, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, type NetworkHealth, type RepairAction, type SettingsPage } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import { useBackendAction } from "../lib/useBackendAction";
import { useBackendData } from "../lib/useBackendData";
import { cardClass } from "../styles";
import { AdaptersTab } from "./network/AdaptersTab";
import { DiagnosticsTab } from "./network/DiagnosticsTab";
import { DnsTab } from "./network/DnsTab";
import { HistoryTab } from "./network/HistoryTab";
import { IpConfigTab } from "./network/IpConfigTab";
import { OverviewTab } from "./network/OverviewTab";
import { PerformanceTab } from "./network/PerformanceTab";
import { RepairDialog } from "./network/repairs";
import { RepairTab } from "./network/RepairTab";
import { SharingTab } from "./network/SharingTab";
import { ErrorNote, buttonClass, secondaryButtonClass } from "./network/ui";

const HEALTH_POLL_MS = 30_000;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "adapters", label: "Adapters" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "dns", label: "DNS" },
  { id: "repair", label: "Repair" },
  { id: "ip", label: "IP & Subnet" },
  { id: "performance", label: "Performance" },
  { id: "sharing", label: "File Sharing" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const CONNECTION_TEXT: Record<NetworkHealth["status"], { label: string; className: string }> = {
  connected: { label: "Connected", className: "text-[#067647]" },
  limited: { label: "Limited", className: "text-[#b45309]" },
  disconnected: { label: "Disconnected", className: "text-[#b91c1c]" },
};

function StatusCard({ icon: Icon, label, children, detail }: { icon: LucideIcon; label: string; children: ReactNode; detail?: ReactNode }) {
  return (
    <div className={`${cardClass} flex min-w-0 flex-col gap-2`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#eef4ff] text-[#2563eb]">
          <Icon size={17} />
        </span>
        <p className="m-0 text-xs font-semibold text-[#5b6577]">{label}</p>
      </div>
      <div className="min-w-0 truncate text-xl font-bold tracking-[-0.4px] text-[#172033]">{children}</div>
      {detail && <p className="m-0 truncate text-[11px] text-[#788397]">{detail}</p>}
    </div>
  );
}

function Skeleton() {
  return <span className="block h-6 w-24 animate-pulse rounded bg-[#eef1f5]" aria-label="Loading" />;
}

function NetworkCenterPage() {
  const health = useBackendData(api.netHealth, HEALTH_POLL_MS);
  const diagnostics = useBackendAction(api.netRunDiagnostics);
  const settings = useBackendAction(api.netOpenSettings);
  const [tab, setTab] = useState<TabId>("overview");
  const [pendingRepair, setPendingRepair] = useState<RepairAction | null>(null);

  const h = health.data;
  const gateway = h?.adapter?.gateways.find((g) => !g.includes(":"));
  const connection = h ? CONNECTION_TEXT[h.status] : null;

  const runDiagnostics = async () => {
    setTab("diagnostics");
    if (await diagnostics.run()) health.reload();
  };

  const openSettings = (page: SettingsPage) => {
    settings.run(page);
  };

  const connectionDetail = h?.adapter
    ? [h.adapter.kind === "wifi" ? (h.wifiSsid ? `Wi-Fi · ${h.wifiSsid}` : "Wi-Fi") : h.adapter.kind === "ethernet" ? "Ethernet" : h.adapter.name, h.adapter.ipv4[0]?.address]
        .filter(Boolean)
        .join(" · ")
    : "No active adapter";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-full border border-[#d1fadf] bg-[#ecfdf3] px-2.5 py-1 text-[11px] font-semibold text-[#067647]"
            title="All tools run on this computer. Without internet, tests simply report it as unreachable."
          >
            <WifiOff size={12} /> Offline-capable
          </span>
          {h && <span className="text-[11px] text-[#8b95a6]">Checked {formatRelativeTime(h.checkedAt).toLowerCase()}</span>}
        </div>
        <button type="button" className={secondaryButtonClass} onClick={health.reload} disabled={health.loading}>
          <RefreshCw size={14} className={health.loading ? "animate-spin" : ""} /> Refresh status
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatusCard icon={Plug} label="Connection" detail={h ? connectionDetail : undefined}>
          {connection ? <span className={connection.className}>{connection.label}</span> : health.loading ? <Skeleton /> : "—"}
        </StatusCard>
        <StatusCard icon={Router} label="Default Gateway" detail={h?.adapter?.dhcpEnabled === false ? "Static configuration" : h ? "Router address" : undefined}>
          {h ? <span className="font-mono text-lg">{gateway ?? "None"}</span> : health.loading ? <Skeleton /> : "—"}
        </StatusCard>
        <StatusCard
          icon={Globe2}
          label="DNS Resolution"
          detail={h ? (h.internet.reachable ? `Internet reachable · ${h.internet.latencyMs} ms` : "Internet unreachable") : undefined}
        >
          {h ? (
            <span className={h.internet.dnsResolves ? "text-[#067647]" : "text-[#b91c1c]"}>{h.internet.dnsResolves ? "Passed" : "Failed"}</span>
          ) : health.loading ? (
            <Skeleton />
          ) : (
            "—"
          )}
        </StatusCard>
        <StatusCard
          icon={Stethoscope}
          label="Diagnostics"
          detail={diagnostics.result ? diagnostics.result.summary : "Step-by-step connection test"}
        >
          <button type="button" className={`${buttonClass} w-full`} onClick={runDiagnostics} disabled={diagnostics.running}>
            {diagnostics.running ? "Testing…" : "Run Tests"}
          </button>
        </StatusCard>
      </div>

      {health.error && !h && <ErrorNote message={health.error} />}
      <ErrorNote message={settings.error} />

      <div className="flex gap-1 overflow-x-auto border-b border-[#e3e8ef]" role="tablist" aria-label="Network Center sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px cursor-pointer border-x-0 border-t-0 border-b-2 border-solid bg-transparent px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.id ? "border-[#2563eb] text-[#1d4ed8]" : "border-transparent text-[#5b6577] hover:text-[#172033]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && (
          <OverviewTab health={h} loading={health.loading} error={health.error} onRunDiagnostics={runDiagnostics} onOpenSettings={openSettings} />
        )}
        {tab === "adapters" && <AdaptersTab onOpenSettings={openSettings} />}
        {tab === "diagnostics" && (
          <DiagnosticsTab
            report={diagnostics.result}
            running={diagnostics.running}
            error={diagnostics.error}
            onRun={runDiagnostics}
            onRepair={setPendingRepair}
          />
        )}
        {tab === "dns" && <DnsTab health={h} onRepair={setPendingRepair} />}
        {tab === "repair" && <RepairTab onRepair={setPendingRepair} onOpenSettings={openSettings} />}
        {tab === "ip" && <IpConfigTab />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "sharing" && <SharingTab onRepair={setPendingRepair} onOpenSettings={openSettings} />}
        {tab === "history" && <HistoryTab />}
      </div>

      {pendingRepair && (
        <RepairDialog
          action={pendingRepair}
          onClose={() => setPendingRepair(null)}
          onDone={() => health.reload()}
        />
      )}
    </div>
  );
}

export default NetworkCenterPage;
