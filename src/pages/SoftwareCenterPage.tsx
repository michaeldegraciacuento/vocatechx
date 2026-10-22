import { FolderOpen, PackageOpen, PackagePlus, RefreshCw, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ActivityList } from "../components/ActivityList";
import { api, type SoftwareApp, type SoftwareStatus } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useBackendAction } from "../lib/useBackendAction";
import { useBackendData } from "../lib/useBackendData";
import { Dialog, EmptyState, ErrorNote, Panel, Spinner, buttonClass, dangerButtonClass, fieldClass, secondaryButtonClass } from "./network/ui";
import { AppTile } from "./software/AppTile";
import { InstallModal } from "./software/InstallModal";
import { SetupDialog } from "./software/SetupDialog";
import { isInstalled, needsInstall } from "./software/catalog";

/** The folder is re-read this often, so installers pasted into it show up on their own. */
const LIBRARY_POLL_MS = 4000;
const fetchHistory = () => api.swHistory(8);

function SoftwareCenterPage() {
  const library = useBackendData(api.swLibrary, LIBRARY_POLL_MS);
  const status = useBackendData(api.swStatus);
  const history = useBackendData(fetchHistory);
  const openFolder = useBackendAction(api.swOpenFolder);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Setting up a new installer has only a source; editing also has the app.
  const [setup, setSetup] = useState<{ source: string; app?: SoftwareApp } | null>(null);
  const [batch, setBatch] = useState<{ mode: "install" | "uninstall"; apps: SoftwareApp[] } | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<SoftwareApp[] | null>(null);

  const lib = library.data;
  const apps = useMemo(() => lib?.apps ?? [], [lib]);
  const statusById = useMemo(() => new Map<string, SoftwareStatus>((status.data ?? []).map((s) => [s.id, s])), [status.data]);
  const ready = useMemo(() => apps.filter((a) => !a.problem), [apps]);
  const categories = useMemo(() => [...new Set(apps.map((a) => a.category))].sort(), [apps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter(
      (a) =>
        (!category || a.category === category) &&
        (!q || [a.name, a.description, a.publisher ?? "", a.category].some((v) => v.toLowerCase().includes(q))),
    );
  }, [apps, category, query]);

  // Only apps that are still present and installable count as selected.
  const chosen = ready.filter((a) => selected.has(a.id));
  const chosenInstalled = chosen.filter((a) => isInstalled(statusById.get(a.id)?.state));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () =>
    setSelected(new Set(visible.filter((a) => !a.problem && needsInstall(statusById.get(a.id)?.state)).map((a) => a.id)));

  const refresh = () => {
    library.reload();
    status.reload();
  };

  const finishBatch = () => {
    setBatch(null);
    setSelected(new Set());
    refresh();
    history.reload();
  };

  if (!lib) {
    return library.error ? <ErrorNote message={library.error} /> : <Spinner label="Reading the application folder…" />;
  }

  return (
    <div className="grid gap-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="max-w-full truncate rounded-full border border-[#e3e8ef] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#5b6577]"
            title={lib.folder}
          >
            {lib.folder}
          </span>
          {lib.elevated ? (
            <span className="flex items-center gap-1.5 rounded-full border border-[#d1fadf] bg-[#ecfdf3] px-2.5 py-1 text-[11px] font-semibold text-[#067647]">
              <ShieldCheck size={12} /> Running as administrator
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-[#fde68a] bg-[#fffbeb] px-2.5 py-1 text-[11px] font-semibold text-[#b45309]">
              <ShieldAlert size={12} /> Not running as administrator
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={() => openFolder.run()} disabled={openFolder.running}>
            <FolderOpen size={14} /> Open folder
          </button>
          <button type="button" className={secondaryButtonClass} onClick={refresh} disabled={status.loading}>
            <RefreshCw size={14} className={status.loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>
      <ErrorNote message={openFolder.error} />

      {/* VocaTechX's manifest always requests administrator rights, so this only
          shows if it was started some other way (e.g. a dev build from a normal terminal). */}
      {!lib.elevated && (
        <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] px-5 py-4">
          <p className="m-0 text-[13px] font-semibold text-[#92400e]">Installing apps needs administrator rights</p>
          <p className="m-0 mt-1 text-xs leading-[1.6] text-[#a16207]">
            Close VocaTechX and start it again, accepting the administrator prompt. You can still browse and set up apps now.
          </p>
        </div>
      )}

      {lib.pending.length > 0 && (
        <Panel
          title={`New installers found (${lib.pending.length})`}
          description="Set each one up once: VocaTechX reads the installer and records its checksum, so only this exact file is ever run."
        >
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {lib.pending.map((p) => (
              <li key={p.source} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#eef1f5] px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[10px] bg-[#eef4ff] text-[#2563eb]">
                    <PackagePlus size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[13px] font-semibold text-[#172033]">{p.fileName}</p>
                    <p className="m-0 text-[11px] text-[#788397]">
                      {formatBytes(p.sizeBytes)}
                      {p.folder ? ` · in ${p.folder}` : ""}
                    </p>
                  </div>
                </div>
                <button type="button" className={buttonClass} onClick={() => setSetup({ source: p.source })} disabled={lib.installing}>
                  Set up
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Apps"
        description="Select the apps to install. They install silently, one after another."
        actions={
          apps.length > 0 && (
            <>
              <button type="button" className={secondaryButtonClass} onClick={selectAll}>
                Select all
              </button>
              <button type="button" className={secondaryButtonClass} onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear
              </button>
            </>
          )
        }
      >
        {apps.length === 0 ? (
          <EmptyState icon={PackageOpen} title="No apps yet">
            Copy installers (.exe or .msi) into the application folder. They appear here within a few seconds, ready to set up.
          </EmptyState>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#a0a9b8]" />
                <input
                  className={`${fieldClass} pl-8`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search apps"
                  aria-label="Search apps"
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
                {[null, ...categories].map((c) => (
                  <button
                    key={c ?? "all"}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      category === c ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#e3e8ef] bg-white text-[#5b6577] hover:bg-[#f7f9fc]"
                    }`}
                  >
                    {c ?? "All"}
                  </button>
                ))}
              </div>
            </div>
            <ErrorNote message={status.error} />
            {visible.length === 0 ? (
              <EmptyState icon={Search} title="No matching apps" />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((app) => (
                  <AppTile
                    key={app.id}
                    app={app}
                    status={statusById.get(app.id)}
                    selected={selected.has(app.id)}
                    disabled={lib.installing}
                    onToggle={() => toggle(app.id)}
                    onSetUp={() => app.source && setSetup({ source: app.source, app })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Recent activity" description="Installs and uninstalls. Full details are in Activity Logs.">
        <ActivityList items={history.data} loading={history.loading} error={history.error} />
      </Panel>

      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dbe5f5] bg-white/95 px-5 py-3.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)] backdrop-blur">
          <p className="m-0 text-[13px] font-semibold text-[#172033]">
            {chosen.length} {chosen.length === 1 ? "app" : "apps"} selected
            <span className="ml-2 font-normal text-[#788397]">{formatBytes(chosen.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0))}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button
              type="button"
              className={`${secondaryButtonClass} text-[#b91c1c]`}
              onClick={() => setConfirmUninstall(chosenInstalled)}
              disabled={lib.installing || !lib.elevated || chosenInstalled.length === 0}
              title={chosenInstalled.length === 0 ? "None of the selected apps are installed" : undefined}
            >
              <Trash2 size={14} /> Uninstall ({chosenInstalled.length})
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setBatch({ mode: "install", apps: chosen })}
              disabled={lib.installing || !lib.elevated}
            >
              Install ({chosen.length})
            </button>
          </div>
        </div>
      )}

      {setup && (
        <SetupDialog
          source={setup.source}
          app={setup.app}
          categories={lib.categories}
          onClose={() => setSetup(null)}
          onSaved={() => {
            setSetup(null);
            refresh();
          }}
        />
      )}
      {confirmUninstall && (
        <Dialog
          title={`Uninstall ${confirmUninstall.length === 1 ? confirmUninstall[0].name : `${confirmUninstall.length} apps`}?`}
          onClose={() => setConfirmUninstall(null)}
          footer={
            <>
              <button type="button" className={secondaryButtonClass} onClick={() => setConfirmUninstall(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={dangerButtonClass}
                onClick={() => {
                  setBatch({ mode: "uninstall", apps: confirmUninstall });
                  setConfirmUninstall(null);
                }}
              >
                Uninstall
              </button>
            </>
          }
        >
          <p className="m-0">These apps will be removed from this computer, silently and one at a time:</p>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-[#172033]">
            {confirmUninstall.map((a) => (
              <li key={a.id}>
                {a.name}
                {statusById.get(a.id)?.installedVersion ? ` ${statusById.get(a.id)?.installedVersion}` : ""}
              </li>
            ))}
          </ul>
          <p className="m-0">Their installers stay in the application folder, so you can install them again later.</p>
        </Dialog>
      )}
      {batch && <InstallModal apps={batch.apps} mode={batch.mode} onClose={finishBatch} />}
    </div>
  );
}

export default SoftwareCenterPage;
