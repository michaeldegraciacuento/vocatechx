import type { ReactNode } from "react";
import type { Health } from "../../lib/api";
import { Badge, type Tone } from "../network/ui";

// The Network Center building blocks (Panel, Facts, Spinner, ErrorNote,
// EmptyState, Dialog, button classes) are imported straight from "../network/ui"
// by each tab so the two modules look and behave identically. This file adds
// only the device-specific components.

const HEALTH_TONE: Record<Health | "ok" | "warn" | "error", Tone> = {
  ok: "ok",
  warn: "warn",
  error: "error",
  offline: "neutral",
};

/** A status pill coloured by a backend health value. Text, not colour alone,
 *  always carries the meaning. */
export function HealthBadge({ health, children }: { health: Health | "ok" | "warn" | "error"; children: ReactNode }) {
  return <Badge tone={HEALTH_TONE[health] ?? "neutral"}>{children}</Badge>;
}

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[#067647]",
  warn: "text-[#b45309]",
  error: "text-[#b91c1c]",
  neutral: "text-[#172033]",
  info: "text-[#1d4ed8]",
};

/** A compact two-line summary card for the module header. */
export function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-[#e3e8ef] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#eef4ff] text-[#2563eb]">{icon}</span>
        <p className="m-0 text-xs font-semibold text-[#5b6577]">{label}</p>
      </div>
      <div className={`min-w-0 truncate text-xl font-bold tracking-[-0.4px] ${TONE_TEXT[tone]}`}>{value}</div>
      {detail && <p className="m-0 truncate text-[11px] text-[#788397]">{detail}</p>}
    </div>
  );
}
