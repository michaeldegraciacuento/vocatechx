import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Clock,
  Eraser,
  FileCheck2,
  HardDrive,
  Info,
  LifeBuoy,
  MonitorCog,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, type LastRepairRun, type RepairId, type WindowsRepairStatus } from "../lib/api";
import { formatBytes, formatRelativeTime } from "../lib/format";
import { useBackendData } from "../lib/useBackendData";
import { HistoryTab, type HistorySource } from "./devices/HistoryTab";
import { MetricCard } from "./devices/ui";
import { Badge, Dialog, ErrorNote, Panel, buttonClass, secondaryButtonClass } from "./network/ui";
import { FULL_REPAIR, FULL_REPAIR_CONFIRM, REPAIR_GROUPS, WINDOWS_REPAIRS, type RepairGroup, type RepairImpact, type WindowsRepair } from "./repair/catalog";
import { RunModal } from "./repair/RunModal";

// Windows Repair: the built-in Windows repair tools, each run by the backend
// with fixed arguments (src-tauri/src/windows_repair). Statuses come from
// Windows and from the repair history; nothing unknown is guessed.

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "system", label: "System files & disk" },
  { id: "update", label: "Windows Update" },
  { id: "recovery", label: "Startup & recovery" },
  { id: "cleanup", label: "Cleanup" },
  { id: "history", label: "History & reports" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const GROUP_ICON: Record<RepairGroup, LucideIcon> = {
  system: FileCheck2,
  update: RefreshCw,
  recovery: LifeBuoy,
  cleanup: Eraser,
};

const IMPACT: Record<RepairImpact, { label: string; tone: "ok" | "warn" | "info" }> = {
  safe: { label: "Safe to run", tone: "ok" },
  restart: { label: "Needs a restart", tone: "info" },
  changes: { label: "Changes settings", tone: "warn" },
};

const REPAIR_HISTORY: HistorySource = {
  history: () => api.wrHistory(100),
  report: api.wrReport,
  exportReport: api.wrExportReport,
  description: "Windows repairs run on this computer, with each tool's output.",
  empty: "Repairs you run are recorded here with their result and can be exported as a TXT or PDF report.",
};

/** Common symptoms and the tab that fixes them. */
const SYMPTOMS: { symptom: string; fix: string; tab: TabId }[] = [
  { symptom: "Crashes, blue screens or strange errors", fix: "Repair the Windows image, scan system files, test the memory", tab: "system" },
  { symptom: "Windows Update fails or keeps reinstalling", fix: "Reset Windows Update components", tab: "update" },
  { symptom: "Windows will not start properly", fix: "Restart to Advanced Startup, or Safe Mode", tab: "recovery" },
  { symptom: "Problems began after an install or update", fix: "Open System Restore", tab: "recovery" },
  { symptom: "Slow computer or low disk space", fix: "Clear temporary files, optimise drives", tab: "cleanup" },
  { symptom: "Blank or wrong icons", fix: "Rebuild the icon cache", tab: "cleanup" },
];

/** What can be started from the page: one repair, or the full sequence. */
type Runnable = { id: RepairId; title: string; admin: boolean; confirm?: string };

const FULL: Runnable = { id: "full-repair", title: "Full system repair", admin: true, confirm: FULL_REPAIR_CONFIRM };

const repairById = (id: RepairId) => WINDOWS_REPAIRS.find((r) => r.id === id)!;

/** The registry still says "Windows 10" on Windows 11; the build number tells them apart. */
function windowsName(status: WindowsRepairStatus["windows"]) {
  const name = status.productName ?? "Windows";
  return status.build !== null && status.build >= 22000 ? name.replace("Windows 10", "Windows 11") : name;
}

/** "5 min ago", "just now" or "on Oct 3, 2026", to follow a verb. */
function ago(unixSeconds: number) {
  const text = formatRelativeTime(unixSeconds);
  return /ago|now/i.test(text) ? text.toLowerCase() : `on ${text}`;
}

function lastRunText(run: LastRepairRun | null | undefined) {
  if (!run?.finishedAt) return null;
  return `Last run ${ago(run.finishedAt)}: ${run.status === "success" ? "OK" : "problem"}`;
}

/** The last result shown on a repair's card, from Windows or the history. */
function cardNote(id: RepairId, status: WindowsRepairStatus | null): string | null {
  if (!status) return null;
  const w = status.windows;
  switch (id) {
    case "sfc":
      return lastRunText(status.lastSfc);
    case "dism-restore":
      return lastRunText(status.lastDism);
    case "chkdsk-scan":
      return lastRunText(status.lastChkdsk);
    case "memory-test":
      return w.memoryTestAt !== null ? `Last test ${ago(w.memoryTestAt)}: ${w.memoryTestPassed ? "no errors" : "errors found"}` : null;
    case "restore-point":
      return w.lastRestorePoint !== null ? `Newest restore point created ${ago(w.lastRestorePoint)}` : null;
    case "safe-mode":
    case "safe-mode-off":
      return status.safeModeSet === null ? null : status.safeModeSet ? "Safe Mode is set for the next start" : "Windows starts normally";
    default:
      return null;
  }
}

function blockedReason(item: Runnable, status: WindowsRepairStatus | null, busy: boolean): string | null {
  if (busy || status?.running) return "Another repair is running.";
  if (item.admin && status && !status.elevated) return "Needs VocaTechX to run as administrator.";
  return null;
}

function RunButton({ item, status, busy, onRun, label = "Run" }: { item: Runnable; status: WindowsRepairStatus | null; busy: boolean; onRun: (r: Runnable) => void; label?: string }) {
  const blocked = blockedReason(item, status, busy);
  return (
    <button type="button" className={buttonClass} disabled={blocked !== null} title={blocked ?? undefined} onClick={() => onRun(item)}>
      <Play size={13} /> {label}
    </button>
  );
}

type RunProps = { status: WindowsRepairStatus | null; busy: boolean; onRun: (r: Runnable) => void };

function RepairCard({ repair, ...run }: { repair: WindowsRepair } & RunProps) {
  const Icon = GROUP_ICON[repair.group];
  const impact = IMPACT[repair.impact];
  const note = cardNote(repair.id, run.status);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-[#e3e8ef] p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-[#101827] text-[#7db5ff]">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] font-semibold text-[#172033]">{repair.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={impact.tone}>{impact.label}</Badge>
            {repair.admin && <Badge tone="neutral">Administrator</Badge>}
            <span className="flex items-center gap-1 text-[10px] text-[#8b95a6]">
              <Clock size={11} /> {repair.duration}
            </span>
          </div>
        </div>
      </div>
      <p className="m-0 text-xs leading-[1.6] text-[#5b6577]">{repair.description}</p>
      <code className="self-start rounded-[7px] bg-[#f3f5f8] px-2 py-1 font-mono text-[11px] break-all text-[#344054]">{repair.tool}</code>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-semibold text-[#8b95a6]" title={note ?? undefined}>
          {note ?? ""}
        </span>
        <RunButton item={repair} {...run} />
      </div>
    </li>
  );
}

function GroupTab({ group, ...run }: { group: RepairGroup } & RunProps) {
  const info = REPAIR_GROUPS.find((g) => g.id === group)!;
  return (
    <Panel title={info.title} description={info.description}>
      <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
        {WINDOWS_REPAIRS.filter((r) => r.group === group).map((r) => (
          <RepairCard key={r.id} repair={r} {...run} />
        ))}
      </ul>
    </Panel>
  );
}

function OverviewTab({ onOpenTab, ...run }: { onOpenTab: (tab: TabId) => void } & RunProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title="Full system repair"
        description="The recommended sequence for a Windows installation that crashes, shows errors or behaves strangely. It runs from least to most involved and stops if a step fails."
        className="lg:col-span-2"
        actions={<RunButton item={FULL} {...run} label="Run full repair" />}
      >
        <ol className="m-0 grid list-none gap-2 p-0">
          {FULL_REPAIR.map((step, i) => {
            const repair = repairById(step.repair);
            const note = cardNote(step.repair, run.status);
            return (
              <li key={step.repair} className="flex items-start gap-3 rounded-[12px] border border-[#eef1f5] px-3.5 py-3">
                <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-[#eef4ff] text-xs font-bold text-[#1d4ed8]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 text-[13px] font-semibold text-[#172033]">{repair.title}</p>
                    <span className="flex items-center gap-1 text-[10px] text-[#8b95a6]">
                      <Clock size={11} /> {repair.duration}
                    </span>
                  </div>
                  <p className="m-0 mt-0.5 text-xs text-[#5b6577]">{step.why}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="inline-block rounded-[6px] bg-[#f3f5f8] px-1.5 py-0.5 font-mono text-[10px] text-[#344054]">{repair.tool}</code>
                    {note && <span className="text-[10px] font-semibold text-[#8b95a6]">{note}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="m-0 mt-3 flex items-start gap-2 text-[11px] leading-[1.6] text-[#788397]">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          If the computer still has problems afterwards, test the memory and check the disk's health before resetting Windows.
        </p>
      </Panel>

      <div className="grid content-start gap-5">
        <Panel title="Before you repair">
          <ul className="m-0 grid list-none gap-2 p-0">
            {[
              "Back up the customer's important files.",
              "Plug laptops into power: repairs can take a while.",
              "Close open programs and save work.",
              "Run VocaTechX as administrator.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs leading-[1.55] text-[#344054]">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-[#16a34a]" />
                {item}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Other repair tools" description="Network and printer problems have their own modules.">
          <ul className="m-0 grid list-none gap-1.5 p-0 text-xs text-[#344054]">
            <li>
              <span className="font-semibold">Network Center:</span> DNS, IP and adapter repairs
            </li>
            <li>
              <span className="font-semibold">Printer & Devices:</span> Print Spooler and driver repairs
            </li>
            <li>
              <span className="font-semibold">AI Troubleshooter:</span> describe the problem to Ralp
            </li>
          </ul>
        </Panel>
      </div>

      <Panel title="Find the right repair" description="Start from what the customer sees." className="lg:col-span-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-[10px] tracking-[0.6px] text-[#8b95a6] uppercase">
                <th className="border-b border-[#e3e8ef] px-3 py-2 font-semibold">Symptom</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2 font-semibold">Try</th>
                <th className="border-b border-[#e3e8ef] px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {SYMPTOMS.map((s) => (
                <tr key={s.symptom}>
                  <td className="border-b border-[#eef1f5] px-3 py-2.5 font-semibold text-[#172033]">{s.symptom}</td>
                  <td className="border-b border-[#eef1f5] px-3 py-2.5 text-[#5b6577]">{s.fix}</td>
                  <td className="border-b border-[#eef1f5] px-3 py-2.5 text-right">
                    <button type="button" className={`${secondaryButtonClass} px-2.5 py-1 text-[11px]`} onClick={() => onOpenTab(s.tab)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Banner({ tone, icon: Icon, title, children, action }: { tone: "warn" | "info"; icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  const style = tone === "warn" ? "border-[#fde68a] bg-[#fffbeb] text-[#92400e]" : "border-[#c7d7fe] bg-[#eef4ff] text-[#1e3a8a]";
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-2xl border px-5 py-4 ${style}`}>
      <Icon size={18} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13px] font-semibold">{title}</p>
        <p className="m-0 mt-0.5 text-xs leading-[1.6] opacity-90">{children}</p>
      </div>
      {action}
    </div>
  );
}

function StatusCards({ status, loading }: { status: WindowsRepairStatus | null; loading: boolean }) {
  if (!status) {
    const value = loading ? "Checking…" : "Unknown";
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard icon={<MonitorCog size={17} />} label="Windows" value={value} />
        <MetricCard icon={<ShieldCheck size={17} />} label="System files" value={value} />
        <MetricCard icon={<HardDrive size={17} />} label="Disk" value={value} />
        <MetricCard icon={<ArchiveRestore size={17} />} label="Last restore point" value={value} />
      </div>
    );
  }
  const w = status.windows;
  const version = [w.displayVersion, w.build !== null ? `build ${w.build}${w.ubr !== null ? `.${w.ubr}` : ""}` : null].filter(Boolean).join(" · ");

  const sfc = status.lastSfc;
  const sfcOk = sfc?.status === "success";
  const sfcRepaired = sfcOk && /repaired/i.test(sfc?.summary ?? "");

  const lowSpace = w.freeBytes !== null && w.totalBytes !== null && w.totalBytes > 0 && w.freeBytes / w.totalBytes < 0.1;
  const unhealthy = w.diskHealth !== null && w.diskHealth !== "Healthy";
  const chkdsk = status.lastChkdsk;
  const diskDetail = [w.diskHealth ? `${w.diskMedia && w.diskMedia !== "Unspecified" ? `${w.diskMedia} ` : ""}${w.diskHealth}` : null, chkdsk?.finishedAt ? `checked ${ago(chkdsk.finishedAt)}` : "not checked yet"]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <MetricCard icon={<MonitorCog size={17} />} label="Windows" value={w.productName ? windowsName(w) : "Unknown"} detail={version || undefined} />
      <MetricCard
        icon={<ShieldCheck size={17} />}
        label="System files"
        value={!sfc ? "Not checked" : sfcRepaired ? "Repaired" : sfcOk ? "No problems" : "Problems"}
        tone={!sfc ? "neutral" : sfcOk ? "ok" : "warn"}
        detail={sfc?.finishedAt ? `Scanned ${ago(sfc.finishedAt)}` : "Run a system file scan"}
      />
      <MetricCard
        icon={<HardDrive size={17} />}
        label={`Disk ${status.drive}`}
        value={w.freeBytes !== null ? `${formatBytes(w.freeBytes)} free` : "Unknown"}
        tone={unhealthy || chkdsk?.status === "failed" ? "error" : lowSpace ? "warn" : "neutral"}
        detail={diskDetail}
      />
      <MetricCard
        icon={<ArchiveRestore size={17} />}
        label="Last restore point"
        value={w.lastRestorePoint !== null ? formatRelativeTime(w.lastRestorePoint) : w.restorePointCount === 0 ? "None" : "Unknown"}
        tone={w.restorePointCount === 0 ? "warn" : "neutral"}
        detail={
          w.restorePointCount !== null
            ? `${w.restorePointCount} restore point${w.restorePointCount === 1 ? "" : "s"} on this PC`
            : status.elevated
              ? "System Protection may be off"
              : "Needs administrator rights to read"
        }
      />
    </div>
  );
}

const fetchStatus = api.wrStatus;

function WindowsRepairPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const status = useBackendData(fetchStatus);
  const [confirming, setConfirming] = useState<Runnable | null>(null);
  const [running, setRunning] = useState<Runnable | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const s = status.data;
  const busy = running !== null;

  const request = (item: Runnable) => (item.confirm ? setConfirming(item) : setRunning(item));
  const run: RunProps = { status: s, busy, onRun: request };
  const normalStartup = repairById("safe-mode-off");

  return (
    <div className="grid gap-6">
      {s && !s.elevated && (
        <Banner tone="warn" icon={ShieldAlert} title="Not running as administrator">
          Most repairs change Windows itself and need administrator rights. Close VocaTechX and open it with "Run as administrator". The icon and Store refreshes work without it.
        </Banner>
      )}
      {s?.safeModeSet && (
        <Banner
          tone="warn"
          icon={AlertTriangle}
          title={s.windows.inSafeMode ? "Windows is in Safe Mode" : "The next start is in Safe Mode"}
          action={<RunButton item={normalStartup} {...run} label="Return to normal startup" />}
        >
          Windows keeps starting in Safe Mode until it is switched back. When the problem is fixed, return to normal startup, then restart.
        </Banner>
      )}
      {s?.windows.rebootPending && (
        <Banner tone="info" icon={RotateCcw} title="A restart is pending">
          Windows is waiting for a restart to finish installing updates or repairs. Restart before running DISM or SFC, or they may report a pending repair.
        </Banner>
      )}

      <StatusCards status={s} loading={status.loading} />
      <ErrorNote message={status.error} />

      <div className="flex gap-1 overflow-x-auto border-b border-[#e3e8ef]" role="tablist" aria-label="Windows Repair sections">
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
        {tab === "overview" && <OverviewTab onOpenTab={setTab} {...run} />}
        {(tab === "system" || tab === "update" || tab === "recovery" || tab === "cleanup") && <GroupTab group={tab} {...run} />}
        {tab === "history" && <HistoryTab key={historyKey} source={REPAIR_HISTORY} />}
      </div>

      <p className="m-0 flex items-center gap-2 text-[11px] text-[#a0a9b8]">
        <Wrench size={12} /> Windows Repair uses the tools built into Windows. Nothing restarts the computer unless you choose to.
      </p>

      {confirming && (
        <Dialog
          title={confirming.title}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button type="button" className={secondaryButtonClass} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setRunning(confirming);
                  setConfirming(null);
                }}
              >
                <Play size={13} /> {confirming.id === "advanced-startup" ? "Restart now" : "Continue"}
              </button>
            </>
          }
        >
          <p className="m-0">{confirming.confirm}</p>
        </Dialog>
      )}

      {running && (
        <RunModal
          repair={running.id}
          title={running.title}
          onClose={() => {
            setRunning(null);
            setHistoryKey((k) => k + 1);
            status.reload();
          }}
        />
      )}
    </div>
  );
}

export default WindowsRepairPage;
