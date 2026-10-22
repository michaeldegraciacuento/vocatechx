import { AlertTriangle, Check, Pencil } from "lucide-react";
import type { SoftwareApp, SoftwareStatus } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { secondaryButtonClass } from "../network/ui";
import { AppIcon } from "./AppIcon";
import { StateBadge } from "./ui";

/** One app in the catalog: click anywhere on it to select it. */
export function AppTile({
  app,
  status,
  selected,
  disabled,
  onToggle,
  onSetUp,
}: {
  app: SoftwareApp;
  status: SoftwareStatus | undefined;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onSetUp: () => void;
}) {
  if (app.problem) {
    return (
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[#fecaca] bg-[#fffafa] p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-[#fef2f2] text-[#dc2626]">
            <AlertTriangle size={19} />
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-[13px] font-semibold text-[#172033]">{app.name}</p>
            <p className="m-0 mt-1 text-xs leading-[1.5] text-[#b91c1c]">{app.problem}</p>
          </div>
        </div>
        {app.source && (
          <button type="button" className={`${secondaryButtonClass} self-start`} onClick={onSetUp}>
            Set up again
          </button>
        )}
      </div>
    );
  }

  return (
    <label
      className={`relative flex min-w-0 cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-colors ${
        selected ? "border-[#2563eb] bg-[#f5f8ff] shadow-[0_0_0_3px_#2563eb1a]" : "border-[#e3e8ef] bg-white hover:border-[#c7d2e1]"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input type="checkbox" className="peer sr-only" checked={selected} onChange={onToggle} disabled={disabled} />
      <span
        aria-hidden="true"
        className={`absolute top-3.5 right-3.5 grid h-5 w-5 place-items-center rounded-md border peer-focus-visible:shadow-[0_0_0_3px_#3b82f640] ${
          selected ? "border-[#2563eb] bg-[#2563eb] text-white" : "border-[#c7d0dd] bg-white text-transparent"
        }`}
      >
        <Check size={13} strokeWidth={3} />
      </span>
      <div className="flex items-start gap-3 pr-7">
        <AppIcon app={app} size={40} />
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] font-semibold text-[#172033]">{app.name}</p>
          <p className="m-0 mt-0.5 truncate text-[11px] text-[#788397]">
            {[app.version && `v${app.version}`, app.publisher].filter(Boolean).join(" · ") || app.category}
          </p>
        </div>
      </div>
      {app.description && <p className="m-0 line-clamp-2 text-xs leading-[1.5] text-[#5b6577]">{app.description}</p>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <StateBadge status={status} version={app.version} />
        <span className="flex items-center gap-2">
          {app.sizeBytes !== null && <span className="text-[10px] text-[#8b95a6]">{formatBytes(app.sizeBytes)}</span>}
          {app.source && (
            <button
              type="button"
              title={`Edit ${app.name}`}
              aria-label={`Edit ${app.name}`}
              className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-[#e3e8ef] bg-white text-[#5b6577] hover:bg-[#f3f5f8] hover:text-[#172033]"
              onClick={(e) => {
                // The tile is a label; don't let this click toggle its checkbox.
                e.preventDefault();
                e.stopPropagation();
                onSetUp();
              }}
            >
              <Pencil size={13} />
            </button>
          )}
        </span>
      </div>
    </label>
  );
}
