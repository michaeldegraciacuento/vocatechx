import { FolderOpen, FolderPlus, FolderSearch, HardDrive, Monitor, Radar, RefreshCw, ShieldCheck, Stethoscope } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  api,
  type DiscoveredComputer,
  type RepairAction,
  type SettingsPage,
  type Share,
  type SharingOverview,
} from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { useBackendData } from "../../lib/useBackendData";
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorNote,
  NetErrorNote,
  Panel,
  Spinner,
  StepList,
  buttonClass,
  dangerButtonClass,
  fieldClass,
  secondaryButtonClass,
  type Tone,
} from "./ui";

type SharingTabProps = {
  onRepair: (action: RepairAction) => void;
  onOpenSettings: (page: SettingsPage) => void;
};

const SERVICE_PURPOSE: Record<string, string> = {
  LanmanWorkstation: "Opens shared folders on other computers",
  LanmanServer: "Shares this computer's folders",
  FDResPub: "Makes this computer visible on the network",
  fdPHost: "Finds other computers on the network",
  SSDPSRV: "Discovers network devices",
};

function statusRow(label: string, ok: boolean | null, okText: string, badText: string, detail?: string) {
  const tone: Tone = ok === null ? "neutral" : ok ? "ok" : "error";
  return { label, tone, value: ok === null ? "Unknown" : ok ? okText : badText, detail };
}

function SharingStatus({
  overview,
  onRepair,
  onOpenSettings,
}: {
  overview: SharingOverview;
  onRepair: (action: RepairAction) => void;
  onOpenSettings: (page: SettingsPage) => void;
}) {
  const d = overview.discovery;
  const service = (name: string) => d?.services.find((s) => s.name === name);
  const running = (name: string) => (service(name) ? service(name)!.status === "Running" : null);
  const ruleOn = (r: { total: number; enabled: number } | undefined) => (!r || r.total === 0 ? null : r.enabled > 0);
  const publicProfile = d?.profiles.some((p) => p.category === "Public") ?? false;
  const servicesStopped = running("LanmanWorkstation") === false || running("LanmanServer") === false;

  const rows = [
    statusRow(
      "Network profile",
      d ? (d.profiles.length ? !publicProfile : null) : null,
      d?.profiles.map((p) => p.category).join(", ") || "Private",
      "Public",
      publicProfile
        ? "Windows hides this computer and blocks sharing on Public networks. Set trusted home/lab networks to Private."
        : d?.profiles.map((p) => `${p.name} (${p.interfaceAlias})`).join(", "),
    ),
    statusRow("Network discovery", ruleOn(d?.networkDiscovery), "On", "Off", "Lets this computer see and be seen by others."),
    statusRow("File and printer sharing", ruleOn(d?.fileSharing), "On", "Off", "Firewall rules that allow SMB connections in."),
    statusRow("Accepting connections (SMB 445)", overview.smbServerListening, "Yes", "No", "Other computers can connect to this one."),
    ...["LanmanWorkstation", "LanmanServer", "FDResPub", "fdPHost"].map((name) =>
      statusRow(
        service(name)?.displayName ?? name,
        running(name),
        "Running",
        "Stopped",
        `${SERVICE_PURPOSE[name]}${service(name) ? ` · ${service(name)!.startType}` : ""}`,
      ),
    ),
  ];

  return (
    <Panel
      title="Sharing status"
      description={`This computer: \\\\${overview.computerName ?? "THIS-PC"}`}
      actions={
        <button type="button" className={secondaryButtonClass} onClick={() => onOpenSettings("advanced_sharing")}>
          <ShieldCheck size={14} /> Advanced sharing settings
        </button>
      }
    >
      {overview.discoveryError && <ErrorNote message={overview.discoveryError} />}
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.label} className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#172033]">{row.label}</span>
              <Badge tone={row.tone}>{row.value}</Badge>
            </div>
            {row.detail && <p className="m-0 mt-0.5 text-[11px] leading-[1.5] text-[#788397]">{row.detail}</p>}
          </li>
        ))}
      </ul>
      {servicesStopped && (
        <button type="button" className={`${buttonClass} mt-4`} onClick={() => onRepair("start_sharing_services")}>
          Start file sharing services…
        </button>
      )}
    </Panel>
  );
}

function ShareRows({ shares, onOpen }: { shares: Share[]; onOpen?: (unc: string) => void }) {
  const [showAdmin, setShowAdmin] = useState(false);
  const visible = shares.filter((s) => showAdmin || !s.special);
  const hidden = shares.length - visible.length;
  return (
    <div className="grid gap-2">
      {visible.length === 0 ? (
        <p className="m-0 text-xs text-[#8b95a6]">No shared folders.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {visible.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#eef1f5] px-3 py-2">
              <HardDrive size={15} className="text-[#5b6577]" />
              <div className="min-w-0 flex-1">
                <p className="m-0 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#172033]">
                  {s.name}
                  {s.special && <Badge tone="neutral">admin share</Badge>}
                  {s.kind !== "folder" && <Badge tone="neutral">{s.kind}</Badge>}
                </p>
                <p className="m-0 truncate font-mono text-[11px] text-[#788397]">
                  {s.unc}
                  {s.path ? ` → ${s.path}` : ""}
                  {s.remark ? ` · ${s.remark}` : ""}
                </p>
              </div>
              {onOpen && s.kind === "folder" && (
                <button type="button" className={secondaryButtonClass} onClick={() => onOpen(s.unc)}>
                  <FolderOpen size={13} /> Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <button type="button" className="w-fit cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#2563eb]" onClick={() => setShowAdmin(true)}>
          Show {hidden} administrative share{hidden === 1 ? "" : "s"} (C$, ADMIN$, IPC$)
        </button>
      )}
    </div>
  );
}

function OpenFolder({ initial }: { initial: string }) {
  const [path, setPath] = useState(initial);
  const access = useBackendAction(api.netTestShareAccess);
  const opener = useBackendAction(api.netOpenShare);

  const test = (e: FormEvent) => {
    e.preventDefault();
    access.run(path);
  };

  return (
    <Panel
      title="Open a shared folder"
      description={
        <>
          Type a network path such as <span className="font-mono">\\COMPUTER-NAME\ShareName</span>. File Explorer asks for a
          user name and password if the other computer requires one.
        </>
      }
    >
      <form onSubmit={test} className="flex flex-wrap gap-2">
        <input
          className={`${fieldClass} min-w-[240px] flex-1 font-mono`}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="\\LAB-PC-01\Projects"
          aria-label="Network path"
        />
        <button type="submit" className={secondaryButtonClass} disabled={!path.trim() || access.running}>
          <Stethoscope size={14} /> {access.running ? "Testing…" : "Test access"}
        </button>
        <button type="button" className={buttonClass} disabled={!path.trim()} onClick={() => opener.run(path)}>
          <FolderOpen size={14} /> Open in File Explorer
        </button>
      </form>
      <div className="mt-3 grid gap-2">
        <ErrorNote message={opener.error ?? access.error} />
        {access.result &&
          (access.result.ok ? (
            <p className="m-0 rounded-[10px] bg-[#ecfdf3] px-4 py-3 text-xs text-[#065f46]">
              Access works: {access.result.path} contains {access.result.entries} item{access.result.entries === 1 ? "" : "s"}.
            </p>
          ) : (
            access.result.error && <NetErrorNote error={access.result.error} />
          ))}
      </div>
    </Panel>
  );
}

function computerLabel(c: DiscoveredComputer) {
  return c.name ?? c.address ?? "Unknown";
}

function FindShares({ onOpenPath }: { onOpenPath: (unc: string) => void }) {
  const discovery = useBackendAction(api.netDiscoverComputers);
  const listing = useBackendAction(api.netListShares);
  const check = useBackendAction(api.netCheckSmb);
  const [host, setHost] = useState("");

  const listFor = (target: string) => {
    check.reset();
    setHost(target);
    listing.run(target);
  };
  const checkFor = (target: string) => {
    listing.reset();
    setHost(target);
    check.run(target);
  };

  const busy = listing.running || check.running;

  return (
    <Panel
      title="Find shared folders on the network"
      description="Scans devices this computer has recently seen on the local network and checks which accept file sharing (SMB). You can also type a computer name or IP."
      actions={
        <button type="button" className={secondaryButtonClass} onClick={() => discovery.run()} disabled={discovery.running}>
          <Radar size={14} className={discovery.running ? "animate-pulse" : ""} /> {discovery.running ? "Scanning…" : "Scan network"}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          listFor(host);
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <input
          className={`${fieldClass} min-w-[200px] flex-1`}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Computer name or IP, e.g. LAB-PC-01 or 192.168.1.20"
          aria-label="Computer"
        />
        <button type="submit" className={secondaryButtonClass} disabled={!host.trim() || busy}>
          <FolderSearch size={14} /> List shares
        </button>
        <button type="button" className={secondaryButtonClass} disabled={!host.trim() || busy} onClick={() => checkFor(host)}>
          <Stethoscope size={14} /> Diagnose connection
        </button>
      </form>

      {discovery.running && <Spinner label="Scanning the local network…" />}
      <ErrorNote message={discovery.error} />
      {discovery.result && !discovery.running && (
        <div className="mb-4">
          {discovery.result.computers.length === 0 ? (
            <EmptyState icon={Monitor} title="No devices found">
              This computer has not seen other devices on the local network recently. Type the other computer's name or IP
              address above instead.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {discovery.result.computers.map((c) => (
                <li key={`${c.name}-${c.address}`} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#eef1f5] px-3 py-2">
                  <Monitor size={15} className="text-[#5b6577]" />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-xs font-semibold text-[#172033]">{computerLabel(c)}</p>
                    <p className="m-0 font-mono text-[11px] text-[#788397]">
                      {[c.name ? c.address : null, c.mac].filter(Boolean).join(" · ") || "Listed by Windows"}
                    </p>
                  </div>
                  {c.smbOpen ? <Badge tone="ok">File sharing on</Badge> : <Badge tone="neutral">No file sharing</Badge>}
                  <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => listFor(c.name ?? c.address ?? "")}>
                    Shares
                  </button>
                  <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => checkFor(c.name ?? c.address ?? "")}>
                    Diagnose
                  </button>
                </li>
              ))}
            </ul>
          )}
          {discovery.result.browseError && (
            <p className="m-0 mt-2 text-[11px] text-[#8b95a6]">
              Windows' named computer list: {discovery.result.browseError.explanation}
            </p>
          )}
        </div>
      )}

      {listing.running && <Spinner label={`Listing shares on ${host}…`} />}
      <ErrorNote message={listing.error ?? check.error} />
      {listing.result && !listing.running && (
        <div className="grid gap-2">
          <p className="m-0 text-xs font-semibold text-[#344054]">Shares on \\{listing.result.host}</p>
          {listing.result.error ? <NetErrorNote error={listing.result.error} /> : <ShareRows shares={listing.result.shares} onOpen={onOpenPath} />}
        </div>
      )}

      {check.running && <Spinner label={`Checking file sharing with ${host}…`} />}
      {check.result && !check.running && (
        <div className="grid gap-3">
          <p className={`m-0 text-[13px] font-semibold ${check.result.healthy ? "text-[#067647]" : "text-[#b91c1c]"}`}>{check.result.summary}</p>
          <StepList steps={check.result.steps} />
          {check.result.shares.length > 0 && <ShareRows shares={check.result.shares} onOpen={onOpenPath} />}
        </div>
      )}
    </Panel>
  );
}

function CreateShareDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const picker = useBackendAction(api.netPickFolder);
  const create = useBackendAction(api.netCreateShare);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"read" | "change">("read");

  const pick = async () => {
    const path = await picker.run();
    if (path) {
      setFolder(path);
      if (!name) setName(path.split(/[\\/]/).filter(Boolean).pop()?.replace(/[^\w .-]/g, "") ?? "");
    }
  };

  const submit = async () => {
    const result = await create.run(name, folder, access);
    if (result) onDone();
  };

  if (create.result) {
    const ok = create.result.status === "success";
    return (
      <Dialog title="Share a folder" onClose={onClose} footer={<button type="button" className={buttonClass} onClick={onClose}>Close</button>}>
        <p className={`m-0 text-sm font-semibold ${ok ? "text-[#16a34a]" : "text-[#b91c1c]"}`}>
          {ok ? "Folder shared" : create.result.status === "cancelled" ? "Cancelled" : "Could not share the folder"}
        </p>
        <p className="m-0">{create.result.message}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Share a folder"
      onClose={onClose}
      busy={create.running}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={create.running}>
            Cancel
          </button>
          <button type="button" className={buttonClass} onClick={submit} disabled={create.running || !folder || !name.trim()}>
            {create.running ? "Working…" : "Share as administrator"}
          </button>
        </>
      }
    >
      <div className="flex gap-2">
        <input className={fieldClass} value={folder} readOnly placeholder="No folder chosen" aria-label="Folder" />
        <button type="button" className={secondaryButtonClass} onClick={pick} disabled={picker.running}>
          Choose…
        </button>
      </div>
      <label className="grid gap-1 font-semibold text-[#344054]">
        Share name
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Projects" />
        <span className="font-normal text-[#8b95a6]">
          Others will open it as <span className="font-mono">\\THIS-PC\{name || "ShareName"}</span>
        </span>
      </label>
      <fieldset className="m-0 grid gap-1.5 border-none p-0">
        <legend className="mb-1 font-semibold text-[#344054]">Access for network users</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={access === "read"} onChange={() => setAccess("read")} /> Read only (recommended)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={access === "change"} onChange={() => setAccess("change")} /> Read and write
        </label>
      </fieldset>
      <p className="m-0 rounded-[10px] bg-[#eef4ff] px-3 py-2.5 text-[#1e40af]">
        Windows will ask for administrator permission. Network users sign in with an account on this computer, and the
        folder's own Security (NTFS) permissions must also allow them.
      </p>
      <ErrorNote message={picker.error ?? create.error} />
    </Dialog>
  );
}

function LocalShares({ overview, onChanged }: { overview: SharingOverview; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useBackendAction(api.netRemoveShare);

  const confirmRemove = async () => {
    if (!removing) return;
    if (await remove.run(removing)) onChanged();
  };

  return (
    <Panel
      title="Folders this computer shares"
      actions={
        <button type="button" className={buttonClass} onClick={() => setCreating(true)}>
          <FolderPlus size={14} /> Share a folder…
        </button>
      }
    >
      {overview.localShares.error ? (
        <NetErrorNote error={overview.localShares.error} />
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {overview.localShares.items.filter((s) => !s.special).length === 0 && <p className="m-0 text-xs text-[#8b95a6]">No folders are shared.</p>}
          {overview.localShares.items
            .filter((s) => !s.special)
            .map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#eef1f5] px-3 py-2">
                <HardDrive size={15} className="text-[#5b6577]" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs font-semibold text-[#172033]">{s.name}</p>
                  <p className="m-0 truncate font-mono text-[11px] text-[#788397]">
                    {s.unc}
                    {s.path ? ` → ${s.path}` : ""}
                    {s.currentUses ? ` · ${s.currentUses} connected` : ""}
                  </p>
                </div>
                <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(s.name)}>
                  Stop sharing
                </button>
              </li>
            ))}
        </ul>
      )}

      {creating && (
        <CreateShareDialog
          onClose={() => setCreating(false)}
          onDone={onChanged}
        />
      )}
      {removing && (
        <Dialog
          title={`Stop sharing "${removing}"?`}
          onClose={() => {
            setRemoving(null);
            remove.reset();
          }}
          busy={remove.running}
          footer={
            remove.result ? (
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setRemoving(null);
                  remove.reset();
                }}
              >
                Close
              </button>
            ) : (
              <>
                <button type="button" className={secondaryButtonClass} onClick={() => setRemoving(null)} disabled={remove.running}>
                  Cancel
                </button>
                <button type="button" className={dangerButtonClass} onClick={confirmRemove} disabled={remove.running}>
                  {remove.running ? "Working…" : "Stop sharing"}
                </button>
              </>
            )
          }
        >
          {remove.result ? (
            <p className="m-0">{remove.result.message}</p>
          ) : (
            <>
              <p className="m-0">
                Other computers will no longer be able to open this folder over the network. The folder and its files are not
                changed. Anyone currently connected is disconnected.
              </p>
              <p className="m-0">Windows will ask for administrator permission.</p>
              <ErrorNote message={remove.error} />
            </>
          )}
        </Dialog>
      )}
    </Panel>
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function Sessions({ overview }: { overview: SharingOverview }) {
  return (
    <Panel title="Connections" description="Who is using this computer's shares, and which shares this computer is connected to.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="m-0 mb-2 text-[11px] font-semibold tracking-[0.6px] text-[#8b95a6] uppercase">Connected to this computer</p>
          {overview.sessions.error ? (
            <NetErrorNote error={overview.sessions.error} />
          ) : overview.sessions.items.length === 0 ? (
            <p className="m-0 text-xs text-[#8b95a6]">No one is connected.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-xs">
              {overview.sessions.items.map((s, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-[#172033]">
                    {s.user || "Guest"} <span className="font-mono text-[#788397]">from {s.client}</span>
                  </span>
                  <span className="text-[#8b95a6]">{formatDuration(s.activeSeconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="m-0 mb-2 text-[11px] font-semibold tracking-[0.6px] text-[#8b95a6] uppercase">From this computer</p>
          {overview.connections.error ? (
            <NetErrorNote error={overview.connections.error} />
          ) : overview.connections.items.length === 0 ? (
            <p className="m-0 text-xs text-[#8b95a6]">Not connected to any shared folders.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-xs">
              {overview.connections.items.map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate font-mono text-[#172033]">
                    {c.local ? `${c.local} ` : ""}
                    {c.remote}
                  </span>
                  <Badge tone={c.status === "Connected" ? "ok" : "warn"}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function SharingTab({ onRepair, onOpenSettings }: SharingTabProps) {
  const overview = useBackendData(api.netSharingOverview);
  const [openPath, setOpenPath] = useState("");
  const [openKey, setOpenKey] = useState(0);
  const opener = useBackendAction(api.netOpenShare);

  return (
    <div className="grid gap-5">
      <div className="flex justify-end">
        <button type="button" className={secondaryButtonClass} onClick={overview.reload} disabled={overview.loading}>
          <RefreshCw size={14} className={overview.loading ? "animate-spin" : ""} /> Refresh sharing status
        </button>
      </div>
      {overview.loading && !overview.data ? (
        <Spinner label="Reading sharing settings…" />
      ) : overview.error ? (
        <ErrorNote message={overview.error} />
      ) : (
        overview.data && <SharingStatus overview={overview.data} onRepair={onRepair} onOpenSettings={onOpenSettings} />
      )}

      <ErrorNote message={opener.error} />
      <OpenFolder key={openKey} initial={openPath} />
      <FindShares
        onOpenPath={(unc) => {
          // Prefill "Open a shared folder" so access problems can be tested there too.
          setOpenPath(unc);
          setOpenKey((k) => k + 1);
          opener.run(unc);
        }}
      />
      {overview.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <LocalShares overview={overview.data} onChanged={overview.reload} />
          <Sessions overview={overview.data} />
        </div>
      )}
    </div>
  );
}
