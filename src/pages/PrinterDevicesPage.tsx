import { Cog, Cpu, FileText, Printer, RefreshCw, WifiOff } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { useBackendData } from "../lib/useBackendData";
import { DeviceDriversTab } from "./devices/DeviceDriversTab";
import { HardwareTab } from "./devices/HardwareTab";
import { HistoryTab } from "./devices/HistoryTab";
import { PrintersTab } from "./devices/PrintersTab";
import { QueueTab } from "./devices/QueueTab";
import { SpoolerTab } from "./devices/SpoolerTab";
import { MetricCard } from "./devices/ui";
import { secondaryButtonClass } from "./network/ui";

const TABS = [
  { id: "printers", label: "Printers" },
  { id: "queue", label: "Print Queue" },
  { id: "spooler", label: "Spooler & Repair" },
  { id: "hardware", label: "Hardware" },
  { id: "drivers", label: "Device Drivers" },
  { id: "history", label: "History & Reports" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function PrinterDevicesPage() {
  const printers = useBackendData(api.devPrinters);
  const spooler = useBackendData(api.devSpoolerStatus);
  const jobs = useBackendData(api.devPrintJobs);
  const devices = useBackendData(api.devDevices);
  const [tab, setTab] = useState<TabId>("printers");

  const loading = printers.loading || spooler.loading || jobs.loading || devices.loading;
  const refreshAll = () => {
    printers.reload();
    spooler.reload();
    jobs.reload();
    devices.reload();
  };

  const printerList = printers.data ?? [];
  const defaultPrinter = printerList.find((p) => p.isDefault);
  const jobList = jobs.data ?? [];
  const jobsAttention = jobList.filter((j) => j.needsAttention).length;
  const deviceProblems = (devices.data ?? []).filter((d) => d.health !== "ok").length;
  const s = spooler.data;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className="flex items-center gap-1.5 rounded-full border border-[#d1fadf] bg-[#ecfdf3] px-2.5 py-1 text-[11px] font-semibold text-[#067647]"
          title="Printer and device tools read and repair this computer directly. No internet connection is needed."
        >
          <WifiOff size={12} /> Offline-capable
        </span>
        <button type="button" className={secondaryButtonClass} onClick={refreshAll} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard
          icon={<Printer size={17} />}
          label="Default printer"
          value={printers.loading && !printers.data ? "…" : defaultPrinter ? defaultPrinter.name : "None set"}
          detail={`${printerList.length} installed`}
          tone={defaultPrinter && defaultPrinter.health !== "ok" ? "warn" : "neutral"}
        />
        <MetricCard
          icon={<Cog size={17} />}
          label="Print Spooler"
          value={spooler.loading && !spooler.data ? "…" : s ? s.state : "Unknown"}
          detail={s ? `Startup: ${s.startMode}` : undefined}
          tone={s ? s.health : "neutral"}
        />
        <MetricCard
          icon={<FileText size={17} />}
          label="Print jobs"
          value={jobs.loading && !jobs.data ? "…" : String(jobList.length)}
          detail={jobsAttention > 0 ? `${jobsAttention} need attention` : "Queue clear"}
          tone={jobsAttention > 0 ? "warn" : "neutral"}
        />
        <MetricCard
          icon={<Cpu size={17} />}
          label="Device issues"
          value={devices.loading && !devices.data ? "…" : String(deviceProblems)}
          detail={`${(devices.data ?? []).length} devices present`}
          tone={deviceProblems > 0 ? "error" : "ok"}
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[#e3e8ef]" role="tablist" aria-label="Printer & Devices sections">
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
        {tab === "printers" && <PrintersTab printers={printers} />}
        {tab === "queue" && <QueueTab jobs={jobs} />}
        {tab === "spooler" && <SpoolerTab spooler={spooler} />}
        {tab === "hardware" && <HardwareTab devices={devices} />}
        {tab === "drivers" && <DeviceDriversTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

export default PrinterDevicesPage;
