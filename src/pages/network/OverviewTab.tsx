import { Activity, Globe2, Settings2, Stethoscope, WifiOff } from "lucide-react";
import type { NetworkHealth, SettingsPage } from "../../lib/api";
import { calculateSubnet, parseIpv4 } from "../../lib/subnet";
import { EmptyState, ErrorNote, Facts, Panel, Spinner, Badge, secondaryButtonClass, buttonClass } from "./ui";
import { formatBps, formatMs } from "../../lib/format";

type OverviewTabProps = {
  health: NetworkHealth | null;
  loading: boolean;
  error: string | null;
  onRunDiagnostics: () => void;
  onOpenSettings: (page: SettingsPage) => void;
};

const KIND_LABEL = { ethernet: "Ethernet", wifi: "Wi-Fi", virtual: "Virtual adapter", other: "Other" } as const;

export function OverviewTab({ health, loading, error, onRunDiagnostics, onOpenSettings }: OverviewTabProps) {
  if (loading && !health) return <Spinner label="Checking the network connection…" />;
  if (!health) return <ErrorNote message={error} />;

  const adapter = health.adapter;
  const ipv4 = adapter?.ipv4.find((e) => !e.address.startsWith("169.254.")) ?? adapter?.ipv4[0];
  const parsed = ipv4 ? parseIpv4(ipv4.address) : null;
  const subnet = ipv4 && parsed !== null ? calculateSubnet(parsed, ipv4.prefixLength) : null;
  const gateway = adapter?.gateways.find((g) => !g.includes(":"));
  const internet = health.internet;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title="Active connection"
        description={adapter ? `${adapter.description}` : undefined}
        className="lg:col-span-2"
        actions={
          <button type="button" className={secondaryButtonClass} onClick={() => onOpenSettings("network_status")}>
            <Settings2 size={14} /> Windows network settings
          </button>
        }
      >
        {adapter ? (
          <Facts
            items={[
              ["Adapter", adapter.name],
              ["Connection type", adapter.kind === "wifi" && health.wifiSsid ? `Wi-Fi · ${health.wifiSsid}` : KIND_LABEL[adapter.kind]],
              ["IPv4 address", ipv4 ? `${ipv4.address}/${ipv4.prefixLength}` : null],
              ["Subnet mask", subnet?.mask],
              ["Default gateway", gateway],
              ["DNS servers", adapter.dnsServers.length ? adapter.dnsServers.join(", ") : null],
              ["Address assignment", adapter.dhcpEnabled ? `DHCP${adapter.dhcpServer ? ` (server ${adapter.dhcpServer})` : ""}` : "Static (manual)"],
              ["Link speed", formatBps(adapter.linkSpeedBps)],
              ["MAC address", adapter.mac],
              ["Computer name", health.computerName],
            ]}
          />
        ) : (
          <EmptyState icon={WifiOff} title="No active network connection">
            Plug in a network cable or connect to Wi-Fi.
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => onOpenSettings("wifi_settings")}>
                Wi-Fi settings
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => onOpenSettings("network_connections")}>
                Network Connections
              </button>
            </div>
          </EmptyState>
        )}
      </Panel>

      <div className="grid content-start gap-5">
        <Panel title="Internet availability">
          <ul className="m-0 grid list-none gap-3 p-0">
            <li className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] text-[#344054]">
                <Globe2 size={15} className="text-[#5b6577]" /> Public internet
              </span>
              {internet.reachable ? (
                <Badge tone="ok">Reachable · {formatMs(internet.latencyMs)}</Badge>
              ) : (
                <Badge tone="error">Unreachable</Badge>
              )}
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] text-[#344054]">
                <Activity size={15} className="text-[#5b6577]" /> Name resolution (DNS)
              </span>
              {internet.dnsResolves ? (
                <Badge tone="ok">Working · {formatMs(internet.dnsMs)}</Badge>
              ) : (
                <Badge tone="error">Failing</Badge>
              )}
            </li>
          </ul>
          <p className="m-0 mt-3 text-[11px] leading-[1.6] text-[#788397]">{internet.detail}</p>
        </Panel>

        <Panel title="Something wrong?" description="Run the step-by-step test to find where the connection breaks.">
          <button type="button" className={`${buttonClass} w-full`} onClick={onRunDiagnostics}>
            <Stethoscope size={15} /> Run connectivity diagnostics
          </button>
          <p className="m-0 mt-3 text-[11px] leading-[1.6] text-[#8b95a6]">
            VocaTechX works offline. Internet checks only report whether the internet is reachable; nothing is sent
            except standard ping, DNS and connection tests.
          </p>
        </Panel>
      </div>
    </div>
  );
}
