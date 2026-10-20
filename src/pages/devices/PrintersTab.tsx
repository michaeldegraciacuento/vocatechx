import { ExternalLink, FileText, Printer, Settings, SlidersHorizontal, Star } from "lucide-react";
import { useState } from "react";
import { api, type PrinterInfo, type PrinterWindow } from "../../lib/api";
import type { BackendData } from "../../lib/useBackendData";
import { useBackendAction } from "../../lib/useBackendAction";
import { EmptyState, ErrorNote, Facts, Panel, Spinner, buttonClass, fieldClass, secondaryButtonClass } from "../network/ui";
import { HealthBadge } from "./ui";

/** Printer Overview: every installed printer, its status, driver and port, with
 *  actions that open the native Windows windows. */
export function PrintersTab({ printers }: { printers: BackendData<PrinterInfo[]> }) {
  const openWindow = useBackendAction(api.devOpenPrinterWindow);
  const openSettings = useBackendAction(api.devOpenPrinterSettings);
  const [filter, setFilter] = useState("");

  const all = printers.data ?? [];
  const needle = filter.trim().toLowerCase();
  const list = needle
    ? all.filter((p) => [p.name, p.driverName, p.manufacturer, p.location, p.connection].some((v) => v?.toLowerCase().includes(needle)))
    : all;

  const open = (name: string, window: PrinterWindow) => openWindow.run(name, window);

  return (
    <Panel
      title="Printer overview"
      description="Every printer Windows exposes on this computer. Status, driver and connection come directly from Windows."
      actions={
        <button type="button" className={secondaryButtonClass} onClick={() => openSettings.run()} disabled={openSettings.running}>
          <Settings size={14} /> Printer settings
        </button>
      }
    >
      {all.length > 3 && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, driver, location…"
          className={`${fieldClass} mb-4`}
          aria-label="Filter printers"
        />
      )}

      <ErrorNote message={openWindow.error ?? openSettings.error} />

      {printers.loading && !printers.data ? (
        <Spinner label="Reading installed printers…" />
      ) : printers.error ? (
        <ErrorNote message={printers.error} />
      ) : all.length === 0 ? (
        <EmptyState icon={Printer} title="No printers installed">
          Windows reports no printers on this computer. Use <span className="font-semibold">Printer settings</span> to add one, then
          refresh.
        </EmptyState>
      ) : list.length === 0 ? (
        <EmptyState icon={Printer} title="No printers match the filter" />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {list.map((p) => (
            <li key={p.name} className="rounded-[12px] border border-[#eef1f5] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[9px] bg-[#eef4ff] text-[#2563eb]">
                    <Printer size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-1.5 truncate text-[13px] font-bold text-[#172033]">
                      {p.name}
                      {p.isDefault && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] font-semibold text-[#1d4ed8]">
                          <Star size={10} /> Default
                        </span>
                      )}
                    </p>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-[#788397]">
                      {p.manufacturer ? `${p.manufacturer} · ` : ""}
                      {p.connection}
                    </p>
                  </div>
                </div>
                <HealthBadge health={p.health}>{p.status}</HealthBadge>
              </div>

              <Facts
                items={[
                  ["Driver", p.driverName],
                  ["Port", p.portName],
                  ["Shared", p.shared ? "Yes" : "No"],
                  ["Location", p.location],
                  ...(p.serverName ? ([["Print server", p.serverName]] as [string, string][]) : []),
                ]}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => open(p.name, "queue")} disabled={openWindow.running}>
                  <FileText size={14} /> Open queue
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => open(p.name, "properties")} disabled={openWindow.running}>
                  <ExternalLink size={14} /> Properties
                </button>
                <button type="button" className={secondaryButtonClass} onClick={() => open(p.name, "preferences")} disabled={openWindow.running}>
                  <SlidersHorizontal size={14} /> Preferences
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
