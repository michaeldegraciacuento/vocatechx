import { AlertTriangle, FileText } from "lucide-react";
import type { PrintJob } from "../../lib/api";
import { formatBytes, formatRelativeTime } from "../../lib/format";
import type { BackendData } from "../../lib/useBackendData";
import { EmptyState, ErrorNote, Panel, Spinner } from "../network/ui";
import { HealthBadge } from "./ui";

/** Print Queue Manager: the jobs the spooler currently holds. Cancel, pause and
 *  clear actions are added in Phase 2 alongside their backend commands. */
export function QueueTab({ jobs }: { jobs: BackendData<PrintJob[]> }) {
  const list = jobs.data ?? [];
  const attention = list.filter((j) => j.needsAttention).length;

  return (
    <Panel
      title="Print queue"
      description="Documents waiting in every printer's queue. Jobs that are paused, errored or offline are flagged and listed first."
    >
      {attention > 0 && (
        <p className="m-0 mb-4 flex items-center gap-2 rounded-[10px] bg-[#fef3c7] px-3 py-2.5 text-xs text-[#92400e]">
          <AlertTriangle size={15} className="flex-shrink-0" />
          {attention} {attention === 1 ? "job needs" : "jobs need"} attention (paused, error or offline).
        </p>
      )}

      {jobs.loading && !jobs.data ? (
        <Spinner label="Reading the print queue…" />
      ) : jobs.error ? (
        <ErrorNote message={jobs.error} />
      ) : list.length === 0 ? (
        <EmptyState icon={FileText} title="The print queue is empty">
          No documents are waiting to print. When a print job gets stuck, it will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#e3e8ef] text-[10px] font-semibold tracking-[0.5px] text-[#8b95a6] uppercase">
                <th className="py-2 pr-3 font-semibold">Document</th>
                <th className="py-2 pr-3 font-semibold">Printer</th>
                <th className="py-2 pr-3 font-semibold">Owner</th>
                <th className="py-2 pr-3 font-semibold">Pages</th>
                <th className="py-2 pr-3 font-semibold">Size</th>
                <th className="py-2 pr-3 font-semibold">Submitted</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((j) => (
                <tr key={`${j.printerName}#${j.id}`} className="border-b border-[#f1f4f8] align-top">
                  <td className="py-2.5 pr-3">
                    <span className="block max-w-[220px] truncate font-semibold text-[#172033]" title={j.documentName}>
                      {j.documentName}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-[#5b6577]">
                    <span className="block max-w-[160px] truncate" title={j.printerName}>
                      {j.printerName}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-[#5b6577]">{j.owner ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-[#5b6577]">{j.pages ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-[#5b6577]">{j.sizeBytes ? formatBytes(j.sizeBytes) : "—"}</td>
                  <td className="py-2.5 pr-3 text-[#5b6577]">{j.submittedAt ? formatRelativeTime(j.submittedAt) : "—"}</td>
                  <td className="py-2.5">
                    <HealthBadge health={j.health}>{j.status}</HealthBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
