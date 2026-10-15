import { Bot, Database, ShieldCheck, WifiOff, type LucideIcon } from "lucide-react";
import type { RalpStatus, SessionUser, SystemStatus } from "../lib/api";

type Tone = "ok" | "neutral" | "error";

const TONE_STYLES: Record<Tone, string> = {
  ok: "bg-[#ecfdf3] text-[#067647]",
  neutral: "bg-[#f3f5f8] text-[#5b6577]",
  error: "bg-[#fef2f2] text-[#b91c1c]",
};

type StatusRow = { icon: LucideIcon; label: string; value: string; detail: string; tone: Tone };

function ralpRow(ralp: RalpStatus | undefined): StatusRow {
  const row = (value: string, detail: string, tone: Tone): StatusRow => ({ icon: Bot, label: "Ralp (local AI)", value, detail, tone });
  const model = ralp?.modelName ?? "The model";
  switch (ralp?.state) {
    case "ready":
      return row("Running", `${model} is loaded and answering offline.`, "ok");
    case "starting":
      return row("Starting", `Loading ${model} into memory.`, "neutral");
    case "stopped":
      return row("Installed", `${model} is ready. Ralp starts when you open AI Troubleshooter.`, "ok");
    case "model_missing":
      return row("Model not found", "Open AI Troubleshooter to import Ralp's model file.", "neutral");
    case "runtime_missing":
    case "error":
      return row(ralp.state === "error" ? "Error" : "Engine missing", ralp.message ?? "Ralp is unavailable.", "error");
    default:
      return row("Checking…", "", "neutral");
  }
}

function rows(status: SystemStatus | null, error: string | null, user: SessionUser): StatusRow[] {
  const database: StatusRow = error
    ? { icon: Database, label: "Local database", value: "Unavailable", detail: error, tone: "error" }
    : status
      ? {
          icon: Database,
          label: "Local database",
          value: status.databaseReady ? "Ready" : "Not ready",
          detail: `SQLite · schema v${status.schemaVersion}`,
          tone: status.databaseReady ? "ok" : "error",
        }
      : { icon: Database, label: "Local database", value: "Checking…", detail: "", tone: "neutral" };

  return [
    database,
    {
      icon: WifiOff,
      label: "Offline operation",
      value: status && !status.networkRequired ? "Supported" : "Checking…",
      detail: "Accounts, settings and logs are stored on this computer. No internet connection is required.",
      tone: status ? "ok" : "neutral",
    },
    ralpRow(status?.ralp),
    {
      icon: ShieldCheck,
      label: "Session",
      value: "Signed in",
      detail: `${user.username} · ends when you log out or close VocaTechX.`,
      tone: "ok",
    },
  ];
}

type SystemStatusPanelProps = {
  status: SystemStatus | null;
  error: string | null;
  user: SessionUser;
};

export function SystemStatusPanel({ status, error, user }: SystemStatusPanelProps) {
  return (
    <ul className="m-0 grid list-none gap-4 p-0">
      {rows(status, error, user).map(({ icon: Icon, label, value, detail, tone }) => (
        <li key={label} className="flex items-start gap-3">
          <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[9px] bg-[#f3f5f8] text-[#5b6577]">
            <Icon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[13px] font-semibold text-[#172033]">{label}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONE_STYLES[tone]}`}>
                {value}
              </span>
            </div>
            {detail && <p className="m-0 mt-1 text-[11px] leading-[1.6] text-[#788397]">{detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
