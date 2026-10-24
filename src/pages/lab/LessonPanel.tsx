import { CheckCircle2, Circle, Lightbulb, PlayCircle, RotateCcw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { catalog } from "../../content";
import type { LabBest } from "../../lib/api";
import { buttonClass, fieldClass, secondaryButtonClass } from "../network/ui";
import { LAB_LESSONS, type LabLesson } from "./sim/lessons";
import { isComplete, type Run } from "./sim/runner";

const FREE = "free";

/** Lesson picker, the safety brief, the step list and the result. */
export function LessonPanel({
  run,
  labs,
  onStart,
  onRestart,
  onHint,
  onOpenLibraryLesson,
  elapsedMin,
}: {
  run: Run;
  labs: ReadonlyMap<string, LabBest>;
  onStart: (lesson: LabLesson | null) => void;
  onRestart: () => void;
  onHint: () => void;
  onOpenLibraryLesson?: (id: string) => void;
  /** Minutes the finished lesson took. */
  elapsedMin: number | null;
}) {
  const [showHint, setShowHint] = useState<number | null>(null);
  const lesson = run.lesson;
  const done = isComplete(run);

  const pick = (id: string) => {
    setShowHint(null);
    onStart(id === FREE ? null : (LAB_LESSONS.find((l) => l.id === id) ?? null));
  };

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-xs font-semibold text-[#344054]">
        Lesson
        <select className={fieldClass} value={lesson?.id ?? FREE} onChange={(e) => pick(e.target.value)}>
          <option value={FREE}>Free exploration</option>
          {LAB_LESSONS.map((l, i) => {
            const best = labs.get(l.id);
            return (
              <option key={l.id} value={l.id}>
                {i + 1}. {l.title}
                {best ? " ✓" : ""}
              </option>
            );
          })}
        </select>
      </label>

      {!lesson && (
        <div className="grid gap-2 rounded-[12px] bg-[#f7f9fc] px-3.5 py-3 text-xs leading-[1.6] text-[#344054]">
          <p className="m-0 font-semibold text-[#172033]">Explore freely</p>
          <p className="m-0">
            Select any part in the 3D view or the Parts list, then use its actions. Unsafe or impossible actions are refused with an
            explanation, just as they should be on a real PC.
          </p>
          <p className="m-0">Start with the power cord and the wrist strap.</p>
        </div>
      )}

      {lesson && (
        <>
          <div>
            <p className="m-0 text-sm font-bold text-[#172033]">{lesson.title}</p>
            <p className="m-0 mt-1 text-xs leading-[1.55] text-[#5b6577]">{lesson.summary}</p>
            {lesson.prerequisites.length > 0 && (
              <p className="m-0 mt-2 text-[11px] text-[#788397]">
                Read first:{" "}
                {lesson.prerequisites.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    {onOpenLibraryLesson ? (
                      <button type="button" className="cursor-pointer border-none bg-transparent p-0 text-[11px] font-semibold text-[#1d4ed8] underline" onClick={() => onOpenLibraryLesson(id)}>
                        {catalog.lessons.find((l) => l.id === id)?.title ?? id}
                      </button>
                    ) : (
                      (catalog.lessons.find((l) => l.id === id)?.title ?? id)
                    )}
                  </span>
                ))}
              </p>
            )}
          </div>

          <div className="grid gap-1.5 rounded-[12px] border border-[#fde68a] bg-[#fffbeb] px-3.5 py-3">
            {lesson.safety.map((s) => (
              <p key={s} className="m-0 flex items-start gap-2 text-[11px] leading-[1.55] text-[#78350f]">
                <ShieldAlert size={13} className="mt-0.5 flex-shrink-0 text-[#d97706]" />
                {s}
              </p>
            ))}
          </div>

          <ol className="m-0 grid list-none gap-1 p-0">
            {lesson.steps.map((step, i) => {
              const state = i < run.step ? "done" : i === run.step ? "current" : "todo";
              return (
                <li
                  key={i}
                  aria-current={state === "current" ? "step" : undefined}
                  className={`rounded-[10px] px-3 py-2 text-xs leading-[1.5] ${state === "current" ? "bg-[#eef4ff] text-[#172033]" : state === "done" ? "text-[#5b6577]" : "text-[#a0a9b8]"}`}
                >
                  <div className="flex items-start gap-2">
                    {state === "done" ? (
                      <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-[#16a34a]" />
                    ) : state === "current" ? (
                      <PlayCircle size={14} className="mt-0.5 flex-shrink-0 text-[#2563eb]" />
                    ) : (
                      <Circle size={14} className="mt-0.5 flex-shrink-0" />
                    )}
                    <span className={state === "current" ? "font-semibold" : ""}>{step.instruction}</span>
                  </div>
                  {state === "current" && (
                    <div className="mt-2 pl-6">
                      {showHint === i ? (
                        <p className="m-0 rounded-[8px] bg-white px-2.5 py-2 text-[11px] text-[#344054]">{step.hint}</p>
                      ) : (
                        <button
                          type="button"
                          className={`${secondaryButtonClass} px-2.5 py-1 text-[11px]`}
                          onClick={() => {
                            setShowHint(i);
                            onHint();
                          }}
                        >
                          <Lightbulb size={12} /> Hint
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {done ? (
            <div className="grid gap-2 rounded-[12px] border border-[#d1fadf] bg-[#f6fef9] px-3.5 py-3 text-xs text-[#14532d]">
              <p className="m-0 flex items-center gap-2 text-[13px] font-bold">
                <CheckCircle2 size={16} className="text-[#16a34a]" /> Lesson complete
              </p>
              <p className="m-0">
                {run.mistakes === 0 ? "No mistakes" : `${run.mistakes} ${run.mistakes === 1 ? "mistake" : "mistakes"}`} · {run.hints}{" "}
                {run.hints === 1 ? "hint" : "hints"}{elapsedMin !== null && ` · about ${elapsedMin} min`}
              </p>
              <p className="m-0 text-[11px] text-[#166534]">Saved to your progress. Remember: this was a simulation. Real hardware differs, so follow its manual.</p>
              <button type="button" className={buttonClass} onClick={onRestart}>
                <RotateCcw size={14} /> Practise again
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[11px] text-[#8b95a6]">
              <span>
                Step {run.step + 1} of {lesson.steps.length} · {run.mistakes} {run.mistakes === 1 ? "mistake" : "mistakes"}
              </span>
              <button type="button" className={`${secondaryButtonClass} px-2.5 py-1 text-[11px]`} onClick={onRestart}>
                <RotateCcw size={12} /> Restart
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
