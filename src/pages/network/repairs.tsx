import { CheckCircle2, CircleSlash, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { api, type RepairAction, type RepairOutcome } from "../../lib/api";
import { repairInfo } from "./repairCatalog";
import { useBackendAction } from "../../lib/useBackendAction";
import { Dialog, ErrorNote, buttonClass, secondaryButtonClass, Spinner } from "./ui";

const OUTCOME_STYLE: Record<RepairOutcome["status"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "text-[#16a34a]", label: "Repair completed" },
  partial: { icon: ShieldAlert, className: "text-[#b45309]", label: "Completed with warnings" },
  failed: { icon: XCircle, className: "text-[#dc2626]", label: "Repair failed" },
  cancelled: { icon: CircleSlash, className: "text-[#6b7280]", label: "Cancelled" },
};

/** Confirms a repair, runs it, and shows the outcome. */
export function RepairDialog({ action, onClose, onDone }: { action: RepairAction; onClose: () => void; onDone?: (o: RepairOutcome) => void }) {
  const info = repairInfo(action);
  const repair = useBackendAction(api.netRepair);
  const outcome = repair.result;

  const start = async () => {
    const result = await repair.run(action);
    if (result) onDone?.(result);
  };

  if (outcome) {
    const style = OUTCOME_STYLE[outcome.status];
    const Icon = style.icon;
    return (
      <Dialog
        title={info.title}
        onClose={onClose}
        footer={
          <button type="button" className={buttonClass} onClick={onClose}>
            Close
          </button>
        }
      >
        <p className={`m-0 flex items-center gap-2 text-sm font-semibold ${style.className}`}>
          <Icon size={18} /> {style.label}
        </p>
        <p className="m-0">{outcome.message}</p>
        {outcome.restartRequired && (
          <p className="m-0 flex items-start gap-2 rounded-[10px] bg-[#fef3c7] px-3 py-2.5 text-[#92400e]">
            <RotateCcw size={15} className="mt-0.5 flex-shrink-0" />
            Restart the computer to finish this repair. Save your work first. VocaTechX does not restart automatically.
          </p>
        )}
        {outcome.output && (
          <details>
            <summary className="cursor-pointer font-semibold text-[#344054]">Command output</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-[8px] bg-[#101827] p-3 text-[11px] leading-[1.5] whitespace-pre-wrap text-[#cbd5e1]">
              {outcome.output}
            </pre>
          </details>
        )}
        <p className="m-0 text-[11px] text-[#8b95a6]">Saved to Network Center history.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`${info.title}?`}
      onClose={onClose}
      busy={repair.running}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={repair.running}>
            Cancel
          </button>
          <button type="button" className={buttonClass} onClick={start} disabled={repair.running}>
            {repair.running ? "Working…" : info.admin ? "Continue as administrator" : "Run repair"}
          </button>
        </>
      }
    >
      {repair.running ? (
        <Spinner label={info.admin ? "Approve the Windows administrator prompt if it appears, then wait…" : "Running…"} />
      ) : (
        <>
          <p className="m-0"><span className="font-semibold text-[#344054]">Fixes: </span>{info.fixes}</p>
          <p className="m-0"><span className="font-semibold text-[#344054]">What happens: </span>{info.effect}</p>
          {info.admin && (
            <p className="m-0 rounded-[10px] bg-[#eef4ff] px-3 py-2.5 text-[#1e40af]">
              Windows will ask for administrator permission. If you are not an administrator, an administrator must approve it.
            </p>
          )}
          {info.restart && (
            <p className="m-0 rounded-[10px] bg-[#fef3c7] px-3 py-2.5 text-[#92400e]">
              A restart is required afterwards. Network connections may not work properly until you restart.
            </p>
          )}
          <ErrorNote message={repair.error} />
        </>
      )}
    </Dialog>
  );
}
