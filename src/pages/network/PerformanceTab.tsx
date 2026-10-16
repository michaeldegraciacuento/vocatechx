import { Gauge, Info, Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, type PingStats } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { Badge, ErrorNote, Facts, Panel, Spinner, buttonClass, fieldClass, type Tone } from "./ui";
import { formatBps, formatMs } from "../../lib/format";

const TARGETS = [
  { value: "1.1.1.1", label: "Cloudflare (1.1.1.1)" },
  { value: "8.8.8.8", label: "Google (8.8.8.8)" },
  { value: "custom", label: "Another host…" },
];

const QUALITY_TONE: Record<string, Tone> = { Good: "ok", Fair: "warn", Poor: "error", Unreachable: "error" };

/**
 * Round-trip time per request as thin bars on one shared scale. Lost
 * requests are shown as labeled gaps, so loss is never color-only.
 */
function LatencyStrip({ stats, scaleMax }: { stats: PingStats; scaleMax: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const height = 72;
  const n = stats.samples.length;
  const gap = 2;
  const width = 480;
  const barWidth = Math.max(2, (width - gap * (n - 1)) / Math.max(n, 1));
  const y = (ms: number) => Math.max(2, (ms / scaleMax) * (height - 4));
  const hovered = hover !== null ? stats.samples[hover] : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height + 14}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Round-trip times to ${stats.target}: ${stats.received} of ${stats.sent} replies`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={width} y1={height} y2={height} stroke="#e3e8ef" strokeWidth={1} />
        {stats.avgMs !== null && (
          <line
            x1={0}
            x2={width}
            y1={height - y(stats.avgMs)}
            y2={height - y(stats.avgMs)}
            stroke="#a0a9b8"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {stats.samples.map((sample, i) => {
          const x = i * (barWidth + gap);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* Hit target taller than the mark. */}
              <rect x={x} y={0} width={barWidth + gap} height={height} fill="transparent" />
              {sample === null ? (
                <text x={x + barWidth / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#dc2626" fontWeight={700}>
                  ×
                </text>
              ) : (
                <rect
                  x={x}
                  y={height - y(sample)}
                  width={barWidth}
                  height={y(sample)}
                  rx={Math.min(4, barWidth / 2)}
                  fill={hover === i ? "#1d4ed8" : "#3b82f6"}
                />
              )}
            </g>
          );
        })}
        <text x={0} y={height + 12} fontSize={9} fill="#8b95a6">
          Request 1
        </text>
        <text x={width} y={height + 12} fontSize={9} fill="#8b95a6" textAnchor="end">
          {n}
        </text>
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-[8px] bg-[#101827] px-2.5 py-1.5 text-[11px] text-white shadow">
          Request {hover + 1}: {hovered === null || hovered === undefined ? "lost (no reply)" : `${hovered} ms`}
        </div>
      )}
    </div>
  );
}

function StatsPanel({ title, stats, scaleMax }: { title: string; stats: PingStats; scaleMax: number }) {
  return (
    <div className="grid gap-3 rounded-[14px] border border-[#e3e8ef] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold text-[#172033]">{title}</p>
        <span className="font-mono text-[11px] text-[#788397]">{stats.address}</span>
      </div>
      <Facts
        columns={3}
        items={[
          ["Average latency", formatMs(stats.avgMs, 1)],
          ["Packet loss", `${stats.lossPercent.toFixed(0)}% (${stats.sent - stats.received} of ${stats.sent})`],
          ["Jitter", formatMs(stats.jitterMs, 1)],
          ["Min / max", stats.minMs !== null ? `${stats.minMs} / ${stats.maxMs} ms` : null],
        ]}
      />
      <LatencyStrip stats={stats} scaleMax={scaleMax} />
      <p className="m-0 text-[10px] text-[#8b95a6]">
        Bars: round-trip time per request (dashed line = average). × = lost request.
        {stats.lastError ? ` Last error: ${stats.lastError}.` : ""}
      </p>
    </div>
  );
}

export function PerformanceTab() {
  const [target, setTarget] = useState("1.1.1.1");
  const [customHost, setCustomHost] = useState("");
  const [count, setCount] = useState(20);
  const test = useBackendAction(api.netPerformanceTest);
  const result = test.result;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    test.run(target === "custom" ? customHost : target, count);
  };

  const all = result ? [result.internet, ...(result.gateway ? [result.gateway] : [])] : [];
  const scaleMax = Math.max(10, ...all.flatMap((s) => s.samples.filter((v): v is number => v !== null)));

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Panel
        title="Latency, packet loss and jitter"
        description="Pings the router and an internet host side by side, so a local problem (Wi-Fi, cable) can be told apart from an internet provider problem."
        className="lg:col-span-2"
      >
        <form onSubmit={submit} className="mb-5 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
            Internet target
            <select className={`${fieldClass} w-[200px]`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {TARGETS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {target === "custom" && (
            <label className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
              Host name or IPv4
              <input
                className={`${fieldClass} w-[200px]`}
                value={customHost}
                onChange={(e) => setCustomHost(e.target.value)}
                placeholder="www.example.com"
              />
            </label>
          )}
          <label className="grid gap-1 text-[11px] font-semibold text-[#5b6577]">
            Requests
            <select className={`${fieldClass} w-[110px]`} value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} (~{Math.ceil(n / 4)} s)
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass} disabled={test.running || (target === "custom" && !customHost.trim())}>
            <Play size={14} /> {test.running ? "Testing…" : "Start test"}
          </button>
        </form>

        {test.running ? (
          <Spinner label={`Sending ${count} requests to each target…`} />
        ) : test.error ? (
          <ErrorNote message={test.error} />
        ) : result ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[#f7f9fc] px-4 py-3">
              <Badge tone={QUALITY_TONE[result.quality] ?? "neutral"}>{result.quality}</Badge>
              <p className="m-0 flex-1 text-xs leading-[1.6] text-[#344054]">{result.assessment}</p>
            </div>
            {result.gateway && <StatsPanel title="Router (default gateway)" stats={result.gateway} scaleMax={scaleMax} />}
            <StatsPanel title={`Internet: ${result.internet.target}`} stats={result.internet} scaleMax={scaleMax} />
          </div>
        ) : (
          <p className="m-0 flex items-center gap-2 text-xs text-[#8b95a6]">
            <Gauge size={15} /> Start a test to measure the connection. Results are saved to History.
          </p>
        )}
      </Panel>

      <div className="grid content-start gap-5">
        <Panel title="Link speed vs. internet speed">
          <Facts
            columns={1}
            items={[
              ["Adapter link speed", result ? (formatBps(result.linkSpeedBps) ?? "Not reported") : "Run a test to read it"],
              ["Measured internet throughput", "Not measured"],
            ]}
          />
          <p className="m-0 mt-3 flex gap-2 text-[11px] leading-[1.6] text-[#788397]">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            Link speed is the rate the adapter negotiated with the router or access point. It is not your internet
            speed. Measuring download speed requires a speed-test server on the internet, which VocaTechX does not
            contact, so it works fully offline.
          </p>
        </Panel>
        <Panel title="Reading the results">
          <ul className="m-0 grid gap-1.5 pl-4 text-xs leading-[1.6] text-[#5b6577]">
            <li>Latency under 50 ms is good for most uses; over 150 ms feels slow.</li>
            <li>Any packet loss above 1% causes stutter in calls and games.</li>
            <li>Jitter is how much latency varies; above 30 ms hurts voice and video.</li>
            <li>Loss to the router points at Wi-Fi signal or cabling; loss only to the internet points at the provider.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
