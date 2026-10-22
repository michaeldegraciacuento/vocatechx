import { AlertTriangle, CheckCircle2, CircleDashed, CircleMinus, Loader2, RotateCcw, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type InstallEvent, type InstallResult, type InstallStatus, type SoftwareApp } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { Dialog, ErrorNote, buttonClass, secondaryButtonClass } from "../network/ui";
import { AppIcon } from "./AppIcon";

type Row = { app: SoftwareApp; message: string | null; result: InstallResult | null };

const RESULT_STYLE: Record<InstallStatus, { icon: LucideIcon; className: string; label: string }> = {
  installed: { icon: CheckCircle2, className: "text-[#16a34a]", label: "Installed" },
  updated: { icon: CheckCircle2, className: "text-[#16a34a]", label: "Updated" },
  uninstalled: { icon: CheckCircle2, className: "text-[#16a34a]", label: "Uninstalled" },
  skipped: { icon: CircleMinus, className: "text-[#8b95a6]", label: "Skipped" },
  failed: { icon: XCircle, className: "text-[#dc2626]", label: "Failed" },
  cancelled: { icon: CircleMinus, className: "text-[#8b95a6]", label: "Not started" },
  unverified: { icon: AlertTriangle, className: "text-[#d97706]", label: "Check manually" },
  still_running: { icon: AlertTriangle, className: "text-[#d97706]", label: "Still running" },
};

const TEXT = {
  install: { title: "Installing apps", finished: "Installation finished", doing: "installing", verb: "Installing", done: "installed" },
  uninstall: { title: "Uninstalling apps", finished: "Uninstall finished", doing: "uninstalling", verb: "Uninstalling", done: "uninstalled" },
} as const;

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="h-full rounded-full bg-[#2563eb] transition-[width] duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}

/** Installer progress is unknown, so the current app gets a moving bar rather than a made-up percentage. */
function ActivityBar() {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-label="Working">
      <div className="vt-indeterminate h-full w-1/3 rounded-full bg-[#60a5fa]" />
    </div>
  );
}

/** Installs the selected apps one after another. It cannot be dismissed while
 *  installers run; the backend also blocks closing the window. */
export function InstallModal({ apps, mode, onClose }: { apps: SoftwareApp[]; mode: "install" | "uninstall"; onClose: () => void }) {
  const t = TEXT[mode];
  // `mode` never changes while the modal is open, so the hook always gets the same action.
  const install = useBackendAction(mode === "install" ? api.swInstall : api.swUninstall);
  const [rows, setRows] = useState<Row[]>(() => apps.map((app) => ({ app, message: null, result: null })));
  const [current, setCurrent] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [finished, setFinished] = useState(false);
  const started = useRef(false);
  const run = install.run;

  useEffect(() => {
    // Effects run twice in development (StrictMode); start the batch only once.
    if (started.current) return;
    started.current = true;
    const onEvent = (event: InstallEvent) => {
      if (event.type === "step") {
        setCurrent(event.index);
        setRows((rs) => rs.map((r, i) => (i === event.index ? { ...r, message: event.message } : r)));
      } else {
        setRows((rs) => rs.map((r, i) => (i === event.index ? { ...r, result: event.result, message: null } : r)));
      }
    };
    run(
      apps.map((a) => a.id),
      onEvent,
    ).finally(() => {
      setCurrent(null);
      setFinished(true);
    });
  }, [apps, run]);

  const done = rows.filter((r) => r.result).length;
  const running = !finished;
  const results = rows.flatMap((r) => (r.result ? [r.result] : []));
  const count = (...statuses: InstallStatus[]) => results.filter((r) => statuses.includes(r.status)).length;
  const reboot = results.some((r) => r.rebootRequired);
  const active = current !== null ? rows[current] : null;

  const stop = async () => {
    setStopping(true);
    try {
      await api.swCancelInstall();
    } catch {
      setStopping(false);
    }
  };

  return (
    <Dialog
      title={running ? t.title : t.finished}
      onClose={onClose}
      busy={running}
      footer={
        running ? (
          <button type="button" className={secondaryButtonClass} onClick={stop} disabled={stopping}>
            {stopping ? "Stopping after this app…" : "Stop after this app"}
          </button>
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
          Don't close VocaTechX or turn off this computer while apps are {t.doing}.
        </p>
      )}

      <div className="grid gap-2">
        <div className="flex items-center justify-between text-xs font-semibold text-[#344054]">
          <span>{running ? `${t.verb} ${Math.min(done + 1, rows.length)} of ${rows.length}` : `${done} of ${rows.length} done`}</span>
          <span className="text-[#8b95a6]">{Math.round((done / rows.length) * 100)}%</span>
        </div>
        <ProgressBar value={(done / rows.length) * 100} />
      </div>

      {running && active && (
        <div className="grid gap-2 rounded-[12px] bg-[#f7f9fc] p-3.5">
          <p className="m-0 text-[13px] font-semibold text-[#172033]">{active.app.name}</p>
          <p className="m-0 text-xs text-[#5b6577]">{active.message ?? "Starting…"}</p>
          <ActivityBar />
        </div>
      )}

      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((row, i) => {
          const style = row.result ? RESULT_STYLE[row.result.status] : null;
          const Icon = style ? style.icon : i === current ? Loader2 : CircleDashed;
          return (
            <li key={row.app.id} className="flex items-start gap-2.5 rounded-[10px] px-2 py-2">
              <Icon
                size={17}
                className={`mt-0.5 flex-shrink-0 ${style ? style.className : i === current ? "animate-spin text-[#2563eb]" : "text-[#c7d0dd]"}`}
              />
              <AppIcon app={row.app} size={24} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-[#172033]">{row.app.name}</span>
                  <span className={`flex-shrink-0 text-[10px] font-semibold ${style ? style.className : "text-[#8b95a6]"}`}>
                    {style ? style.label : i === current ? "Working…" : "Waiting"}
                  </span>
                </div>
                {row.result && (
                  <p className="m-0 mt-0.5 text-[11px] leading-[1.5] text-[#5b6577]">
                    {row.result.message}
                    {row.result.exitCode !== null && row.result.status === "failed" ? ` (exit code ${row.result.exitCode})` : ""}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ErrorNote message={install.error} />

      {finished && !install.error && (
        <p className="m-0 rounded-[10px] bg-[#f7f9fc] px-3.5 py-3 text-xs leading-[1.6] text-[#344054]">
          {count("installed", "updated", "uninstalled")} {t.done}
          {count("skipped") > 0 && `, ${count("skipped")} skipped`}
          {count("failed", "unverified", "still_running") > 0 && `, ${count("failed", "unverified", "still_running")} need attention`}
          {count("cancelled") > 0 && `, ${count("cancelled")} not started`}.
        </p>
      )}
      {finished && reboot && (
        <p className="m-0 flex items-start gap-2 rounded-[10px] bg-[#eef4ff] px-3.5 py-3 text-xs leading-[1.6] text-[#1d4ed8]">
          <RotateCcw size={15} className="mt-0.5 flex-shrink-0" />
          Restart Windows to finish. VocaTechX will not restart the computer for you.
        </p>
      )}
    </Dialog>
  );
}
