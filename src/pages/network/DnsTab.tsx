import { AlertTriangle, CheckCircle2, Eraser, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, type NetworkHealth, type RepairAction } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { Badge, ErrorNote, Panel, Spinner, buttonClass, fieldClass, secondaryButtonClass } from "./ui";

const PUBLIC_RESOLVERS = [
  { ip: "1.1.1.1", label: "Cloudflare" },
  { ip: "8.8.8.8", label: "Google" },
  { ip: "9.9.9.9", label: "Quad9" },
];

type DnsTabProps = { health: NetworkHealth | null; onRepair: (action: RepairAction) => void };

export function DnsTab({ health, onRepair }: DnsTabProps) {
  const configured = health?.adapter?.dnsServers ?? [];
  const configuredV4 = configured.filter((s) => !s.includes(":"));
  const [domain, setDomain] = useState("www.google.com");
  const [selected, setSelected] = useState<string[]>(() => [...configuredV4.slice(0, 2), "1.1.1.1", "8.8.8.8"]);
  const [custom, setCustom] = useState("");
  const lookup = useBackendAction(api.netDnsLookup);

  const candidates = Array.from(new Set([...configured, ...PUBLIC_RESOLVERS.map((r) => r.ip), ...selected]));
  const toggle = (ip: string) => setSelected((s) => (s.includes(ip) ? s.filter((x) => x !== ip) : [...s, ip]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    lookup.run(domain, selected.slice(0, 6));
  };

  const addCustom = () => {
    const ip = custom.trim();
    if (ip && !selected.includes(ip)) setSelected((s) => [...s, ip]);
    setCustom("");
  };

  const label = (server: string) => {
    if (server === "system") return "Windows resolver";
    const known = PUBLIC_RESOLVERS.find((r) => r.ip === server);
    if (known) return `${server} (${known.label})`;
    return configured.includes(server) ? `${server} (configured)` : server;
  };

  const result = lookup.result;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="grid content-start gap-5 lg:col-span-2">
        <Panel
          title="Test and compare DNS"
          description="Resolves a domain through Windows and directly through each chosen DNS server, so you can see which server fails or answers differently."
        >
          <form onSubmit={submit} className="grid gap-3">
            <div className="flex gap-2">
              <input
                className={fieldClass}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="www.example.com"
                aria-label="Domain name"
                maxLength={253}
              />
              <button type="submit" className={buttonClass} disabled={lookup.running || !domain.trim()}>
                <Search size={14} /> {lookup.running ? "Looking up…" : "Look up"}
              </button>
            </div>
            <fieldset className="m-0 border-none p-0">
              <legend className="mb-2 text-[11px] font-semibold text-[#5b6577]">DNS servers to compare (up to 6)</legend>
              <div className="flex flex-wrap gap-2">
                {candidates.map((ip) => (
                  <label
                    key={ip}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
                      selected.includes(ip) ? "border-[#93c5fd] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#dce2eb] bg-white text-[#5b6577]"
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={selected.includes(ip)} onChange={() => toggle(ip)} />
                    {label(ip)}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex max-w-[360px] gap-2">
                <input
                  className={fieldClass}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="Another DNS server IP"
                  aria-label="Custom DNS server"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                />
                <button type="button" className={secondaryButtonClass} onClick={addCustom}>
                  Add
                </button>
              </div>
            </fieldset>
          </form>

          <div className="mt-5">
            {lookup.running ? (
              <Spinner label="Querying DNS servers…" />
            ) : lookup.error ? (
              <ErrorNote message={lookup.error} />
            ) : result ? (
              <div className="grid gap-3">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#e3e8ef] text-[10px] tracking-[0.6px] text-[#8b95a6] uppercase">
                        <th className="py-2 pr-3 font-semibold">Resolver</th>
                        <th className="py-2 pr-3 font-semibold">Answer</th>
                        <th className="py-2 pr-3 font-semibold">Time</th>
                        <th className="py-2 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.results.map((r) => (
                        <tr key={r.server} className="border-b border-[#f1f4f8] align-top">
                          <td className="py-2.5 pr-3 font-medium text-[#172033]">{label(r.server)}</td>
                          <td className="py-2.5 pr-3 font-mono text-[11px] break-all text-[#344054]">
                            {r.error ?? r.addresses.join(", ")}
                            {r.aliases.length > 0 && <span className="block text-[#8b95a6]">via {r.aliases.join(" → ")}</span>}
                          </td>
                          <td className="py-2.5 pr-3 whitespace-nowrap text-[#5b6577]">{r.elapsedMs !== null ? `${r.elapsedMs} ms` : "—"}</td>
                          <td className="py-2.5">{r.error ? <Badge tone="error">Failed</Badge> : <Badge tone="ok">Answered</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.consistent ? (
                  <p className="m-0 flex items-start gap-2 text-xs text-[#067647]">
                    <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" /> The servers that answered agree on at least one address.
                  </p>
                ) : (
                  <p className="m-0 flex items-start gap-2 text-xs leading-[1.6] text-[#b45309]">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                    The servers returned different addresses. Large sites often answer differently depending on location (CDNs).
                    A mismatch for a small site can mean a misconfigured or hijacked DNS server.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid content-start gap-5">
        <Panel title="Configured DNS servers" description={health?.adapter ? `On ${health.adapter.name}` : undefined}>
          {configured.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {configured.map((s, i) => (
                <li key={s} className="flex items-center justify-between gap-2 font-mono text-xs text-[#172033]">
                  <span className="break-all">{s}</span>
                  <span className="font-sans text-[10px] text-[#8b95a6]">{i === 0 ? "Preferred" : "Alternate"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-xs text-[#8b95a6]">No active adapter with DNS servers.</p>
          )}
          {health?.adapter?.dhcpEnabled && configured.length > 0 && (
            <p className="m-0 mt-3 text-[11px] leading-[1.6] text-[#8b95a6]">These were provided by the router (DHCP).</p>
          )}
        </Panel>

        <Panel title="Flush the DNS cache" description="Windows remembers recent lookups. A stale or wrong entry can keep a site from loading.">
          <ol className="m-0 grid gap-1.5 pl-4 text-xs leading-[1.6] text-[#5b6577]">
            <li>Use it when one site fails but others work, or after changing DNS servers.</li>
            <li>Flushing is safe: it only clears remembered lookups. No administrator rights or restart needed.</li>
            <li>Afterwards, look up the domain again above to confirm it resolves.</li>
          </ol>
          <button type="button" className={`${secondaryButtonClass} mt-3 w-full`} onClick={() => onRepair("flush_dns")}>
            <Eraser size={14} /> Flush DNS cache…
          </button>
        </Panel>
      </div>
    </div>
  );
}
