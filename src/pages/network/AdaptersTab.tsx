import { Cable, Check, Copy, Eye, EyeOff, KeyRound, Layers, Network, RefreshCw, Settings2, Wifi, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { api, type AdapterKind, type NetworkAdapter, type SettingsPage } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { useBackendData } from "../../lib/useBackendData";
import { Badge, EmptyState, ErrorNote, Facts, Panel, Spinner, secondaryButtonClass, type Tone } from "./ui";
import { formatBps } from "../../lib/format";

const KIND: Record<AdapterKind, { icon: LucideIcon; label: string }> = {
  ethernet: { icon: Cable, label: "Ethernet" },
  wifi: { icon: Wifi, label: "Wi-Fi" },
  virtual: { icon: Layers, label: "Virtual" },
  other: { icon: Network, label: "Other" },
};

const STATUS: Record<NetworkAdapter["status"], { tone: Tone; label: string }> = {
  connected: { tone: "ok", label: "Connected" },
  disconnected: { tone: "neutral", label: "Disconnected" },
  disabled: { tone: "warn", label: "Disabled" },
};

type Filter = "physical" | "all";

const AUTH_LABEL: Record<string, string> = {
  open: "Open (no password)",
  WPAPSK: "WPA-Personal",
  WPA2PSK: "WPA2-Personal",
  WPA3SAE: "WPA3-Personal",
  WPA: "WPA-Enterprise",
  WPA2: "WPA2-Enterprise",
  WPA3ENT192: "WPA3-Enterprise",
};

/** The saved password of the connected Wi-Fi network, hidden until asked for. */
function WifiPasswordRow({ adapterId }: { adapterId: string }) {
  const reveal = useBackendAction(api.netWifiPassword);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [asked, setAsked] = useState(false);
  const wifi = reveal.result;

  const show = async () => {
    if (wifi) return setVisible(true);
    setAsked(true);
    if (await reveal.run(adapterId)) setVisible(true);
  };

  const copy = async () => {
    if (!wifi?.password) return;
    try {
      await navigator.clipboard.writeText(wifi.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  // run() resolves to null both on error and when the UAC prompt is declined.
  const declined = asked && !reveal.running && !reveal.error && reveal.result === null;

  return (
    <div className="mt-4 rounded-[10px] bg-[#f7f9fc] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <KeyRound size={15} className="flex-shrink-0 text-[#5b6577]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[10px] font-semibold tracking-[0.6px] text-[#8b95a6] uppercase">
            Wi-Fi password{wifi ? ` · ${wifi.ssid}` : ""}
          </p>
          <p className="m-0 mt-0.5 font-mono text-[13px] break-all text-[#172033]">
            {visible && wifi ? (wifi.password ?? <span className="font-sans text-[#5b6577]">This network has no password.</span>) : "••••••••••"}
          </p>
          {visible && wifi && (
            <p className="m-0 mt-0.5 text-[10px] text-[#8b95a6]">{AUTH_LABEL[wifi.authentication] ?? wifi.authentication}</p>
          )}
        </div>
        {visible && wifi ? (
          <>
            {wifi.password && (
              <button type="button" className={secondaryButtonClass} onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
              </button>
            )}
            <button type="button" className={secondaryButtonClass} onClick={() => setVisible(false)}>
              <EyeOff size={13} /> Hide
            </button>
          </>
        ) : (
          <button type="button" className={secondaryButtonClass} onClick={show} disabled={reveal.running}>
            <Eye size={13} /> {reveal.running ? "Reading…" : "Show"}
          </button>
        )}
      </div>
      {reveal.running && (
        <p className="m-0 mt-2 text-[11px] text-[#5b6577]">If Windows asks for administrator permission, approve it to continue.</p>
      )}
      {declined && <p className="m-0 mt-2 text-[11px] text-[#5b6577]">The administrator prompt was declined.</p>}
      {reveal.error && (
        <div className="mt-2">
          <ErrorNote message={reveal.error} />
        </div>
      )}
    </div>
  );
}

function AdapterCard({ adapter }: { adapter: NetworkAdapter }) {
  const kind = KIND[adapter.kind];
  const status = STATUS[adapter.status];
  const Icon = kind.icon;
  const ipv4 = adapter.ipv4.map((e) => `${e.address}/${e.prefixLength}`);
  const ipv6 = adapter.ipv6.map((e) => `${e.address}/${e.prefixLength}`);

  return (
    <li className="rounded-[14px] border border-[#e3e8ef] bg-white p-4">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${
            adapter.status === "connected" ? "bg-[#101827] text-[#7db5ff]" : "bg-[#f3f5f8] text-[#8b95a6]"
          }`}
        >
          <Icon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-[13px] font-semibold text-[#172033]">{adapter.name}</p>
            <Badge tone={status.tone}>{status.label}</Badge>
            {adapter.isPrimary && <Badge tone="info">Internet connection</Badge>}
            {adapter.apipa && <Badge tone="error">Self-assigned IP</Badge>}
          </div>
          <p className="m-0 mt-0.5 truncate text-[11px] text-[#788397]" title={adapter.description}>
            {kind.label} · {adapter.description}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {adapter.status === "connected" ? (
          <Facts
            columns={3}
            items={[
              ["IPv4", ipv4.length ? ipv4.join(", ") : "None"],
              ["Gateway", adapter.gateways.join(", ") || null],
              ["DNS servers", adapter.dnsServers.join(", ") || null],
              ["Addressing", adapter.dhcpEnabled ? "DHCP" : "Static"],
              ["Link speed", formatBps(adapter.linkSpeedBps)],
              ["MAC address", adapter.mac],
            ]}
          />
        ) : (
          <Facts
            columns={3}
            items={[
              ["MAC address", adapter.mac],
              [
                "State",
                adapter.status === "disabled"
                  ? "Turned off in Windows. Enable it in Network Connections."
                  : adapter.kind === "wifi"
                    ? "Not connected to a Wi-Fi network."
                    : adapter.kind === "ethernet"
                      ? "No cable connected, or the other end is off."
                      : "Not connected.",
              ],
            ]}
          />
        )}
        {adapter.kind === "wifi" && adapter.status === "connected" && <WifiPasswordRow adapterId={adapter.id} />}
        {ipv6.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#5b6577]">IPv6 addresses ({ipv6.length})</summary>
            <p className="m-0 mt-1.5 font-mono text-[11px] leading-[1.7] break-all text-[#344054]">{ipv6.join("  ·  ")}</p>
          </details>
        )}
      </div>
    </li>
  );
}

export function AdaptersTab({ onOpenSettings }: { onOpenSettings: (page: SettingsPage) => void }) {
  const adapters = useBackendData(api.netAdapters);
  const [filter, setFilter] = useState<Filter>("physical");

  const list = adapters.data ?? [];
  const shown = filter === "all" ? list : list.filter((a) => a.kind !== "virtual" || a.isPrimary);
  const hiddenCount = list.length - shown.length;

  return (
    <Panel
      title="Network adapters"
      description="Ethernet, Wi-Fi and virtual adapters on this computer, including disconnected and disabled ones."
      actions={
        <>
          <div className="flex rounded-[9px] border border-[#dce2eb] p-0.5" role="group" aria-label="Adapter filter">
            {(["physical", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`cursor-pointer rounded-[7px] border-none px-3 py-1.5 text-[11px] font-semibold ${
                  filter === f ? "bg-[#101827] text-white" : "bg-transparent text-[#5b6577]"
                }`}
              >
                {f === "physical" ? "Physical" : "All adapters"}
              </button>
            ))}
          </div>
          <button type="button" className={secondaryButtonClass} onClick={() => onOpenSettings("network_connections")}>
            <Settings2 size={14} /> Network Connections
          </button>
          <button type="button" className={secondaryButtonClass} onClick={adapters.reload} disabled={adapters.loading}>
            <RefreshCw size={14} className={adapters.loading ? "animate-spin" : ""} /> Refresh
          </button>
        </>
      }
    >
      {adapters.loading && !adapters.data ? (
        <Spinner label="Reading network adapters…" />
      ) : adapters.error ? (
        <ErrorNote message={adapters.error} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Network} title="No network adapters found">
          Windows reports no network adapters. Check Device Manager for missing drivers.
        </EmptyState>
      ) : (
        <>
          <ul className="m-0 grid list-none gap-3 p-0">
            {shown.map((adapter) => (
              <AdapterCard key={adapter.id || adapter.name} adapter={adapter} />
            ))}
          </ul>
          {hiddenCount > 0 && (
            <p className="m-0 mt-3 text-[11px] text-[#8b95a6]">
              {hiddenCount} virtual adapter{hiddenCount === 1 ? "" : "s"} (VPN, Hyper-V, Wi-Fi Direct and similar) hidden. Choose
              "All adapters" to show them.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
