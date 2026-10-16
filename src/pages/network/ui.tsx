import { AlertTriangle, CheckCircle2, CircleMinus, Loader2, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { NetError, StepStatus, TestStep } from "../../lib/api";
import { cardClass } from "../../styles";

export const buttonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border-none bg-[#2563eb] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#2563eb]";
export const secondaryButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[#dce2eb] bg-white px-3.5 py-2 text-xs font-semibold text-[#344054] transition-colors hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-60";
export const dangerButtonClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[9px] border-none bg-[#dc2626] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-60";
export const fieldClass =
  "h-10 w-full rounded-[9px] border border-[#dce2eb] bg-white px-3 text-xs text-[#172033] outline-none placeholder:text-[#a0a9b8] focus:border-[#3b82f6] focus:shadow-[0_0_0_3px_#3b82f61a]";

export type Tone = "ok" | "warn" | "error" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  ok: "bg-[#ecfdf3] text-[#067647]",
  warn: "bg-[#fef3c7] text-[#b45309]",
  error: "bg-[#fef2f2] text-[#b91c1c]",
  neutral: "bg-[#f3f5f8] text-[#5b6577]",
  info: "bg-[#eef4ff] text-[#1d4ed8]",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${cardClass} min-w-0 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-bold text-[#172033]">{title}</h2>
          {description && <p className="m-0 mt-1 text-xs leading-[1.6] text-[#788397]">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="m-0 rounded-[10px] bg-[#fef2f2] px-4 py-3 text-xs leading-[1.6] text-[#b91c1c]">{message}</p>;
}

export function NetErrorNote({ error }: { error: NetError }) {
  return (
    <div className="rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-xs leading-[1.6] text-[#7f1d1d]">
      <p className="m-0 font-semibold text-[#b91c1c]">
        {error.title}
        {error.code > 0 && <span className="font-normal text-[#b91c1c]/70"> · error {error.code}</span>}
      </p>
      <p className="m-0 mt-1">{error.explanation}</p>
      {error.hint && <p className="m-0 mt-1"><span className="font-semibold">What to do: </span>{error.hint}</p>}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-xs text-[#5b6577]" role="status">
      <Loader2 size={16} className="animate-spin text-[#2563eb]" />
      {label}
    </div>
  );
}

/** Label/value rows. Values of `null` render as an em dash. */
export function Facts({ items, columns = 2 }: { items: [string, ReactNode | null | undefined][]; columns?: 1 | 2 | 3 }) {
  const grid = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={`m-0 grid gap-x-6 gap-y-3 ${grid}`}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10px] font-semibold tracking-[0.6px] text-[#8b95a6] uppercase">{label}</dt>
          <dd className="m-0 mt-0.5 text-[13px] break-words text-[#172033]">
            {value === null || value === undefined || value === "" ? <span className="text-[#a0a9b8]">—</span> : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const STEP_STYLES: Record<StepStatus, { icon: LucideIcon; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: "bg-[#ecfdf3] text-[#16a34a]", label: "Passed" },
  warn: { icon: AlertTriangle, className: "bg-[#fef3c7] text-[#b45309]", label: "Warning" },
  fail: { icon: XCircle, className: "bg-[#fef2f2] text-[#dc2626]", label: "Failed" },
  skip: { icon: CircleMinus, className: "bg-[#f3f5f8] text-[#8b95a6]", label: "Skipped" },
};

export function StepList({ steps }: { steps: TestStep[] }) {
  return (
    <ol className="m-0 grid list-none gap-2 p-0">
      {steps.map((step) => {
        const style = STEP_STYLES[step.status];
        const Icon = style.icon;
        return (
          <li key={step.id} className="flex items-start gap-3 rounded-[12px] border border-[#eef1f5] px-3 py-3">
            <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] ${style.className}`}>
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[13px] font-semibold text-[#172033]">{step.title}</p>
                <span className="text-[10px] font-semibold text-[#8b95a6]">
                  {style.label}
                  {step.status !== "skip" && step.durationMs > 0 ? ` · ${step.durationMs} ms` : ""}
                </span>
              </div>
              <p className="m-0 mt-1 text-xs leading-[1.6] break-words text-[#5b6577]">{step.detail}</p>
              {step.hint && (
                <p className="m-0 mt-1.5 rounded-[8px] bg-[#f7f9fc] px-2.5 py-1.5 text-xs leading-[1.6] text-[#344054]">
                  <span className="font-semibold">Suggested fix: </span>
                  {step.hint}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f3f5f8] text-[#8b95a6]">
        <Icon size={22} />
      </span>
      <p className="m-0 text-sm font-semibold text-[#344054]">{title}</p>
      {children && <div className="m-0 max-w-[380px] text-xs leading-[1.6] text-[#8b95a6]">{children}</div>}
    </div>
  );
}

/** A modal dialog. Closing is disabled while `busy`. */
export function Dialog({
  title,
  onClose,
  busy = false,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#101827]/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(16,24,40,0.25)]">
        <h2 className="m-0 mb-3 text-base font-bold text-[#172033]">{title}</h2>
        <div className="grid gap-3 text-xs leading-[1.7] text-[#5b6577]">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
