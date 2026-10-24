import { Box as BoxIcon, Eye, EyeOff, Layers, Maximize2, MonitorOff, X } from "lucide-react";
import { Component, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { LearningData } from "../learning/useLearning";
import { LessonPanel } from "./LessonPanel";
import { PartsPanel } from "./PartsPanel";
import { LabCanvas } from "./scene/LabCanvas";
import type { Highlight } from "./scene/motion";
import { actionLabel, actionsFor, type Action } from "./sim/engine";
import type { CameraView, LabLesson } from "./sim/lessons";
import { PARTS, type PartId } from "./sim/parts";
import { attempt, isComplete, startRun, withHint, type Feedback, type Run } from "./sim/runner";
import { partStatus } from "./sim/status";

const VIEWS: { id: CameraView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "cpu", label: "CPU" },
  { id: "ram", label: "RAM" },
  { id: "gpu", label: "GPU" },
  { id: "m2", label: "M.2" },
  { id: "bench", label: "Mat" },
];

const KIND_LABEL = { safety: "Safety", order: "Not yet", forcing: "Would damage hardware", invalid: "Not possible" } as const;

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Falls back to the no-3D mode if the 3D view throws while rendering. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const toolClass = (active = false) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition-colors ${
    active ? "border-[#60a5fa] bg-[#1d4ed8]/80 text-white" : "border-white/15 bg-[#0f172a]/70 text-[#dbe4f0] hover:bg-[#1e293b]/80"
  }`;

/** The selected part: what it is, its state, and what you can do with it. */
function PartCard({ id, run, onAction, onClose }: { id: PartId; run: Run; onAction: (a: Action) => void; onClose: () => void }) {
  const part = PARTS[id];
  const actions = actionsFor(id, run.sim);
  const status = partStatus(id, run.sim);
  return (
    <div className="pointer-events-auto w-[340px] max-w-full rounded-2xl border border-white/10 bg-[#0f172a]/90 p-4 text-[#dbe4f0] shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold tracking-[0.8px] text-[#7db5ff] uppercase">{part.group}</p>
          <p className="m-0 mt-0.5 text-sm font-bold text-white">{part.name}</p>
          {status && <p className="m-0 mt-0.5 text-[11px] text-[#9fb0c8]">{status}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-none bg-white/5 text-[#9fb0c8] hover:bg-white/10">
          <X size={14} />
        </button>
      </div>
      <p className="m-0 mt-2 text-xs leading-[1.55] text-[#c7d2e1]">{part.role}</p>
      <ul className="m-0 mt-2 grid list-disc gap-0.5 pl-4 text-[11px] leading-[1.5] text-[#9fb0c8]">
        {part.specs.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {part.caution && <p className="m-0 mt-2 rounded-[8px] bg-[#78350f]/40 px-2.5 py-1.5 text-[11px] leading-[1.5] text-[#fde68a]">{part.caution}</p>}
      {actions.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {actions.map((a, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction(a)}
              className="cursor-pointer rounded-[9px] border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-semibold text-white transition-colors hover:border-[#60a5fa] hover:bg-[#1d4ed8]/40"
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackBanner({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  const tone =
    feedback.tone === "success"
      ? "border-[#22c55e]/40 bg-[#052e16]/90 text-[#bbf7d0]"
      : feedback.tone === "error"
        ? "border-[#f87171]/40 bg-[#450a0a]/90 text-[#fecaca]"
        : "border-[#60a5fa]/40 bg-[#0c1a3a]/90 text-[#bfdbfe]";
  return (
    <div role={feedback.tone === "error" ? "alert" : "status"} className={`pointer-events-auto flex max-w-[640px] items-start gap-3 rounded-2xl border px-4 py-3 text-xs leading-[1.55] shadow-lg backdrop-blur ${tone}`}>
      <p className="m-0 flex-1">
        {feedback.kind && <span className="font-bold">{KIND_LABEL[feedback.kind]}: </span>}
        {feedback.message}
      </p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="cursor-pointer border-none bg-transparent p-0 text-current opacity-70 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}

/** The 3D Hardware Lab: a simulated PC to take apart, freely or in guided lessons. */
export default function HardwareLabPage({ data, onOpenLibraryLesson }: { data: LearningData; onOpenLibraryLesson?: (id: string) => void }) {
  const [run, setRun] = useState<Run>(() => startRun(null));
  const [selected, setSelected] = useState<PartId | null>(null);
  const [hovered, setHovered] = useState<PartId | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [exploded, setExploded] = useState(false);
  const [hidePanels, setHidePanels] = useState(false);
  const [view, setView] = useState<CameraView>("overview");
  const [viewRequest, setViewRequest] = useState(0);
  const [tab, setTab] = useState<"lesson" | "parts">("lesson");
  const [webgl] = useState(webglAvailable);
  const [use3d, setUse3d] = useState(webgl);
  const [elapsedMin, setElapsedMin] = useState<number | null>(null);
  const recorded = useRef<number | null>(null);
  const { recordLab } = data;

  const goTo = useCallback((next: CameraView) => {
    setView(next);
    setViewRequest((n) => n + 1);
  }, []);

  const start = (lesson: LabLesson | null) => {
    setRun(startRun(lesson));
    setSelected(null);
    setFeedback(null);
    setExploded(false);
    setElapsedMin(null);
    goTo(lesson?.steps[0]?.camera ?? "overview");
  };

  const act = (action: Action) => {
    const result = attempt(run, action);
    if (result.feedback) setFeedback(result.feedback);
    setRun(result.run);
    const lesson = result.run.lesson;
    if (!lesson || result.run.step === run.step) return;
    // Follow the lesson: move the camera to where the next step happens.
    const nextCamera = lesson.steps[result.run.step]?.camera;
    if (nextCamera) goTo(nextCamera);
    // Save a finished lesson once.
    if (isComplete(result.run) && recorded.current !== result.run.startedAt) {
      recorded.current = result.run.startedAt;
      const seconds = Math.round((Date.now() - result.run.startedAt) / 1000);
      setElapsedMin(Math.max(1, Math.round(seconds / 60)));
      recordLab(lesson.id, result.run.mistakes, result.run.hints, seconds);
    }
  };

  const select = (id: PartId) => {
    setSelected(id);
    act({ type: "identify", part: id });
  };

  const complete = isComplete(run);

  const targets = useMemo(() => (run.lesson && !complete ? (run.lesson.steps[run.step]?.highlight ?? []) : []), [run, complete]);
  const hl = useCallback(
    (id: PartId): Highlight => (selected === id ? "selected" : hovered === id ? "hover" : targets.includes(id) ? "target" : "none"),
    [selected, hovered, targets],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="relative h-[calc(100vh-250px)] min-h-[540px] overflow-hidden rounded-2xl border border-[#1e293b] bg-[#0c111c]">
        {use3d ? (
          <SceneBoundary
            onError={() => {
              setUse3d(false);
              setFeedback({ tone: "info", message: "The 3D view stopped working on this computer, so the lab switched to no-3D mode." });
            }}
          >
            <LabCanvas
              state={run.sim}
              view={view}
              viewRequest={viewRequest}
              exploded={exploded}
              hidePanels={hidePanels}
              hl={hl}
              onSelect={select}
              onHover={setHovered}
              onMiss={() => setSelected(null)}
              onLost={() => {
                setUse3d(false);
                setFeedback({ tone: "info", message: "The graphics driver reset, so the lab switched to no-3D mode. You can turn 3D back on." });
              }}
            />
          </SceneBoundary>
        ) : (
          <div className="h-full overflow-y-auto bg-[#f7f9fc] px-4 pt-14 pb-[300px]">
            <p className="m-0 mb-4 flex items-start gap-2 rounded-[12px] bg-white px-3.5 py-3 text-xs leading-[1.6] text-[#344054]">
              <MonitorOff size={16} className="mt-0.5 flex-shrink-0 text-[#5b6577]" />
              {webgl
                ? "The 3D view is off. Pick a part below; every action, check and lesson works the same as in 3D."
                : "This computer cannot show 3D graphics (WebGL is unavailable). Pick a part below; every action, check and lesson works the same."}
            </p>
            <PartsPanel state={run.sim} selected={selected} onSelect={select} />
          </div>
        )}

        {/* Overlays */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <span className="rounded-full border border-[#f59e0b]/50 bg-[#451a03]/80 px-2.5 py-1 text-[10px] font-bold tracking-[0.8px] text-[#fcd34d] uppercase">
            Simulation · generic PC
          </span>
          <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
            {use3d &&
              VIEWS.map((v) => (
                <button key={v.id} type="button" className={toolClass(view === v.id)} onClick={() => goTo(v.id)}>
                  {v.label}
                </button>
              ))}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-3 top-14 flex justify-center">
          {feedback && <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
          <div>{selected && <PartCard id={selected} run={run} onAction={act} onClose={() => setSelected(null)} />}</div>
          <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5">
            {use3d && (
              <>
                <button
                  type="button"
                  className={toolClass(exploded)}
                  aria-pressed={exploded}
                  onClick={() => {
                    setExploded((x) => !x);
                    goTo(exploded ? "overview" : "angled");
                  }}
                >
                  <Layers size={13} /> {exploded ? "Assembled" : "Exploded"}
                </button>
                <button type="button" className={toolClass(hidePanels)} aria-pressed={hidePanels} onClick={() => setHidePanels((x) => !x)}>
                  {hidePanels ? <Eye size={13} /> : <EyeOff size={13} />} {hidePanels ? "Show glass" : "Hide glass"}
                </button>
                <button type="button" className={toolClass()} onClick={() => goTo(view)}>
                  <Maximize2 size={13} /> Reset view
                </button>
              </>
            )}
            {webgl && (
              <button type="button" className={toolClass(!use3d)} aria-pressed={!use3d} onClick={() => setUse3d((x) => !x)}>
                {use3d ? <MonitorOff size={13} /> : <BoxIcon size={13} />} {use3d ? "No-3D mode" : "Show 3D"}
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="grid min-w-0 content-start gap-3 rounded-2xl border border-[#e3e8ef] bg-white p-4 xl:max-h-[calc(100vh-250px)] xl:min-h-[540px] xl:overflow-y-auto">
        <div className="flex gap-1 border-b border-[#e3e8ef]" role="tablist" aria-label="Lab panels">
          {(["lesson", "parts"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px cursor-pointer border-x-0 border-t-0 border-b-2 border-solid bg-transparent px-3 py-2 text-xs font-semibold ${
                tab === t ? "border-[#2563eb] text-[#1d4ed8]" : "border-transparent text-[#5b6577] hover:text-[#172033]"
              }`}
            >
              {t === "lesson" ? "Lesson" : "Parts"}
            </button>
          ))}
        </div>
        {tab === "lesson" ? (
          <LessonPanel
            run={run}
            labs={data.labs}
            onStart={start}
            onRestart={() => start(run.lesson)}
            onHint={() => setRun((r) => withHint(r))}
            onOpenLibraryLesson={onOpenLibraryLesson}
            elapsedMin={elapsedMin}
          />
        ) : (
          <PartsPanel state={run.sim} selected={selected} onSelect={select} />
        )}
      </aside>
    </div>
  );
}
