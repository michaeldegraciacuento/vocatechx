import { FileDown, FileText, History } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityList } from "../../components/ActivityList";
import { api, type ActivityItem, type ReportDetail } from "../../lib/api";
import { formatRelativeTime, humanizeIdentifier } from "../../lib/format";
import { useBackendAction } from "../../lib/useBackendAction";
import { useBackendData } from "../../lib/useBackendData";
import { EmptyState, ErrorNote, Panel, Spinner, secondaryButtonClass } from "../network/ui";

/** Where a module's history comes from. Functions must be stable (module level). */
export type HistorySource = {
  history: () => Promise<ActivityItem[]>;
  report: (runId: number) => Promise<ReportDetail>;
  exportReport: (runId: number, format: "txt" | "pdf") => Promise<string | null>;
  description: string;
  empty: string;
};

const DEVICE_HISTORY: HistorySource = {
  history: () => api.devHistory(100),
  report: api.devReport,
  exportReport: api.devExportReport,
  description: "Printer and device diagnostics and repairs, saved on this computer.",
  empty: "Printer and device repairs you run will be recorded here and can be exported as a report.",
};

const LEVEL_STYLE = {
  info: "border-l-[#cbd5e1]",
  warning: "border-l-[#f59e0b]",
  error: "border-l-[#dc2626]",
} as const;

function ReportView({ runId, source }: { runId: number; source: HistorySource }) {
  const report = useBackendAction(source.report);
  const exporter = useBackendAction(source.exportReport);
  const [saved, setSaved] = useState<string | null>(null);
  const load = report.run;

  useEffect(() => {
    load(runId);
  }, [load, runId]);

  const exportAs = async (format: "txt" | "pdf") => {
    setSaved(null);
    const path = await exporter.run(runId, format);
    if (path) setSaved(path);
  };

  if (report.running && !report.result) return <Spinner label="Loading report…" />;
  if (report.error) return <ErrorNote message={report.error} />;
  const detail = report.result;
  if (!detail) return null;

  return (
    <div className="grid gap-4">
      <div>
        <p className="m-0 text-[13px] font-semibold text-[#172033]">{detail.run.title}</p>
        <p className="m-0 mt-0.5 text-[11px] text-[#788397]">
          {humanizeIdentifier(detail.run.operationType)} · {new Date(detail.run.startedAt * 1000).toLocaleString()}
          {detail.username ? ` · ${detail.username}` : ""}
        </p>
        {detail.run.summary && <p className="m-0 mt-2 text-xs leading-[1.6] text-[#344054]">{detail.run.summary}</p>}
      </div>
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {detail.logs.map((log, i) => (
          <li
            key={i}
            className={`border-l-[3px] bg-[#f7f9fc] py-1.5 pr-2 pl-3 text-xs leading-[1.6] whitespace-pre-wrap text-[#344054] ${LEVEL_STYLE[log.level]}`}
          >
            {log.message}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButtonClass} onClick={() => exportAs("txt")} disabled={exporter.running}>
          <FileText size={14} /> Export TXT
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => exportAs("pdf")} disabled={exporter.running}>
          <FileDown size={14} /> Export PDF
        </button>
      </div>
      {saved && <p className="m-0 text-[11px] break-all text-[#067647]">Saved to {saved}</p>}
      <ErrorNote message={exporter.error} />
    </div>
  );
}

/** Repair History & Reports: a module's operations recorded on this computer,
 *  exportable as TXT or PDF. Printer & Devices by default. */
export function HistoryTab({ source = DEVICE_HISTORY }: { source?: HistorySource }) {
  const history = useBackendData(source.history);
  const [selected, setSelected] = useState<number | null>(null);
  const items = history.data ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Panel
        title="Repair history"
        description={source.description}
        className="min-w-0 lg:col-span-2"
      >
        {history.loading || history.error || items.length === 0 ? (
          items.length === 0 && !history.loading && !history.error ? (
            <EmptyState icon={History} title="No operations yet">
              {source.empty}
            </EmptyState>
          ) : (
            <ActivityList items={history.data} loading={history.loading} error={history.error} />
          )
        ) : (
          <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-1 p-0">
            {items.map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  aria-current={selected === item.id}
                  title={item.summary ? `${item.title}\n${item.summary}` : item.title}
                  className={`block w-full min-w-0 cursor-pointer rounded-[10px] border-none px-3 py-2.5 text-left leading-[1.4] ${
                    selected === item.id ? "bg-[#eef4ff]" : "bg-transparent hover:bg-[#f7f9fc]"
                  }`}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#172033]">{item.title}</span>
                    <span
                      className={`flex-shrink-0 text-[10px] font-semibold ${
                        item.status === "success" ? "text-[#067647]" : item.status === "failed" ? "text-[#b91c1c]" : "text-[#5b6577]"
                      }`}
                    >
                      {item.status === "success" ? "OK" : item.status === "failed" ? "Problem" : "Cancelled"}
                    </span>
                  </span>
                  <span className="mt-0.5 block min-w-0 truncate text-[11px] text-[#788397]">
                    {formatRelativeTime(item.startedAt)}
                    {item.summary ? ` · ${item.summary}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Report" className="min-w-0 lg:col-span-3">
        {selected !== null ? (
          <ReportView key={selected} runId={selected} source={source} />
        ) : (
          <EmptyState icon={History} title="Select an entry">
            Choose an entry to see its details and export it as a TXT or PDF report.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
