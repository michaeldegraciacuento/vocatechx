import { Box as BoxIcon, Crosshair, Expand, Eye, EyeOff, Hand, Layers, MonitorOff, MonitorPlay, MousePointer2, PanelRightClose, PanelRightOpen, Pause, Play, Shrink, SkipForward, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Component, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import type { LearningData } from "../learning/useLearning";
import { LessonPanel } from "./LessonPanel";
import { PartsPanel } from "./PartsPanel";
import { LabCanvas, type LabTool } from "./scene/LabCanvas";
import type { Highlight } from "./scene/motion";
import { actionLabel, actionsFor, type Action } from "./sim/engine";
import { LAB_LESSONS, type CameraView, type LabLesson } from "./sim/lessons";
import { PARTS, type PartId } from "./sim/parts";
import { attempt, demoPart, expectedAction, isComplete, startRun, withHint, type Feedback, type Run } from "./sim/runner";
import { partStatus } from "./sim/status";

const VIEWS: { id: CameraView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "cpu", label: "CPU" },
  { id: "ram", label: "RAM" },
  { id: "gpu", label: "GPU" },
  { id: "m2", label: "M.2" },
  { id: "bench", label: "Mat" },
];

const TOOLS: { id: LabTool; label: string; shortcut: string; icon: typeof Hand; tip: string }[] = [
  { id: "select", label: "Select", shortcut: "V", icon: MousePointer2, tip: "Click a part to select it; drag to rotate." },
  { id: "hand", label: "Hand", shortcut: "H", icon: Hand, tip: "Drag to pan. Hold Space for a moment of Hand." },
];

const KIND_LABEL ={ safety: "Safety", order: "Not yet", forcing: "Would damage hardware", invalid: "Not possible" } as const;

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
function PartCard({ id, run, variant, onAction, onClose }: { id: PartId; run: Run; variant: "panel" | "overlay"; onAction: (a: Action) => void; onClose: () => void }) {
  const part = PARTS[id];
  const actions = actionsFor(id, run.sim);
  const status = partStatus(id, run.sim);
  const s = CARD_STYLE[variant];
  return (
    <div data-part-card className={s.card}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`m-0 text-[10px] font-bold tracking-[0.8px] uppercase ${s.group}`}>{part.group}</p>
          <p className={`m-0 mt-0.5 text-sm font-bold ${s.title}`}>{part.name}</p>
          {status && <p className={`m-0 mt-0.5 text-[11px] ${s.muted}`}>{status}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={`grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-none ${s.close}`}>
          <X size={14} />
        </button>
      </div>
      <p className={`m-0 mt-2 text-xs leading-[1.55] ${s.body}`}>{part.role}</p>
      <ul className={`m-0 mt-2 grid list-disc gap-0.5 pl-4 text-[11px] leading-[1.5] ${s.muted}`}>
        {part.specs.map((spec) => (
          <li key={spec}>{spec}</li>
        ))}
      </ul>
      {part.caution && <p className={`m-0 mt-2 rounded-[8px] px-2.5 py-1.5 text-[11px] leading-[1.5] ${s.caution}`}>{part.caution}</p>}
      {actions.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {actions.map((a, i) => (
            <button key={i} type="button" onClick={() => onAction(a)} className={`cursor-pointer rounded-[9px] border px-3 py-2 text-left text-xs font-semibold transition-colors ${s.action}`}>
              {actionLabel(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The card sits in the side panel normally, so it never covers parts in the
 *  3D view; it floats over the view only in full screen with the panel hidden. */
const CARD_STYLE = {
  panel: {
    card: "rounded-[14px] border border-[#dbe5f5] bg-[#f5f8ff] p-3.5 text-[#344054]",
    group: "text-[#2563eb]",
    title: "text-[#172033]",
    muted: "text-[#5b6577]",
    body: "text-[#344054]",
    close: "bg-white text-[#5b6577] hover:bg-[#eef2f7]",
    caution: "bg-[#fffbeb] text-[#92400e]",
    action: "border-[#dce2eb] bg-white text-[#172033] hover:border-[#2563eb] hover:bg-[#eef4ff]",
  },
  overlay: {
    card: "pointer-events-auto w-[340px] max-w-full rounded-2xl border border-white/10 bg-[#0f172a]/90 p-4 text-[#dbe4f0] shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur",
    group: "text-[#7db5ff]",
    title: "text-white",
    muted: "text-[#9fb0c8]",
    body: "text-[#c7d2e1]",
    close: "bg-white/5 text-[#9fb0c8] hover:bg-white/10",
    caution: "bg-[#78350f]/40 text-[#fde68a]",
    action: "border-white/10 bg-white/5 text-white hover:border-[#60a5fa] hover:bg-[#1d4ed8]/40",
  },
};

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

/** A demonstration playing a lesson by itself. */
type Demo = { playing: boolean; speed: 1 | 2 };

/** Milliseconds a demo shows each step's caption before doing it, then waits for the animation. */
const DEMO_SHOW_MS = 1700;
const DEMO_SETTLE_MS = 1500;

const lessonById = (id: string | undefined) => LAB_LESSONS.find((l) => l.id === id) ?? null;

/** The 3D Hardware Lab: a simulated PC to take apart, freely or in guided lessons. */
export default function HardwareLabPage({
  data,
  onOpenLibraryLesson,
  autoDemo,
}: {
  data: LearningData;
  onOpenLibraryLesson?: (id: string) => void;
  /** Opens the lab already playing this lesson's demonstration. */
  autoDemo?: string;
}) {
  const [run, setRun] = useState<Run>(() => startRun(lessonById(autoDemo)));
  const [demo, setDemo] = useState<Demo | null>(() => (lessonById(autoDemo) ? { playing: true, speed: 1 } : null));
  const [selected, setSelected] = useState<PartId | null>(null);
  const [hovered, setHovered] = useState<PartId | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [exploded, setExploded] = useState(false);
  const [hidePanels, setHidePanels] = useState(false);
  const [view, setView] = useState<CameraView>(() => lessonById(autoDemo)?.steps[0]?.camera ?? "overview");
  const [viewRequest, setViewRequest] = useState(0);
  const [tab, setTab] = useState<"lesson" | "parts">("lesson");
  const [webgl] = useState(webglAvailable);
  const [use3d, setUse3d] = useState(webgl);
  const [elapsedMin, setElapsedMin] = useState<number | null>(null);
  // Tools, as in Photoshop or Canva: V selects, H pans, holding Space pans for a moment.
  const [tool, setTool] = useState<LabTool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointerInView = useRef(false);
  // Full screen covers the whole app (and the monitor, in the desktop app).
  const [fullscreen, setFullscreen] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const recorded = useRef<number | null>(null);
  const { recordLab } = data;
  const activeTool: LabTool = spaceHeld ? "hand" : tool;

  const chooseTool = useCallback((next: LabTool) => {
    setTool(next);
    // Leaving Select mode: drop any hover glow and the pointer cursor.
    setHovered(null);
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "h") chooseTool("hand");
      else if (key === "v") chooseTool("select");
      else if (key === "f") setFullscreen((f) => !f);
      else if (e.key === "Escape") setFullscreen(false);
      else if (e.code === "Space" && pointerInView.current) {
        // Only over the 3D view, so Space still presses buttons elsewhere.
        e.preventDefault();
        if (!e.repeat) {
          setSpaceHeld(true);
          setHovered(null);
          document.body.style.cursor = "";
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpaceHeld((held) => {
        if (held) e.preventDefault();
        return false;
      });
    };
    const release = () => setSpaceHeld(false);
    // In a browser, Esc leaves page fullscreen before the page sees the key.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !isTauri()) setFullscreen(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [chooseTool]);

  // Match the real window to the lab's full-screen mode. In a plain browser
  // (no Tauri) the page fullscreen API is used instead. Leaving the lab
  // always restores the window.
  useEffect(() => {
    const apply = async (on: boolean) => {
      try {
        if (isTauri()) {
          await getCurrentWindow().setFullscreen(on);
        } else if (on && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else if (!on && document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        // The in-app overlay still covers the sidebar and header.
      }
    };
    apply(fullscreen);
    return () => {
      if (fullscreen) apply(false);
    };
  }, [fullscreen]);

  const goTo = useCallback((next: CameraView) => {
    setView(next);
    setViewRequest((n) => n + 1);
  }, []);

  const start = (lesson: LabLesson | null, asDemo = false) => {
    setRun(startRun(lesson));
    setDemo(asDemo && lesson ? { playing: true, speed: demo?.speed ?? 1 } : null);
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
    // Save a finished lesson once. A watched (or partly watched) demo is not the learner's own result.
    if (!demo && isComplete(result.run) && recorded.current !== result.run.startedAt) {
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

  // What the learner does by hand pauses a playing demo, so they can look or take over.
  const pauseDemo = () => setDemo((d) => (d?.playing ? { ...d, playing: false } : d));
  const userAct = (action: Action) => {
    pauseDemo();
    act(action);
  };
  const userSelect = (id: PartId) => {
    pauseDemo();
    select(id);
  };

  const complete = isComplete(run);

  // The demo: for each step, select the part and show the instruction, then
  // perform the step's action through the same path as a learner would.
  const demoStep = run.lesson && !complete ? run.lesson.steps[run.step] : null;
  const showDemoStep = useEffectEvent(() => {
    if (!demoStep || !run.lesson) return;
    const part = demoPart(demoStep, run.sim);
    if (part) setSelected(part);
    setFeedback({ tone: "info", message: `Demo · step ${run.step + 1} of ${run.lesson.steps.length}: ${demoStep.instruction}` });
  });
  const doDemoStep = useEffectEvent(() => {
    if (!demoStep) return;
    if (demoStep.expect.type === "identify") select(demoPart(demoStep, run.sim)!);
    else act(expectedAction(demoStep));
  });
  useEffect(() => {
    if (!demo?.playing || !demoStep) return;
    // After an action, wait for its animation before captioning the next step.
    const settle = run.step === 0 ? 250 : DEMO_SETTLE_MS;
    const show = window.setTimeout(showDemoStep, settle / demo.speed);
    const perform = window.setTimeout(doDemoStep, (settle + DEMO_SHOW_MS) / demo.speed);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(perform);
    };
    // A new step (run.step) or a new run (startedAt) schedules the next beat.
  }, [demo?.playing, demo?.speed, demoStep, run.step, run.startedAt]);

  /** Performs the current step at once (the demo's "Next step"). */
  const demoNext = () => {
    if (!demoStep) return;
    setDemo((d) => (d ? { ...d, playing: false } : d));
    if (demoStep.expect.type === "identify") select(demoPart(demoStep, run.sim)!);
    else {
      const part = demoPart(demoStep, run.sim);
      if (part) setSelected(part);
      act(expectedAction(demoStep));
    }
  };
  // Part details live in the side panel unless full screen has hidden it.
  const panelVisible = !fullscreen || showPanel;

  const targets = useMemo(() => (run.lesson && !complete ? (run.lesson.steps[run.step]?.highlight ?? []) : []), [run, complete]);
  const hl = useCallback(
    (id: PartId): Highlight => (selected === id ? "selected" : hovered === id ? "hover" : targets.includes(id) ? "target" : "none"),
    [selected, hovered, targets],
  );

  return (
    <div
      className={
        fullscreen
          ? `fixed inset-0 z-[100] grid gap-3 bg-[#070b13] p-3 ${showPanel ? "grid-cols-[minmax(0,1fr)_360px]" : "grid-cols-1"}`
          : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      }
    >
      <div
        className={`relative overflow-hidden rounded-2xl border border-[#1e293b] bg-[#0c111c] ${fullscreen ? "h-full min-h-0" : "h-[calc(100vh-250px)] min-h-[540px]"}`}
        style={{ cursor: use3d && activeTool === "hand" ? (dragging ? "grabbing" : "grab") : undefined }}
        onPointerEnter={() => (pointerInView.current = true)}
        onPointerLeave={() => {
          pointerInView.current = false;
          setDragging(false);
        }}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
      >
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
              tool={activeTool}
              hl={hl}
              onSelect={userSelect}
              onHover={setHovered}
              onMiss={() => activeTool === "select" && setSelected(null)}
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
            <PartsPanel state={run.sim} selected={selected} onSelect={userSelect} />
          </div>
        )}

        {/* Tool palette, as in an image editor */}
        {use3d && (
          <div className="absolute top-12 left-3 z-10 grid gap-1.5 rounded-[12px] border border-white/10 bg-[#0f172a]/80 p-1.5 backdrop-blur" role="toolbar" aria-label="Tools">
            {TOOLS.map(({ id, label, shortcut, icon: Icon, tip }) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseTool(id)}
                aria-pressed={activeTool === id}
                aria-keyshortcuts={shortcut}
                title={`${label} (${shortcut}). ${tip}`}
                className={`relative grid h-9 w-9 cursor-pointer place-items-center rounded-[9px] border-none transition-colors ${
                  activeTool === id ? "bg-[#2563eb] text-white" : "bg-transparent text-[#c7d2e1] hover:bg-white/10"
                }`}
              >
                <Icon size={17} />
                <span className="absolute right-0.5 bottom-0 text-[8px] font-bold opacity-70">{shortcut}</span>
              </button>
            ))}
          </div>
        )}
        {demo && run.lesson && (
          <div className="absolute bottom-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#60a5fa]/40 bg-[#0c1a3a]/90 py-1.5 pr-1.5 pl-3.5 text-[11px] font-semibold whitespace-nowrap text-[#dbeafe] shadow-lg backdrop-blur [&_button]:whitespace-nowrap">
            <span className="flex items-center gap-1.5 pr-1">
              <MonitorPlay size={13} className="text-[#7db5ff]" /> Demo · {Math.min(run.step + 1, run.lesson.steps.length)}/{run.lesson.steps.length}
            </span>
            <button
              type="button"
              className={toolClass(false)}
              onClick={() => setDemo((d) => (d ? { ...d, playing: !d.playing } : d))}
              disabled={complete}
              aria-label={demo.playing ? "Pause demo" : "Play demo"}
            >
              {demo.playing ? <Pause size={13} /> : <Play size={13} />} {demo.playing ? "Pause" : "Play"}
            </button>
            <button type="button" className={toolClass(false)} onClick={demoNext} disabled={complete} aria-label="Next step">
              <SkipForward size={13} /> Next
            </button>
            <button
              type="button"
              className={toolClass(demo.speed === 2)}
              aria-pressed={demo.speed === 2}
              onClick={() => setDemo((d) => (d ? { ...d, speed: d.speed === 1 ? 2 : 1 } : d))}
            >
              {demo.speed}×
            </button>
            <button type="button" className={toolClass(true)} onClick={() => start(run.lesson)}>
              <Hand size={13} /> Try it yourself
            </button>
          </div>
        )}
        {use3d && activeTool === "hand" && !demo && (
          <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-[#0f172a]/80 px-3 py-1.5 text-[11px] font-semibold text-[#dbe4f0] backdrop-blur">
            {spaceHeld ? "Hand tool while Space is held: drag to pan" : "Hand tool: drag to pan · right-drag to rotate · press V to select parts"}
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

        <div className="pointer-events-none absolute top-14 right-3 left-16 flex justify-center">
          {feedback && <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />}
        </div>

        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
          {/* Floats over the view only when the side panel is not beside it
              (narrow windows, or full screen with the panel hidden). */}
          <div className={panelVisible ? "lg:hidden" : ""}>
            {selected && <PartCard id={selected} run={run} variant="overlay" onAction={userAct} onClose={() => setSelected(null)} />}
          </div>
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
                  <Crosshair size={13} /> Reset view
                </button>
              </>
            )}
            {fullscreen && (
              <button type="button" className={toolClass(!showPanel)} aria-pressed={!showPanel} onClick={() => setShowPanel((x) => !x)}>
                {showPanel ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />} {showPanel ? "Hide panel" : "Show panel"}
              </button>
            )}
            <button
              type="button"
              className={toolClass(fullscreen)}
              aria-pressed={fullscreen}
              aria-keyshortcuts="F"
              title={fullscreen ? "Exit full screen (F or Esc)" : "Full screen (F)"}
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? <Shrink size={13} /> : <Expand size={13} />} {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
            {webgl && (
              <button type="button" className={toolClass(!use3d)} aria-pressed={!use3d} onClick={() => setUse3d((x) => !x)}>
                {use3d ? <MonitorOff size={13} /> : <BoxIcon size={13} />} {use3d ? "No-3D mode" : "Show 3D"}
              </button>
            )}
          </div>
        </div>
      </div>

      <aside
        className={`grid min-w-0 content-start gap-3 rounded-2xl border border-[#e3e8ef] bg-white p-4 ${
          fullscreen ? (showPanel ? "h-full min-h-0 overflow-y-auto" : "hidden") : "lg:max-h-[calc(100vh-250px)] lg:min-h-[540px] lg:overflow-y-auto"
        }`}
      >
        {selected && panelVisible && (
          <div className={fullscreen ? "" : "hidden lg:block"}>
            <PartCard id={selected} run={run} variant="panel" onAction={userAct} onClose={() => setSelected(null)} />
          </div>
        )}
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
            key={run.startedAt}
            run={run}
            labs={data.labs}
            onStart={start}
            onRestart={() => start(run.lesson, demo !== null)}
            onHint={() => setRun((r) => withHint(r))}
            onOpenLibraryLesson={onOpenLibraryLesson}
            elapsedMin={elapsedMin}
            demo={demo !== null}
            onWatchDemo={() => start(run.lesson, true)}
            onTryIt={() => start(run.lesson)}
          />
        ) : (
          <PartsPanel state={run.sim} selected={selected} onSelect={userSelect} />
        )}
      </aside>
    </div>
  );
}
