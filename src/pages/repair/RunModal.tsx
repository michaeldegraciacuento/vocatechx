import { AlertTriangle, CheckCircle2, Clock, Info, RotateCcw, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type RepairEvent, type RepairId, type WindowsRepairOutcome, type RepairResult } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { Dialog, ErrorNote, buttonClass } from "../network/ui";

const OUTCOME: Record<WindowsRepairOutcome, { label: string; icon: LucideIcon; className: string }> = {
  success: { label: "Done", icon: CheckCircle2, className: "text-[#16a34a]" },
  repaired: { label: "Repaired", icon: CheckCircle2, className: "text-[#16a34a]" },
  scheduled: { label: "Scheduled", icon: Clock, className: "text-[#2563eb]" },
  started: { label: "Started", icon: Info, className: "text-[#2563eb]" },
  issues: { label: "Problems remain", icon: AlertTriangle, className: "text-[#d97706]" },
  stillRunning: { label: "Still running", icon: AlertTriangle, className: "text-[#d97706]" },
  failed: { label: "Failed", icon: XCircle, className: "text-[#dc2626]" },
};

/** Lines kept in the live log; the full output goes into the history report. */
const MAX_LINES = 400;

type Step = { index: number; total: number; title: string };

function elapsedLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

function ResultRow({ result }: { result: RepairResult }) {
  const style = OUTCOME[result.outcome];
  const Icon = style.icon;
  return (
    <li className="flex items-start gap-2.5 rounded-[10px] bg-[#f7f9fc] px-3 py-2.5">
      <Icon size={17} className={`mt-0.5 flex-shrink-0 ${style.className}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-[#172033]">{result.title}</span>
          <span className={`flex-shrink-0 text-[10px] font-semibold ${style.className}`}>{style.label}</span>
        </div>
        <p className="m-0 mt-0.5 text-[11px] leading-[1.55] text-[#5b6577]">{result.summary}</p>
      </div>
    </li>
  );
}

/** Runs one repair and shows the tool's live output. It cannot be dismissed
 *  while the tool runs; the backend also blocks closing the window. */
export function RunModal({ repair, title, onClose }: { repair: RepairId; title: string; onClose: () => void }) {
  const action = useBackendAction(api.wrRun);
  const [lines, setLines] = useState<string[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(false);
  const log = useRef<HTMLOListElement>(null);
  const run = action.run;

  useEffect(() => {
    // Effects run twice in development (StrictMode); start the repair only once.
    if (started.current) return;
    started.current = true;
    const onEvent = (event: RepairEvent) => {
      if (event.type === "step") {
        setStep(event);
        setPercent(null);
      } else if (event.type === "progress") {
        setPercent(event.percent);
      } else {
        setLines((ls) => [...ls.slice(-(MAX_LINES - 1)), event.text]);
      }
    };
    run(repair, onEvent).finally(() => setFinished(true));
  }, [repair, run]);

  useEffect(() => {
    if (finished) return;
    const begin = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - begin) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const result = action.result;
  const running = !finished;

  return (
    <Dialog
      title={running ? title : result ? `${title}: ${OUTCOME[result.outcome].label.toLowerCase()}` : title}
      onClose={onClose}
      busy={running}
      footer={
        running ? (
          <span className="text-[11px] text-[#8b95a6]">Working… {elapsedLabel(elapsed)}</span>
        ) : (
          <button type="button" className={buttonClass} onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {running && (
        <p className="m-0 flex items-start gap-2 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-3.5 py-3 text-xs leading-[1.6] font-semibold text-[#92400e]">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          Don't close VocaTechX or turn off this computer while the repair runs. Stopping it half-way can leave Windows worse off.
        </p>
      )}

      {running && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs font-semibold text-[#344054]">
            <span className="min-w-0 truncate">{step ? `Step ${step.index + 1} of ${step.total}: ${step.title}` : "Running"}</span>
            {percent !== null && <span className="text-[#8b95a6]">{percent.toFixed(percent < 100 && percent % 1 ? 1 : 0)}%</span>}
          </div>
          {percent !== null ? (
            <div key={step?.index ?? 0} className="h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
              <div className="h-full rounded-full bg-[#2563eb] transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
          ) : (
            // The tool has not reported a percentage: a moving bar, never a made-up number.
            <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label="Working">
              <div className="vt-indeterminate h-full w-1/3 rounded-full bg-[#60a5fa]" />
            </div>
          )}
        </div>
      )}

      {result && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {(result.steps.length > 0 ? result.steps : [result]).map((r, i) => (
            <ResultRow key={i} result={r} />
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <details open={running} className="group">
          <summary className="cursor-pointer text-[11px] font-semibold text-[#5b6577]">Tool output ({lines.length} lines)</summary>
          <ol
            ref={log}
            className="m-0 mt-2 max-h-[220px] list-none overflow-y-auto rounded-[10px] bg-[#101827] p-3 font-mono text-[10.5px] leading-[1.6] text-[#cbd5e1]"
          >
            {lines.map((line, i) => (
              <li key={i} className="break-words whitespace-pre-wrap">
                {line}
              </li>
            ))}
          </ol>
        </details>
      )}

      <ErrorNote message={action.error} />

      {result?.restartRecommended && (
        <p className="m-0 flex items-start gap-2 rounded-[10px] bg-[#eef4ff] px-3.5 py-3 text-xs leading-[1.6] text-[#1d4ed8]">
          <RotateCcw size={15} className="mt-0.5 flex-shrink-0" />
          Restart Windows to finish. VocaTechX will not restart the computer for you.
        </p>
      )}
      {finished && result && <p className="m-0 text-[11px] text-[#8b95a6]">Saved to History & reports · took {elapsedLabel(elapsed)}</p>}
    </Dialog>
  );
}
