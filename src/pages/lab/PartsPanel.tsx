import { isRemoved, type SimState } from "./sim/engine";
import { partStatus } from "./sim/status";
import { PART_GROUPS, PARTS, type PartId } from "./sim/parts";

export function PartsPanel({ state, selected, onSelect }: { state: SimState; selected: PartId | null; onSelect: (id: PartId) => void }) {
  return (
    <div className="grid gap-4">
      {PART_GROUPS.map((group) => {
        const parts = Object.values(PARTS).filter((p) => p.group === group);
        return (
          <section key={group}>
            <h3 className="m-0 mb-1.5 text-[10px] font-bold tracking-[0.8px] text-[#8b95a6] uppercase">{group}</h3>
            <ul className="m-0 grid list-none gap-1 p-0">
              {parts.map((p) => {
                const status = partStatus(p.id, state);
                const off = isRemoved(p.id, state);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      aria-pressed={selected === p.id}
                      className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                        selected === p.id ? "border-[#2563eb] bg-[#eef4ff]" : "border-transparent bg-transparent hover:bg-[#f3f5f8]"
                      }`}
                    >
                      <span className="min-w-0 truncate text-xs font-semibold text-[#172033]">{p.name}</span>
                      {status && (
                        <span className={`flex-shrink-0 text-[10px] font-semibold ${off ? "text-[#b45309]" : "text-[#8b95a6]"}`}>{status}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
