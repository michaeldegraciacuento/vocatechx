import { actionsFor, apply, ASSEMBLED, type Action, type ErrorKind, type SimState } from "./engine";
import { matches, type LabLesson, type LabStep } from "./lessons";
import { PARTS, type PartId } from "./parts";

// Runs a guided lesson (or free exploration) on top of the engine: decides
// whether each action is the expected step, a known mistake, unsafe, or just
// not what the lesson asks for right now.

export type Feedback = { tone: "success" | "error" | "info"; message: string; kind?: ErrorKind };

export type Run = {
  lesson: LabLesson | null;
  sim: SimState;
  step: number;
  mistakes: number;
  hints: number;
  startedAt: number;
};

export function startRun(lesson: LabLesson | null, now = Date.now()): Run {
  return { lesson, sim: structuredClone(lesson?.start ?? ASSEMBLED), step: 0, mistakes: 0, hints: 0, startedAt: now };
}

export function isComplete(run: Run): boolean {
  return run.lesson !== null && run.step >= run.lesson.steps.length;
}

/** Applies a user action. Returns `null` feedback when nothing needs saying
 *  (selecting a part while exploring). */
export function attempt(run: Run, action: Action): { run: Run; feedback: Feedback | null } {
  const lesson = run.lesson;

  if (!lesson) {
    if (action.type === "identify") return { run, feedback: null };
    const r = apply(run.sim, action);
    return r.ok
      ? { run: { ...run, sim: r.state }, feedback: { tone: "success", message: r.message } }
      : { run, feedback: { tone: "error", message: r.message, kind: r.kind } };
  }

  if (isComplete(run)) {
    return action.type === "identify" ? { run, feedback: null } : { run, feedback: { tone: "info", message: "Lesson complete. Restart it or choose another lesson." } };
  }

  const step = lesson.steps[run.step];
  const mistake = (message: string, kind?: ErrorKind): { run: Run; feedback: Feedback } => ({
    run: { ...run, mistakes: run.mistakes + 1 },
    feedback: { tone: "error", message, kind },
  });

  if (matches(step.expect, action)) {
    const r = apply(run.sim, action);
    if (!r.ok) return mistake(r.message, r.kind);
    const name = action.type === "identify" ? PARTS[action.part].name : null;
    const message = [name ? `Correct: you found the ${name}.` : r.message, step.explain].filter(Boolean).join(" ");
    return { run: { ...run, sim: r.state, step: run.step + 1 }, feedback: { tone: "success", message } };
  }

  const known = step.mistakes?.find((m) => matches(m.match, action));
  if (known) return mistake(known.message, "order");

  if (action.type === "identify") {
    // Selecting parts is how you look around; it only counts during "find it" steps.
    if (step.expect.type !== "identify") return { run, feedback: null };
    return mistake(`Not quite: you selected the ${PARTS[action.part].name}. ${step.hint}`);
  }

  const r = apply(run.sim, action);
  if (!r.ok) return mistake(r.message, r.kind);
  return { run, feedback: { tone: "info", message: `That would work, but it is not this step. ${step.instruction}` } };
}

export function withHint(run: Run): Run {
  return { ...run, hints: run.hints + 1 };
}

/** The concrete action a step asks for (the first part, when several are accepted). */
export function expectedAction(step: LabStep): Action {
  const m = step.expect;
  const part = Array.isArray(m.part) ? m.part[0] : m.part;
  return { type: m.type, ...(part ? { part } : {}), ...(m.slot ? { slot: m.slot } : {}) } as Action;
}

/** The part a demonstration selects to perform a step: the one that offers its action. */
export function demoPart(step: LabStep, sim: SimState): PartId | null {
  if (step.expect.type === "identify") {
    return (Array.isArray(step.expect.part) ? step.expect.part[0] : step.expect.part) ?? null;
  }
  return step.highlight.find((p) => actionsFor(p, sim).some((a) => matches(step.expect, a))) ?? step.highlight[0] ?? null;
}
