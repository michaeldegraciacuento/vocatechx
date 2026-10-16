import { CheckCircle2, Stethoscope, Wrench, XCircle } from "lucide-react";
import type { DiagnosticReport, RepairAction } from "../../lib/api";
import { repairInfo } from "./repairCatalog";
import { EmptyState, ErrorNote, Panel, Spinner, StepList, buttonClass, secondaryButtonClass } from "./ui";

type DiagnosticsTabProps = {
  report: DiagnosticReport | null;
  running: boolean;
  error: string | null;
  onRun: () => void;
  onRepair: (action: RepairAction) => void;
};

const TEST_ORDER = [
  "Network adapter",
  "This computer (TCP/IP stack)",
  "IP address",
  "Default gateway (router)",
  "Internet (public IP)",
  "DNS resolution",
  "Website connection",
];

export function DiagnosticsTab({ report, running, error, onRun, onRepair }: DiagnosticsTabProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title="Connectivity diagnostics"
        description="Tests each link from this computer to the internet, in order, to find where the connection breaks."
        className="lg:col-span-2"
        actions={
          <button type="button" className={buttonClass} onClick={onRun} disabled={running}>
            <Stethoscope size={15} /> {running ? "Testing…" : report ? "Run again" : "Run tests"}
          </button>
        }
      >
        {running ? (
          <Spinner label="Running tests. This takes about 10 seconds…" />
        ) : error ? (
          <ErrorNote message={error} />
        ) : report ? (
          <div className="grid gap-4">
            <div
              className={`flex items-start gap-3 rounded-[12px] px-4 py-3 ${
                report.healthy ? "bg-[#ecfdf3] text-[#065f46]" : "bg-[#fef2f2] text-[#7f1d1d]"
              }`}
            >
              {report.healthy ? <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" /> : <XCircle size={18} className="mt-0.5 flex-shrink-0" />}
              <div className="text-xs leading-[1.6]">
                <p className="m-0 text-[13px] font-semibold">{report.summary}</p>
                {report.failurePoint && <p className="m-0 mt-0.5">Likely failure point: {report.failurePoint}</p>}
              </div>
            </div>
            <StepList steps={report.steps} />
          </div>
        ) : (
          <EmptyState icon={Stethoscope} title="No test run yet">
            Choose Run tests to check the adapter, local TCP/IP, IP address, router, internet and DNS.
          </EmptyState>
        )}
      </Panel>

      <div className="grid content-start gap-5">
        {report && report.recommendedRepairs.length > 0 && !running && (
          <Panel title="Recommended repairs" description="Based on the failed test. You will be asked to confirm.">
            <div className="grid gap-2">
              {report.recommendedRepairs.map((action) => (
                <button key={action} type="button" className={`${secondaryButtonClass} justify-start`} onClick={() => onRepair(action)}>
                  <Wrench size={14} /> {repairInfo(action).title}
                </button>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="What is tested">
          <ol className="m-0 grid gap-1.5 pl-4 text-xs leading-[1.6] text-[#5b6577]">
            {TEST_ORDER.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          <p className="m-0 mt-3 text-[11px] leading-[1.6] text-[#8b95a6]">
            The first failing test is the most likely cause; later tests depend on it. Results are saved to History.
          </p>
        </Panel>
      </div>
    </div>
  );
}
