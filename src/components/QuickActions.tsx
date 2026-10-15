import { ChevronRight } from "lucide-react";
import { navItem, type PageId } from "../navigation";

const ACTIONS: { page: PageId; label: string }[] = [
  { page: "ai-troubleshooter", label: "AI Troubleshooter" },
  { page: "network-center", label: "Network Diagnostics" },
  { page: "printer-devices", label: "Printer & Devices" },
  { page: "windows-repair", label: "Windows Repair" },
  { page: "learning-library", label: "CSS Learning Library" },
];

export function QuickActions({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {ACTIONS.map(({ page, label }) => {
        const { icon: Icon, available } = navItem(page);
        return (
          <button
            key={page}
            type="button"
            onClick={() => onNavigate(page)}
            className="group flex cursor-pointer flex-col items-start gap-3 rounded-[14px] border border-[#e3e8ef] bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#bfd4fb] hover:shadow-[0_8px_20px_rgba(37,99,235,0.08)]"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#101827] text-[#7db5ff]">
              <Icon size={20} />
            </span>
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[#172033]">{label}</span>
              <ChevronRight size={15} className="text-[#a0a9b8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#2563eb]" />
            </span>
            {available ? (
              <span className="rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[10px] font-semibold text-[#067647]">Available</span>
            ) : (
              <span className="rounded-full bg-[#f3f5f8] px-2 py-0.5 text-[10px] font-semibold text-[#788397]">
                Coming soon
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
