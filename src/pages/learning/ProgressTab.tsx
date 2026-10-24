import { GraduationCap } from "lucide-react";
import { CATEGORIES } from "../../content/categories";
import { lessonStatus } from "../../content/library";
import type { Lesson } from "../../content/schema";
import { formatRelativeTime } from "../../lib/format";
import { EmptyState, Panel } from "../network/ui";
import { StatusBadge } from "./ui";
import type { LearningData } from "./useLearning";

function Bar({ value, max }: { value: number; max: number }) {
  const percent = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[#e8edf4]" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** The signed-in account's progress by category, and every lesson it has started. */
export function ProgressTab({ lessons, data, onOpen }: { lessons: Lesson[]; data: LearningData; onOpen: (id: string) => void }) {
  const started = lessons
    .map((l) => ({ lesson: l, record: data.progress.get(l.id) }))
    .filter((x) => x.record)
    .sort((a, b) => (b.record!.completedAt ?? b.record!.startedAt) - (a.record!.completedAt ?? a.record!.startedAt));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="By category" description="Completed lessons out of those available.">
        <div className="grid gap-3.5">
          {CATEGORIES.map((c) => {
            const inCategory = lessons.filter((l) => l.category === c.id);
            const completed = inCategory.filter((l) => lessonStatus(data.progress.get(l.id)) === "completed").length;
            return (
              <div key={c.id} className="grid gap-1.5">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#344054]">{c.title}</span>
                  <span className="text-[#8b95a6]">{inCategory.length === 0 ? "Coming soon" : `${completed} / ${inCategory.length}`}</span>
                </div>
                <Bar value={completed} max={inCategory.length} />
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Your lessons" description="Lessons you have started, most recent first.">
        {started.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Nothing started yet">
            Open a lesson from the library; your progress and quiz scores are saved to your account.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {started.map(({ lesson, record }) => {
              const best = lesson.quizId ? data.quizzes.get(lesson.quizId) : undefined;
              return (
                <li key={lesson.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(lesson.id)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] border-none bg-transparent px-3 py-2.5 text-left hover:bg-[#f7f9fc]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-[#172033]">{lesson.title}</span>
                      <span className="block text-[11px] text-[#788397]">
                        {record!.completedAt ? `Completed ${formatRelativeTime(record!.completedAt)}` : `Started ${formatRelativeTime(record!.startedAt)}`}
                        {best ? ` · quiz best ${best.bestScore}/${best.maxScore}${best.passed ? " (passed)" : ""}` : ""}
                      </span>
                    </span>
                    <StatusBadge status={lessonStatus(record)} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
