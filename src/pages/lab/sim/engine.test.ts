import { describe, expect, it } from "vitest";
import { catalog } from "../../../content";
import { actionsFor, apply, ASSEMBLED, unfinished, type Action, type SimState } from "./engine";
import { LAB_LESSONS, type ActionMatch } from "./lessons";
import { PARTS, type PartId } from "./parts";
import { attempt, isComplete, startRun } from "./runner";

/** Applies actions in order, failing the test with the engine's message if any is refused. */
function run(state: SimState, actions: Action[]): SimState {
  return actions.reduce((s, a) => {
    const r = apply(s, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.message}`);
    return r.state;
  }, state);
}

const opened = run(ASSEMBLED, [{ type: "unplug-power" }, { type: "wear-esd" }, { type: "remove-side-panel" }]);

/** The concrete action a step expects (the first part, when several are accepted). */
function toAction(m: ActionMatch): Action {
  const part = Array.isArray(m.part) ? m.part[0] : m.part;
  return { type: m.type, ...(part ? { part } : {}), ...(m.slot ? { slot: m.slot } : {}) } as Action;
}

describe("safety comes first", () => {
  it("refuses to touch anything while plugged in", () => {
    const r = apply(ASSEMBLED, { type: "remove-side-panel" });
    expect(r).toMatchObject({ ok: false, kind: "safety" });
  });

  it("needs the panel off and a wrist strap before handling components", () => {
    const unplugged = run(ASSEMBLED, [{ type: "unplug-power" }]);
    expect(apply(unplugged, { type: "open-ram-clips", slot: "A2" })).toMatchObject({ ok: false, kind: "order" });
    const noStrap = run(unplugged, [{ type: "remove-side-panel" }]);
    expect(apply(noStrap, { type: "open-ram-clips", slot: "A2" })).toMatchObject({ ok: false, kind: "safety" });
  });

  it("will not power on until everything is secured", () => {
    const loose = run(opened, [{ type: "disconnect-cooler-fan" }, { type: "install-side-panel" }]);
    const r = apply(loose, { type: "plug-in-power" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("CPU_FAN");
  });
});

describe("forcing is never rewarded", () => {
  const forcing = (state: SimState, action: Action) => expect(apply(state, action)).toMatchObject({ ok: false, kind: "forcing" });

  it("RAM: closed clips, wrong orientation", () => {
    forcing(opened, { type: "remove-ram", part: "ram-1" });
    const out = run(opened, [{ type: "open-ram-clips", slot: "A2" }, { type: "remove-ram", part: "ram-1" }]);
    forcing(out, { type: "insert-ram", part: "ram-1", slot: "A2" });
  });

  it("GPU: cable, screws and latch must all be released", () => {
    expect(apply(opened, { type: "remove-gpu" })).toMatchObject({ ok: false, kind: "forcing" });
    const noPower = run(opened, [{ type: "disconnect-gpu-power" }]);
    forcing(noPower, { type: "remove-gpu" });
    const noScrews = run(noPower, [{ type: "remove-gpu-screws" }]);
    forcing(noScrews, { type: "remove-gpu" });
    expect(apply(run(noScrews, [{ type: "release-pcie-latch" }]), { type: "remove-gpu" }).ok).toBe(true);
  });

  it("cooler and CPU: screws, socket and orientation", () => {
    forcing(run(opened, [{ type: "disconnect-cooler-fan" }]), { type: "remove-cooler" });
    const bare = run(opened, [{ type: "disconnect-cooler-fan" }, { type: "loosen-cooler-screws" }, { type: "remove-cooler" }, { type: "clean-paste" }]);
    forcing(bare, { type: "remove-cpu" });
    const out = run(bare, [{ type: "open-socket" }, { type: "remove-cpu" }]);
    forcing(out, { type: "insert-cpu" });
  });

  it("never installs a cooler without fresh paste", () => {
    const old = run(opened, [{ type: "disconnect-cooler-fan" }, { type: "loosen-cooler-screws" }, { type: "remove-cooler" }]);
    expect(apply(old, { type: "install-cooler" })).toMatchObject({ ok: false });
    expect(apply(old, { type: "apply-paste" })).toMatchObject({ ok: false, kind: "order" });
  });
});

describe("guided lessons", () => {
  it.each(LAB_LESSONS.map((l) => [l.id, l] as const))("%s can be completed by following its steps", (_, lesson) => {
    let r = startRun(lesson, 0);
    for (const step of lesson.steps) {
      const next = attempt(r, toAction(step.expect));
      expect(next.feedback?.tone, `${step.instruction}: ${next.feedback?.message}`).toBe("success");
      r = next.run;
    }
    expect(isComplete(r)).toBe(true);
    expect(r.mistakes).toBe(0);
  });

  it.each(LAB_LESSONS.map((l) => [l.id, l] as const))("%s gives each listed mistake its own message", (_, lesson) => {
    let r = startRun(lesson, 0);
    for (const step of lesson.steps) {
      for (const m of step.mistakes ?? []) {
        const tried = attempt(r, { ...toAction(step.expect), ...toAction(m.match) } as Action);
        expect(tried.feedback?.tone).toBe("error");
        expect(tried.run.sim).toEqual(r.sim);
      }
      r = attempt(r, toAction(step.expect)).run;
    }
  });

  it("links to library lessons that exist", () => {
    const ids = new Set(catalog.lessons.map((l) => l.id));
    for (const lesson of LAB_LESSONS) for (const p of lesson.prerequisites) expect(ids.has(p), `${lesson.id} → ${p}`).toBe(true);
  });

  it("lessons that leave the case end with it closed and powered", () => {
    for (const lesson of LAB_LESSONS.filter((l) => l.steps.some((s) => s.expect.type === "install-side-panel"))) {
      let r = startRun(lesson, 0);
      for (const step of lesson.steps) r = attempt(r, toAction(step.expect)).run;
      expect(r.sim.power && r.sim.sidePanel && unfinished(r.sim).length === 0, lesson.id).toBe(true);
    }
  });

  it("explains a valid action that is not the current step, without doing it", () => {
    const lesson = LAB_LESSONS.find((l) => l.id === "lab-ram")!;
    const r = startRun(lesson, 0);
    const tried = attempt(r, { type: "wear-esd" });
    expect(tried.feedback?.tone).toBe("info");
    expect(tried.run.sim).toEqual(r.sim);
  });
});

describe("parts", () => {
  it("every part has a description, and every offered action is labelled", () => {
    for (const id of Object.keys(PARTS) as PartId[]) {
      expect(PARTS[id].role.length).toBeGreaterThan(10);
      for (const a of actionsFor(id, opened)) expect(a.type).toBeTruthy();
    }
  });
});
