import { CheckCircle2, CircleSlash, ClipboardList, Loader2, XCircle } from "lucide-react";
import type { ActivityItem } from "../lib/api";
import { formatRelativeTime, humanizeIdentifier } from "../lib/format";

const STATUS_STYLES: Record<ActivityItem["status"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "text-[#16a34a] bg-[#ecfdf3]", label: "Completed" },
  failed: { icon: XCircle, className: "text-[#dc2626] bg-[#fef2f2]", label: "Failed" },
  running: { icon: Loader2, className: "text-[#2563eb] bg-[#eef4ff]", label: "Running" },
  cancelled: { icon: CircleSlash, className: "text-[#6b7280] bg-[#f3f4f6]", label: "Cancelled" },
};

type ActivityListProps = {
  items: ActivityItem[] | null;
  loading: boolean;
  error: string | null;
};

export function ActivityList({ items, loading, error }: ActivityListProps) {
  if (loading) {
    return (
      <ul className="m-0 grid list-none gap-3 p-0" aria-label="Loading activity">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-12 animate-pulse rounded-[10px] bg-[#f3f5f8]" />
        ))}
      </ul>
    );
  }

  if (error) {
    return <p className="m-0 rounded-[10px] bg-[#fef2f2] px-4 py-3 text-xs text-[#b91c1c]">{error}</p>;
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f3f5f8] text-[#8b95a6]">
          <ClipboardList size={22} />
        </span>
        <p className="m-0 text-sm font-semibold text-[#344054]">No activity yet</p>
        <p className="m-0 max-w-[300px] text-xs leading-[1.6] text-[#8b95a6]">
          Diagnostic and repair operations you run in VocaTechX will appear here.
        </p>
      </div>
    );
  }

  return (
    // grid-cols-1 (minmax(0, 1fr)) keeps long titles/summaries from widening the
    // column past the card, so `truncate` can take effect.
    <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-1 p-0">
      {items.map((item) => {
        const status = STATUS_STYLES[item.status];
        const Icon = status.icon;
        return (
          <li
            key={item.id}
            className="flex min-w-0 items-center gap-3 rounded-[10px] px-2 py-2.5 hover:bg-[#f7f9fc]"
            title={item.summary ? `${item.title}\n${item.summary}` : item.title}
          >
            <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] ${status.className}`}>
              <Icon size={16} className={item.status === "running" ? "animate-spin" : ""} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[13px] font-semibold text-[#172033]">{item.title}</p>
              <p className="m-0 truncate text-[11px] text-[#788397]">
                {humanizeIdentifier(item.operationType)}
                {item.summary ? ` · ${item.summary}` : ""}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="m-0 text-[11px] font-semibold text-[#5b6577]">{status.label}</p>
              <p className="m-0 text-[10px] text-[#8b95a6]">{formatRelativeTime(item.startedAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
