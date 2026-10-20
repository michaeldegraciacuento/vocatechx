import { Cog } from "lucide-react";
import type { SpoolerStatus } from "../../lib/api";
import type { BackendData } from "../../lib/useBackendData";
import { ErrorNote, Facts, Panel, Spinner } from "../network/ui";
import { HealthBadge } from "./ui";

/** Spooler & Queue Repair: the Print Spooler service state. Start, restart and
 *  the advanced queue reset are added in Phase 2 with their elevated commands. */
export function SpoolerTab({ spooler }: { spooler: BackendData<SpoolerStatus> }) {
  const s = spooler.data;

  return (
    <Panel
      title="Print Spooler service"
      description="The Windows service that queues and manages all printing. Most printing problems trace back to it."
    >
      {spooler.loading && !spooler.data ? (
        <Spinner label="Checking the Print Spooler service…" />
      ) : spooler.error ? (
        <ErrorNote message={spooler.error} />
      ) : s ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#eef1f5] p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[10px] bg-[#eef4ff] text-[#2563eb]">
                <Cog size={20} />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[13px] font-bold text-[#172033]">{s.displayName}</p>
                <p className="m-0 mt-0.5 text-xs leading-[1.6] text-[#5b6577]">{s.summary}</p>
              </div>
            </div>
            <HealthBadge health={s.health}>{s.state}</HealthBadge>
          </div>

          <Facts
            items={[
              ["State", s.state],
              ["Startup type", s.startMode],
              ["Runs as", s.startName],
              ["Process ID", s.processId ? String(s.processId) : s.running ? "—" : "Not running"],
              ["Last exit code", s.exitCode === 0 ? "0 (normal)" : String(s.exitCode)],
              ["Service name", "Spooler"],
            ]}
          />

          <p className="m-0 rounded-[10px] bg-[#eef4ff] px-3 py-2.5 text-[11px] leading-[1.6] text-[#1e40af]">
            Starting, restarting and the advanced queue reset will appear here. These change a Windows service, so they require
            administrator approval and explicit confirmation before they run.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
