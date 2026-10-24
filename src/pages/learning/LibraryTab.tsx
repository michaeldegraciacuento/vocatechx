import { BookmarkCheck, Clock, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORIES, categoryTitle } from "../../content/categories";
import { EMPTY_FILTER, filterLessons, lessonStatus, type LessonFilter, type LessonStatus } from "../../content/library";
import type { Difficulty, Lesson } from "../../content/schema";
import { EmptyState, fieldClass } from "../network/ui";
import { BookmarkButton, DifficultyBadge, DraftBadge, StatusBadge } from "./ui";
import type { LearningData } from "./useLearning";

const chipClass = (active: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
    active ? "border-[#2563eb] bg-[#eef4ff] text-[#1d4ed8]" : "border-[#e3e8ef] bg-white text-[#5b6577] hover:bg-[#f7f9fc]"
  }`;

function LessonCard({ lesson, data, onOpen }: { lesson: Lesson; data: LearningData; onOpen: () => void }) {
  const status = lessonStatus(data.progress.get(lesson.id));
  const best = lesson.quizId ? data.quizzes.get(lesson.quizId) : undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-2xl border border-[#e3e8ef] bg-white p-4 text-left transition-colors hover:border-[#c7d2e1] focus-visible:shadow-[0_0_0_3px_#3b82f640] focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-[10px] font-bold tracking-[0.6px] text-[#2563eb] uppercase">{categoryTitle(lesson.category)}</p>
        <BookmarkButton bookmarked={data.bookmarks.has(lesson.id)} onToggle={() => data.toggleBookmark(lesson.id)} />
      </div>
      <div className="min-w-0">
        <p className="m-0 text-sm font-bold text-[#172033]">{lesson.title}</p>
        <p className="m-0 mt-1 line-clamp-2 text-xs leading-[1.55] text-[#5b6577]">{lesson.description}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <DifficultyBadge difficulty={lesson.difficulty} />
        <StatusBadge status={status} />
        <DraftBadge lesson={lesson} />
        {best && <span className="text-[10px] font-semibold text-[#5b6577]">Quiz best {Math.round((best.bestScore / best.maxScore) * 100)}%</span>}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-[#8b95a6]">
          <Clock size={11} /> {lesson.durationMin} min
        </span>
      </div>
    </div>
  );
}

export function LibraryTab({ lessons, data, onOpen }: { lessons: Lesson[]; data: LearningData; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<LessonFilter>(EMPTY_FILTER);
  const set = (patch: Partial<LessonFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const visible = useMemo(() => filterLessons(lessons, filter, data.bookmarks, data.progress), [lessons, filter, data.bookmarks, data.progress]);
  const counts = useMemo(() => new Map(CATEGORIES.map((c) => [c.id, lessons.filter((l) => l.category === c.id).length])), [lessons]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#a0a9b8]" />
          <input
            className={`${fieldClass} pl-8`}
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search lessons, tools or topics"
            aria-label="Search lessons"
          />
        </div>
        <select
          className={`${fieldClass} w-auto`}
          value={filter.difficulty ?? ""}
          onChange={(e) => set({ difficulty: (e.target.value || null) as Difficulty | null })}
          aria-label="Difficulty"
        >
          <option value="">All levels</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <select
          className={`${fieldClass} w-auto`}
          value={filter.status ?? ""}
          onChange={(e) => set({ status: (e.target.value || null) as LessonStatus | null })}
          aria-label="Progress"
        >
          <option value="">Any progress</option>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <button type="button" className={chipClass(filter.bookmarkedOnly)} aria-pressed={filter.bookmarkedOnly} onClick={() => set({ bookmarkedOnly: !filter.bookmarkedOnly })}>
          <span className="flex items-center gap-1">
            <BookmarkCheck size={12} /> Bookmarked
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        <button type="button" className={chipClass(filter.category === null)} aria-pressed={filter.category === null} onClick={() => set({ category: null })}>
          All ({lessons.length})
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={chipClass(filter.category === c.id)}
            aria-pressed={filter.category === c.id}
            onClick={() => set({ category: c.id })}
            title={c.description}
          >
            {c.title} ({counts.get(c.id) ?? 0})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Search} title="No matching lessons">
          {filter.category && (counts.get(filter.category) ?? 0) === 0
            ? "Lessons for this category are still being written."
            : "Try a different search or clear the filters."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((l) => (
            <LessonCard key={l.id} lesson={l} data={data} onOpen={() => onOpen(l.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
