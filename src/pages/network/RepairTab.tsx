import { ExternalLink, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import type { RepairAction, SettingsPage } from "../../lib/api";
import { REPAIRS } from "./repairCatalog";
import { Badge, Panel, secondaryButtonClass } from "./ui";

const SETTINGS: { page: SettingsPage; label: string; detail: string }[] = [
  { page: "network_status", label: "Network & Internet status", detail: "Windows Settings overview and network reset" },
  { page: "wifi_settings", label: "Wi-Fi settings", detail: "Known networks and Wi-Fi options" },
  { page: "network_connections", label: "Network Connections", detail: "Enable/disable adapters, IPv4 and DNS settings" },
  { page: "advanced_sharing", label: "Advanced sharing settings", detail: "Network discovery and file sharing" },
];

type RepairTabProps = { onRepair: (action: RepairAction) => void; onOpenSettings: (page: SettingsPage) => void };

export function RepairTab({ onRepair, onOpenSettings }: RepairTabProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title="Quick repair tools"
        description="Run diagnostics first when you can: it tells you which repair fits. Every repair asks for confirmation and is saved to History."
        className="lg:col-span-2"
      >
        <ul className="m-0 grid list-none gap-3 p-0">
          {REPAIRS.map((repair) => (
            <li key={repair.action} className="flex flex-wrap items-start gap-4 rounded-[14px] border border-[#e3e8ef] p-4">
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-[#101827] text-[#7db5ff]">
                <Wrench size={18} />
              </span>
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[13px] font-semibold text-[#172033]">{repair.title}</p>
                  {repair.admin ? (
                    <Badge tone="info">
                      <ShieldCheck size={10} className="mr-1 inline" />
                      Administrator
                    </Badge>
                  ) : (
                    <Badge tone="ok">No admin needed</Badge>
                  )}
                  {repair.restart && (
                    <Badge tone="warn">
                      <RotateCcw size={10} className="mr-1 inline" />
                      Restart required
                    </Badge>
                  )}
                </div>
                <p className="m-0 mt-1 text-xs leading-[1.6] text-[#5b6577]">
                  <span className="font-semibold text-[#344054]">Fixes: </span>
                  {repair.fixes}
                </p>
                <p className="m-0 mt-0.5 text-xs leading-[1.6] text-[#788397]">{repair.effect}</p>
              </div>
              <button type="button" className={secondaryButtonClass} onClick={() => onRepair(repair.action)}>
                Run…
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Windows network settings" description="Opens the Windows page. Changes you make there are not tracked by VocaTechX.">
        <ul className="m-0 grid list-none gap-2 p-0">
          {SETTINGS.map((s) => (
            <li key={s.page}>
              <button
                type="button"
                onClick={() => onOpenSettings(s.page)}
                className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-[10px] border border-[#e3e8ef] bg-white px-3 py-2.5 text-left hover:border-[#bfd4fb] hover:bg-[#f7f9fc]"
              >
                <span>
                  <span className="block text-xs font-semibold text-[#172033]">{s.label}</span>
                  <span className="block text-[11px] text-[#788397]">{s.detail}</span>
                </span>
                <ExternalLink size={14} className="mt-0.5 flex-shrink-0 text-[#8b95a6]" />
              </button>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-3 text-[11px] leading-[1.6] text-[#8b95a6]">
          Suggested order when nothing else works: flush DNS → renew DHCP → reset Winsock → reset TCP/IP → restart.
        </p>
      </Panel>
    </div>
  );
}
