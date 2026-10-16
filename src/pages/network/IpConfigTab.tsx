import { Calculator, CheckCircle2, Dices, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type NetworkAdapter } from "../../lib/api";
import { useBackendData } from "../../lib/useBackendData";
import { calculateSubnet, formatIpv4, parseIpv4, parseSubnetInput, prefixToMask, type SubnetInfo } from "../../lib/subnet";
import { Badge, EmptyState, ErrorNote, Facts, Panel, Spinner, buttonClass, fieldClass, secondaryButtonClass } from "./ui";

function Binary({ value, prefix }: { value: string; prefix: number }) {
  let bit = 0;
  return (
    <span className="font-mono text-[11px] tracking-[0.5px]">
      {value.split("").map((c, i) => {
        if (c === ".") return <span key={i} className="text-[#a0a9b8]">.</span>;
        const network = bit++ < prefix;
        return (
          <span key={i} className={network ? "font-semibold text-[#1d4ed8]" : "text-[#b45309]"}>
            {c}
          </span>
        );
      })}
    </span>
  );
}

function SubnetFacts({ info }: { info: SubnetInfo }) {
  return (
    <div className="grid gap-4">
      <Facts
        columns={3}
        items={[
          ["Network address", `${info.network}/${info.prefix}`],
          ["Subnet mask", info.mask],
          ["Broadcast address", info.broadcast],
          ["Usable host range", `${info.firstHost} – ${info.lastHost}`],
          ["Usable hosts", info.usableHosts.toLocaleString()],
          ["Wildcard mask", info.wildcard],
          ["Total addresses", info.totalAddresses.toLocaleString()],
          ["Class", info.ipClass],
          ["Address type", info.scope],
        ]}
      />
      <div className="grid gap-1 rounded-[10px] bg-[#f7f9fc] px-3 py-2.5">
        <p className="m-0 text-[10px] font-semibold tracking-[0.6px] text-[#8b95a6] uppercase">Binary</p>
        <p className="m-0 flex flex-wrap gap-x-3 text-xs">
          <span className="w-14 text-[#5b6577]">Address</span> <Binary value={info.binaryAddress} prefix={info.prefix} />
        </p>
        <p className="m-0 flex flex-wrap gap-x-3 text-xs">
          <span className="w-14 text-[#5b6577]">Mask</span> <Binary value={info.binaryMask} prefix={info.prefix} />
        </p>
        <p className="m-0 mt-1 text-[11px] text-[#788397]">
          <span className="font-semibold text-[#1d4ed8]">Blue</span> bits identify the network;{" "}
          <span className="font-semibold text-[#b45309]">orange</span> bits identify the host.
        </p>
      </div>
    </div>
  );
}

function CurrentConfig({ adapters }: { adapters: NetworkAdapter[] }) {
  const configured = adapters.filter((a) => a.status === "connected" && a.ipv4.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const adapter = configured.find((a) => a.id === selectedId) ?? configured.find((a) => a.isPrimary) ?? configured[0];

  if (!adapter) {
    return <EmptyState icon={Calculator} title="No connected adapter has an IPv4 address" />;
  }
  const entry = adapter.ipv4[0];
  const ip = parseIpv4(entry.address);
  const info = ip !== null ? calculateSubnet(ip, entry.prefixLength) : null;
  const gateway = adapter.gateways.find((g) => !g.includes(":"));
  const gatewayValue = gateway ? parseIpv4(gateway) : null;
  const gatewayInSubnet =
    info && gatewayValue !== null && ((gatewayValue & prefixToMask(entry.prefixLength)) >>> 0) === parseIpv4(info.network);

  return (
    <div className="grid gap-4">
      {configured.length > 1 && (
        <select
          className={`${fieldClass} max-w-[320px]`}
          value={adapter.id}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Adapter"
        >
          {configured.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <Facts
        columns={3}
        items={[
          ["Adapter", adapter.name],
          [
            "Configuration",
            adapter.dhcpEnabled ? (
              <span className="flex items-center gap-2">DHCP <Badge tone="info">automatic</Badge></span>
            ) : (
              <span className="flex items-center gap-2">Static <Badge tone="neutral">manual</Badge></span>
            ),
          ],
          ["DHCP server", adapter.dhcpEnabled ? adapter.dhcpServer : "Not used"],
          ["IPv4 address", entry.address],
          ["Default gateway", gateway],
          ["DNS servers", adapter.dnsServers.filter((d) => !d.includes(":")).join(", ") || null],
        ]}
      />
      {adapter.apipa && (
        <ErrorNote message="This is a self-assigned (APIPA) address: no DHCP server answered. Try Renew DHCP in the Repair tab." />
      )}
      {gateway && gatewayInSubnet === false && (
        <ErrorNote message={`The gateway ${gateway} is outside this subnet, so the computer cannot reach it. Check the static IP settings.`} />
      )}
      {info && <SubnetFacts info={info} />}
    </div>
  );
}

const PRACTICE_PREFIXES = [8, 12, 16, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30];

const randomInt = (max: number) => Math.floor(Math.random() * max);

/** A random private-range host address and prefix to practise on. */
function randomPractice() {
  const octets = [
    [10, randomInt(256)],
    [172, 16 + randomInt(16)],
    [192, 168],
  ][randomInt(3)];
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (randomInt(256) << 8) | (1 + randomInt(254))) >>> 0;
  return { ip, prefix: PRACTICE_PREFIXES[randomInt(PRACTICE_PREFIXES.length)] };
}

function Practice() {
  const [question, setQuestion] = useState(randomPractice);
  const [network, setNetwork] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [hosts, setHosts] = useState("");
  const [checked, setChecked] = useState(false);
  const answer = useMemo(() => calculateSubnet(question.ip, question.prefix), [question]);

  const next = () => {
    setQuestion(randomPractice());
    setNetwork("");
    setBroadcast("");
    setHosts("");
    setChecked(false);
  };

  const rows: [string, string, string, (v: string) => void][] = [
    ["Network address", network, answer.network, setNetwork],
    ["Broadcast address", broadcast, answer.broadcast, setBroadcast],
    ["Usable hosts", hosts, String(answer.usableHosts), setHosts],
  ];

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[13px] text-[#172033]">
        Host <span className="font-mono font-semibold">{formatIpv4(question.ip)}/{question.prefix}</span>
        <span className="text-[#8b95a6]"> (mask {answer.mask})</span>
      </p>
      {rows.map(([label, value, correct, set]) => {
        const ok = value.trim().replace(/,/g, "") === correct;
        return (
          <label key={label} className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
            {label}
            <span className="flex items-center gap-2">
              <input className={fieldClass} value={value} onChange={(e) => set(e.target.value)} disabled={checked} />
              {checked && (ok ? <CheckCircle2 size={18} className="flex-shrink-0 text-[#16a34a]" /> : <XCircle size={18} className="flex-shrink-0 text-[#dc2626]" />)}
            </span>
            {checked && !ok && <span className="font-normal text-[#b91c1c]">Answer: {correct}</span>}
          </label>
        );
      })}
      <div className="flex gap-2">
        {checked ? (
          <button type="button" className={buttonClass} onClick={next}>
            <Dices size={14} /> Next question
          </button>
        ) : (
          <>
            <button type="button" className={buttonClass} onClick={() => setChecked(true)}>
              Check answers
            </button>
            <button type="button" className={secondaryButtonClass} onClick={next}>
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function IpConfigTab() {
  const adapters = useBackendData(api.netAdapters);
  const [address, setAddress] = useState("192.168.1.10/24");
  const [mask, setMask] = useState("");
  const parsed = parseSubnetInput(address, mask);

  return (
    <div className="grid gap-5">
      <Panel title="Current IP configuration" description="How this computer's address is set up, and the subnet it belongs to.">
        {adapters.loading && !adapters.data ? (
          <Spinner label="Reading IP configuration…" />
        ) : adapters.error ? (
          <ErrorNote message={adapters.error} />
        ) : (
          <CurrentConfig adapters={adapters.data ?? []} />
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="IPv4 subnet calculator" description="Enter an address with a prefix (192.168.1.10/24) or with a subnet mask." className="lg:col-span-2">
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
              IP address
              <input className={fieldClass} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.10/24" />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
              Subnet mask or prefix (if not in the address)
              <input className={fieldClass} value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.255.255.0 or 24" />
            </label>
          </div>
          {typeof parsed === "string" ? <ErrorNote message={parsed} /> : <SubnetFacts info={calculateSubnet(parsed.ip, parsed.prefix)} />}
        </Panel>

        <Panel title="Subnetting practice" description="Work out the answers, then check them.">
          <Practice />
        </Panel>
      </div>
    </div>
  );
}
