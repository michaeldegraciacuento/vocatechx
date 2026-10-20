import { HardDriveDownload, MonitorCog } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { useBackendData } from "../../lib/useBackendData";
import { EmptyState, ErrorNote, Panel, Spinner, fieldClass, secondaryButtonClass } from "../network/ui";

/** Device Drivers & Errors: the signed drivers Windows has installed, with
 *  provider, version and date. Rollback/disable/remove are added in Phase 4. */
export function DeviceDriversTab() {
  const drivers = useBackendData(api.devDrivers);
  const openManager = useBackendAction(api.devOpenDeviceManager);
  const [category, setCategory] = useState("All");
  const [filter, setFilter] = useState("");

  const all = drivers.data ?? [];
  const categories = useMemo(() => ["All", ...Array.from(new Set((drivers.data ?? []).map((d) => d.category))).sort()], [drivers.data]);

  const needle = filter.trim().toLowerCase();
  const list = all.filter((d) => {
    if (category !== "All" && d.category !== category) return false;
    if (needle && ![d.deviceName, d.provider, d.manufacturer, d.version].some((v) => v?.toLowerCase().includes(needle))) return false;
    return true;
  });

  return (
    <Panel
      title="Device drivers"
      description="Signed drivers installed on this computer. Check the Hardware tab's Problems filter for devices reporting driver errors."
      actions={
        <button type="button" className={secondaryButtonClass} onClick={() => openManager.run()} disabled={openManager.running}>
          <MonitorCog size={14} /> Device Manager
        </button>
      }
    >
      <ErrorNote message={openManager.error} />

      {drivers.loading && !drivers.data ? (
        <Spinner label="Reading installed drivers…" />
      ) : drivers.error ? (
        <ErrorNote message={drivers.error} />
      ) : all.length === 0 ? (
        <EmptyState icon={HardDriveDownload} title="No drivers reported" />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                  c === category ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#dce2eb] bg-white text-[#5b6577] hover:bg-[#f7f9fc]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by device, provider or version…"
            className={fieldClass}
            aria-label="Filter drivers"
          />

          {list.length === 0 ? (
            <EmptyState icon={HardDriveDownload} title="No drivers match" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#e3e8ef] text-[10px] font-semibold tracking-[0.5px] text-[#8b95a6] uppercase">
                    <th className="py-2 pr-3 font-semibold">Device</th>
                    <th className="py-2 pr-3 font-semibold">Category</th>
                    <th className="py-2 pr-3 font-semibold">Provider</th>
                    <th className="py-2 pr-3 font-semibold">Version</th>
                    <th className="py-2 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((d, i) => (
                    <tr key={`${d.deviceName}-${d.version}-${i}`} className="border-b border-[#f1f4f8] align-top">
                      <td className="py-2.5 pr-3">
                        <span className="block max-w-[260px] truncate font-semibold text-[#172033]" title={d.deviceName}>
                          {d.deviceName}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-[#5b6577]">{d.category}</td>
                      <td className="py-2.5 pr-3 text-[#5b6577]">{d.provider ?? "—"}</td>
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-[#5b6577]">{d.version ?? "—"}</td>
                      <td className="py-2.5 text-[#5b6577]">{d.date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="m-0 mt-3 text-[11px] text-[#8b95a6]">{list.length} of {all.length} drivers shown.</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
