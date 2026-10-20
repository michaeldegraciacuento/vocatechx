import { Cpu, ExternalLink, MonitorCog } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type DeviceInfo } from "../../lib/api";
import type { BackendData } from "../../lib/useBackendData";
import { useBackendAction } from "../../lib/useBackendAction";
import { EmptyState, ErrorNote, Panel, Spinner, buttonClass, fieldClass, secondaryButtonClass } from "../network/ui";
import { HealthBadge } from "./ui";

/** Hardware Overview: the Plug-and-Play devices Windows reports as present,
 *  grouped by category, with problem devices surfaced first. */
export function HardwareTab({ devices }: { devices: BackendData<DeviceInfo[]> }) {
  const openManager = useBackendAction(api.devOpenDeviceManager);
  const openProps = useBackendAction(api.devOpenDeviceProperties);
  const [category, setCategory] = useState<string>("All");
  const [filter, setFilter] = useState("");

  const all = devices.data ?? [];
  const problems = all.filter((d) => d.health !== "ok").length;

  const categories = useMemo(() => {
    const names = Array.from(new Set((devices.data ?? []).map((d) => d.category))).sort();
    return ["All", "Problems", ...names];
  }, [devices.data]);

  const needle = filter.trim().toLowerCase();
  const list = all.filter((d) => {
    if (category === "Problems" ? d.health === "ok" : category !== "All" && d.category !== category) return false;
    if (needle && ![d.name, d.manufacturer, d.class, d.instanceId].some((v) => v?.toLowerCase().includes(needle))) return false;
    return true;
  });

  return (
    <Panel
      title="Hardware overview"
      description="Connected Plug-and-Play devices, read from Windows. Devices with a problem are listed first."
      actions={
        <button type="button" className={secondaryButtonClass} onClick={() => openManager.run()} disabled={openManager.running}>
          <MonitorCog size={14} /> Device Manager
        </button>
      }
    >
      <ErrorNote message={openManager.error ?? openProps.error} />

      {devices.loading && !devices.data ? (
        <Spinner label="Scanning connected devices…" />
      ) : devices.error ? (
        <ErrorNote message={devices.error} />
      ) : all.length === 0 ? (
        <EmptyState icon={Cpu} title="No devices detected" />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((c) => {
              const active = c === category;
              const count = c === "All" ? all.length : c === "Problems" ? problems : all.filter((d) => d.category === c).length;
              if (c === "Problems" && problems === 0) return null;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                    active ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#dce2eb] bg-white text-[#5b6577] hover:bg-[#f7f9fc]"
                  } ${c === "Problems" && !active ? "text-[#b45309]" : ""}`}
                >
                  {c} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>

          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, maker, class or hardware ID…"
            className={fieldClass}
            aria-label="Filter devices"
          />

          {list.length === 0 ? (
            <EmptyState icon={Cpu} title="No devices match" />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((d) => (
                <li key={d.instanceId} className="flex items-start justify-between gap-3 rounded-[12px] border border-[#eef1f5] p-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[13px] font-semibold text-[#172033]" title={d.name}>
                      {d.name}
                    </p>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-[#788397]">
                      {d.category}
                      {d.manufacturer ? ` · ${d.manufacturer}` : ""}
                    </p>
                    {d.problemText && <p className="m-0 mt-1 text-[11px] leading-[1.5] text-[#b91c1c]">{d.problemText}</p>}
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-2">
                    <HealthBadge health={d.health}>{d.problemCode !== 0 ? `Code ${d.problemCode}` : d.status}</HealthBadge>
                    <button
                      type="button"
                      className={`${d.health === "ok" ? secondaryButtonClass : buttonClass} px-2.5 py-1.5`}
                      onClick={() => openProps.run(d.instanceId)}
                      disabled={openProps.running}
                      title="Open this device in Windows Device Manager"
                    >
                      <ExternalLink size={13} /> Properties
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
