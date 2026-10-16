import { Cpu, HardDrive, MemoryStick, Monitor } from "lucide-react";
import type { ReactNode } from "react";
import { ActivityList } from "../components/ActivityList";
import { QuickActions } from "../components/QuickActions";
import { SummaryCard } from "../components/SummaryCard";
import { SystemStatusPanel } from "../components/SystemStatusPanel";
import { useAuth } from "../auth/context";
import { api, type SystemOverview } from "../lib/api";
import { formatBytes, formatPercent, formatUptime } from "../lib/format";
import { useBackendData } from "../lib/useBackendData";
import type { PageId } from "../navigation";
import { cardClass, dotClass, eyebrowClass } from "../styles";

const OVERVIEW_POLL_MS = 5000;
const fetchRecentActivity = () => api.getRecentActivity(6);

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-sm font-bold text-[#172033]">{title}</h2>
        {aside && <span className="truncate text-[11px] text-[#788397]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** The system drive on Windows, otherwise the first fixed disk. */
function primaryDisk(overview: SystemOverview) {
  const fixed = overview.storage.filter((disk) => !disk.removable);
  return (
    fixed.find((disk) => disk.mountPoint.toUpperCase().startsWith("C:")) ??
    fixed[0] ??
    overview.storage[0] ??
    null
  );
}

function OverviewCards({ overview, loading, error }: { overview: SystemOverview | null; loading: boolean; error: string | null }) {
  const unavailable = error ?? "Not reported by this system";

  const cpu = overview?.cpu;
  const memory = overview?.memory;
  const memoryPercent = memory ? (memory.usedBytes / memory.totalBytes) * 100 : null;
  const disk = overview ? primaryDisk(overview) : null;
  const diskPercent = disk ? ((disk.totalBytes - disk.availableBytes) / disk.totalBytes) * 100 : null;
  const os = overview?.os;
  const osName = os?.longVersion ?? os?.name ?? null;

  const cores = cpu
    ? [cpu.physicalCores != null && `${cpu.physicalCores} cores`, `${cpu.logicalCores} threads`].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <SummaryCard
        icon={Cpu}
        label="CPU usage"
        loading={loading}
        unavailableText={unavailable}
        value={cpu?.usagePercent != null ? formatPercent(cpu.usagePercent) : null}
        percent={cpu?.usagePercent}
        detail={<span title={cpu?.brand ?? undefined}>{cpu?.brand ? `${cpu.brand} · ${cores}` : cores}</span>}
      />
      <SummaryCard
        icon={MemoryStick}
        label="Memory"
        loading={loading}
        unavailableText={unavailable}
        value={memory && memoryPercent != null ? formatPercent(memoryPercent) : null}
        percent={memoryPercent}
        detail={memory && `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} in use`}
      />
      <SummaryCard
        icon={HardDrive}
        label="Storage"
        loading={loading}
        unavailableText={unavailable}
        value={disk && diskPercent != null ? formatPercent(diskPercent) : null}
        percent={diskPercent}
        detail={
          disk &&
          `${disk.mountPoint} · ${formatBytes(disk.availableBytes)} free of ${formatBytes(disk.totalBytes)}` +
            (overview && overview.storage.length > 1 ? ` · ${overview.storage.length} drives` : "")
        }
      />
      <SummaryCard
        icon={Monitor}
        label="Operating system"
        loading={loading}
        unavailableText={unavailable}
        value={osName && <span className="text-lg" title={osName}>{osName}</span>}
        detail={os?.kernelVersion ? `Build ${os.kernelVersion}` : os?.version ? `Version ${os.version}` : undefined}
      />
    </div>
  );
}

function DashboardPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { user } = useAuth();
  const overview = useBackendData(api.getSystemOverview, OVERVIEW_POLL_MS);
  const activity = useBackendData(fetchRecentActivity);
  const status = useBackendData(api.getSystemStatus);

  if (!user) return null;

  const device = overview.data
    ? [overview.data.hostName, `Up ${formatUptime(overview.data.uptimeSeconds)}`].filter(Boolean).join(" · ")
    : undefined;

  return (
    <div className="grid gap-7">
      <section className="relative overflow-hidden rounded-2xl bg-[#101827] px-8 py-7 text-white before:pointer-events-none before:absolute before:-top-[120px] before:-right-[80px] before:h-[300px] before:w-[300px] before:rounded-full before:border before:border-[#263956] before:opacity-[0.55] before:content-[''] before:[box-shadow:0_0_0_40px_#101827,0_0_0_41px_#263956]">
        <div className={`relative flex items-center gap-[9px] ${eyebrowClass}`}>
          <span className={`${dotClass} bg-[#3b82f6]`} />
          YOUR COMPUTER SERVICING ASSISTANT
        </div>
        <h2 className="relative mt-4 mb-2 text-[30px] leading-[1.15] tracking-[-1.2px]">Welcome to VocaTechX</h2>
        <p className="relative m-0 text-sm font-semibold tracking-[0.5px] text-[#60a5fa]">
          Install. Diagnose. Repair. Learn.
        </p>
      </section>

      <Section title="System Overview" aside={device}>
        <OverviewCards overview={overview.data} loading={overview.loading} error={overview.error} />
      </Section>

      <Section title="Quick Actions">
        <QuickActions onNavigate={onNavigate} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${cardClass} min-w-0 lg:col-span-2`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="m-0 text-sm font-bold text-[#172033]">Recent Activity</h2>
            {activity.data && activity.data.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate("activity-logs")}
                className="cursor-pointer border-none bg-transparent text-[11px] font-semibold text-[#2563eb]"
              >
                View all
              </button>
            )}
          </div>
          <ActivityList items={activity.data} loading={activity.loading} error={activity.error} />
        </section>

        <section className={`${cardClass} min-w-0`}>
          <h2 className="m-0 mb-4 text-sm font-bold text-[#172033]">System Status</h2>
          <SystemStatusPanel status={status.data} error={status.error} user={user} />
        </section>
      </div>
    </div>
  );
}

export default DashboardPage;
