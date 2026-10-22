import { useEffect, useState } from "react";
import { api, type InstallerDetails, type InstallerType, type SoftwareApp } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { useBackendAction } from "../../lib/useBackendAction";
import { Badge, Dialog, ErrorNote, Facts, Spinner, buttonClass, fieldClass, secondaryButtonClass } from "../network/ui";
import { INSTALLER_TYPES } from "./catalog";

const labelClass = "grid gap-1.5 text-xs font-semibold text-[#344054]";
const hintClass = "font-normal text-[#8b95a6]";

function SignatureBadge({ details }: { details: InstallerDetails }) {
  switch (details.signature) {
    case "valid":
      return <Badge tone="ok">Signed by {details.signer ?? "a trusted publisher"}</Badge>;
    case "not_signed":
      return <Badge tone="warn">Not digitally signed</Badge>;
    case "untrusted":
      return <Badge tone="warn">Signature not trusted by Windows{details.signer ? ` (${details.signer})` : ""}</Badge>;
    case "tampered":
      return <Badge tone="error">Signature broken: file was changed</Badge>;
  }
}

type Form = {
  name: string;
  category: string;
  description: string;
  installerType: InstallerType;
  args: string;
  detect: string;
};

/** Sets an installer up so it can be installed: VocaTechX reads the file,
 *  the technician confirms the details, and the backend writes app.json.
 *  With `app`, it edits that app's saved details instead. */
export function SetupDialog({
  source,
  app,
  categories,
  onClose,
  onSaved,
}: {
  source: string;
  app?: SoftwareApp;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const inspect = useBackendAction(api.swInspect);
  const save = useBackendAction(api.swSaveApp);
  const [form, setForm] = useState<Form | null>(null);
  // The page re-reads the folder every few seconds; keep the app as it was
  // when the dialog opened so the form is not reset mid-edit.
  const [initial] = useState(app);
  const load = inspect.run;

  useEffect(() => {
    load(source).then((details) => {
      if (!details) return;
      setForm(
        initial
          ? {
              name: initial.name,
              category: initial.category,
              description: initial.description,
              installerType: initial.installerType ?? details.detectedType ?? "custom",
              args: initial.args.join(" "),
              detect: initial.detect ?? details.suggestedDetect,
            }
          : {
              name: details.suggestedName,
              category: "Other",
              description: "",
              installerType: details.detectedType ?? "custom",
              args: "",
              detect: details.suggestedDetect,
            },
      );
    });
  }, [load, source, initial]);

  const details = inspect.result;
  const update = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const tampered = details?.signature === "tampered";
  const loose = !source.includes("/");

  const submit = async () => {
    if (!form) return;
    const saved = await save.run({
      source,
      name: form.name,
      category: form.category,
      description: form.description,
      installerType: form.installerType,
      args: form.installerType === "custom" ? form.args.split(/\s+/).filter(Boolean) : [],
      detect: form.detect,
    });
    if (saved !== null) onSaved();
  };

  return (
    <Dialog
      title={initial ? `Edit ${initial.name}` : "Set up installer"}
      onClose={onClose}
      busy={save.running}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={save.running}>
            Cancel
          </button>
          <button type="button" className={buttonClass} onClick={submit} disabled={!form || save.running || tampered}>
            {save.running ? "Saving…" : initial ? "Save changes" : "Save app"}
          </button>
        </>
      }
    >
      {inspect.running && !details && <Spinner label="Reading the installer…" />}
      <ErrorNote message={inspect.error} />
      {details && form && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 rounded-[12px] bg-[#f7f9fc] p-4">
            <Facts
              items={[
                ["File", details.fileName],
                ["Size", formatBytes(details.sizeBytes)],
                ["Version", details.version],
                ["Company", details.company],
              ]}
            />
            <div>
              <SignatureBadge details={details} />
            </div>
          </div>

          {tampered && (
            <ErrorNote message="This installer was modified after its publisher signed it, so VocaTechX will not use it. Download it again from the publisher's website." />
          )}

          <label className={labelClass}>
            Name
            <input className={fieldClass} value={form.name} maxLength={80} onChange={(e) => update({ name: e.target.value })} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Category
              <select className={fieldClass} value={form.category} onChange={(e) => update({ category: e.target.value })}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Installer type
              <select
                className={fieldClass}
                value={form.installerType}
                onChange={(e) => update({ installerType: e.target.value as InstallerType })}
              >
                {INSTALLER_TYPES.filter((t) => (details.fileName.toLowerCase().endsWith(".msi") ? t.id === "msi" : t.id !== "msi")).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {t.id === details.detectedType ? " (detected)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.installerType === "custom" && (
            <label className={labelClass}>
              <span>
                Silent-install switches <span className={hintClass}>(from the publisher's documentation, e.g. /S or --silent)</span>
              </span>
              <input className={fieldClass} value={form.args} onChange={(e) => update({ args: e.target.value })} placeholder="/S" />
              {details.detectedType === null && (
                <span className={hintClass}>VocaTechX could not recognise this installer, so it needs the switches that make it install without asking questions.</span>
              )}
            </label>
          )}

          <label className={labelClass}>
            <span>
              Description <span className={hintClass}>(optional)</span>
            </span>
            <input
              className={fieldClass}
              value={form.description}
              maxLength={240}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="What the app is for"
            />
          </label>

          <label className={labelClass}>
            Name in Windows' installed apps
            <input className={fieldClass} value={form.detect} maxLength={120} onChange={(e) => update({ detect: e.target.value })} />
            <span className={hintClass}>
              How the app appears in Settings › Apps. VocaTechX uses it to check whether the app is installed and that an install
              really worked.
            </span>
          </label>

          {loose && <p className="m-0 text-[11px] text-[#788397]">The installer will be moved into its own folder inside the application folder.</p>}
          <ErrorNote message={save.error} />
        </form>
      )}
    </Dialog>
  );
}
