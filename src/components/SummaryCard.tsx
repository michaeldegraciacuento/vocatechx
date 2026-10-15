import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cardClass } from "../styles";

type SummaryCardProps = {
  icon: LucideIcon;
  label: string;
  /** Main figure. `null` renders an honest "unavailable" state. */
  value: ReactNode | null;
  detail?: ReactNode;
  /** 0–100; renders a usage bar when provided. */
  percent?: number | null;
  loading?: boolean;
  unavailableText?: string;
};

function barColor(percent: number) {
  if (percent >= 90) return "bg-[#dc2626]";
  if (percent >= 75) return "bg-[#f59e0b]";
  return "bg-[#3b82f6]";
}

export function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  percent,
  loading = false,
  unavailableText = "Not available",
}: SummaryCardProps) {
  return (
    <div className={`${cardClass} flex min-w-0 flex-col gap-3`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#eef4ff] text-[#2563eb]">
          <Icon size={17} />
        </span>
        <p className="m-0 text-xs font-semibold text-[#5b6577]">{label}</p>
      </div>

      {loading ? (
        <div className="grid gap-2" aria-label="Loading">
          <span className="h-6 w-24 animate-pulse rounded bg-[#eef1f5]" />
          <span className="h-3 w-36 animate-pulse rounded bg-[#eef1f5]" />
        </div>
      ) : value === null ? (
        <div>
          <p className="m-0 text-lg font-semibold text-[#a0a9b8]">—</p>
          <p className="m-0 mt-1 text-[11px] text-[#8b95a6]">{unavailableText}</p>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="m-0 truncate text-2xl font-bold tracking-[-0.6px] text-[#172033]">{value}</p>
          {detail && <p className="m-0 mt-1 truncate text-[11px] text-[#788397]">{detail}</p>}
        </div>
      )}

      {!loading && percent != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[#eef1f5]" role="presentation">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${barColor(percent)}`}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      )}
    </div>
  );
}
