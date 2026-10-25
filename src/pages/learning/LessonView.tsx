import { ArrowLeft, ArrowRight, Box, CheckCircle2, ChevronDown, Clock, ListChecks, MonitorPlay, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownText } from "../../components/MarkdownText";
import { catalog } from "../../content";
import { categoryTitle } from "../../content/categories";
import { lessonStatus, missingPrerequisites } from "../../content/library";
import { LAB_LESSONS } from "../lab/sim/lessons";
import type { Lesson } from "../../content/schema";
import { ErrorNote, Panel, buttonClass, secondaryButtonClass } from "../network/ui";
import { BookmarkButton, DifficultyBadge, DraftBadge, LessonImage, SafetyCallout, StatusBadge } from "./ui";
import type { LearningData } from "./useLearning";

function KnowledgeCheck({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[12px] border border-[#e3e8ef]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-3.5 py-3 text-left text-[13px] font-semibold text-[#172033]"
      >
        {question}
        <ChevronDown size={15} className={`flex-shrink-0 text-[#8b95a6] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="m-0 border-t border-[#eef1f5] px-3.5 py-3 text-xs leading-[1.6] text-[#344054]">{answer}</p>}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="m-0 grid list-disc gap-1.5 pl-5 text-xs leading-[1.6] text-[#344054]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** One lesson, page by page: overview (objectives, tools, safety), each step,
 *  then a review (expected results, mistakes, checks). The page reached is
 *  saved, so the lesson reopens where the user left off. */
export function LessonView({
  lesson,
  data,
  onBack,
  onOpenLesson,
  onTakeQuiz,
  onWatchDemo,
}: {
  lesson: Lesson;
  data: LearningData;
  onBack: () => void;
  onOpenLesson: (id: string) => void;
  onTakeQuiz: (quizId: string) => void;
  /** Opens the 3D Hardware Lab playing this lab lesson's demonstration. */
  onWatchDemo?: (labLessonId: string) => void;
}) {
  const record = data.progress.get(lesson.id);
  const lastPage = lesson.steps.length + 1;
  const [page, setPage] = useState(() => Math.min(record?.lastStep ?? 0, lastPage));
  const status = lessonStatus(record);
  const missing = missingPrerequisites(lesson, data.progress);
  const demos = LAB_LESSONS.filter((l) => l.libraryLessons.includes(lesson.id));
  const top = useRef<HTMLDivElement>(null);
  const { saveProgress } = data;

  // Opening a lesson marks it as started; moving through it saves the page.
  useEffect(() => {
    saveProgress(lesson.id, lesson.version, page, false);
  }, [saveProgress, lesson.id, lesson.version, page]);

  const go = (next: number) => {
    setPage(Math.max(0, Math.min(lastPage, next)));
    top.current?.scrollIntoView({ block: "start" });
  };

  const pages = ["Overview", ...lesson.steps.map((s) => s.title), "Review"];
  const step = page >= 1 && page <= lesson.steps.length ? lesson.steps[page - 1] : null;

  return (
    <div className="grid gap-5" ref={top}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" className={`${secondaryButtonClass} mb-3`} onClick={onBack}>
            <ArrowLeft size={14} /> All lessons
          </button>
          <p className="m-0 text-[10px] font-bold tracking-[0.6px] text-[#2563eb] uppercase">{categoryTitle(lesson.category)}</p>
          <h2 className="m-0 mt-1 text-xl font-bold tracking-[-0.3px] text-[#172033]">{lesson.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DifficultyBadge difficulty={lesson.difficulty} />
            <StatusBadge status={status} />
            <DraftBadge lesson={lesson} />
            <span className="flex items-center gap-1 text-[11px] text-[#8b95a6]">
              <Clock size={12} /> {lesson.durationMin} min
            </span>
          </div>
        </div>
        <BookmarkButton bookmarked={data.bookmarks.has(lesson.id)} onToggle={() => data.toggleBookmark(lesson.id)} />
      </div>

      {!lesson.reviewed && (
        <p className="m-0 rounded-[10px] bg-[#f3f5f8] px-3.5 py-2.5 text-[11px] leading-[1.6] text-[#5b6577]">
          <span className="font-semibold">Draft lesson.</span> It has not been reviewed by an instructor yet. Check anything you are unsure of against
          the component's manual.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Lesson pages" className="self-start lg:sticky lg:top-0">
          <ol className="m-0 grid list-none gap-0.5 p-0">
            {pages.map((title, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={page === i ? "step" : undefined}
                  className={`flex w-full cursor-pointer items-start gap-2 rounded-[9px] border-none px-2.5 py-2 text-left text-xs leading-[1.4] ${
                    page === i ? "bg-[#eef4ff] font-semibold text-[#1d4ed8]" : "bg-transparent text-[#5b6577] hover:bg-[#f7f9fc]"
                  }`}
                >
                  <span className="w-4 flex-shrink-0 text-right text-[10px] font-bold text-[#a0a9b8]">{i === 0 || i === lastPage ? "" : i}</span>
                  {title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid min-w-0 content-start gap-4">
          {page === 0 && (
            <>
              <p className="m-0 text-[13px] leading-[1.7] text-[#344054]">{lesson.description}</p>
              {demos.length > 0 && onWatchDemo && (
                <div className="grid gap-2 rounded-[12px] border border-[#c7d7fe] bg-[#eef4ff] px-3.5 py-3">
                  <p className="m-0 flex items-center gap-2 text-xs font-semibold text-[#1e3a8a]">
                    <Box size={14} /> Watch it in 3D
                  </p>
                  <p className="m-0 text-[11px] leading-[1.5] text-[#1e40af]">See these steps demonstrated on a simulated PC, then try them yourself.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {demos.map((d) => (
                      <button key={d.id} type="button" className={`${secondaryButtonClass} bg-white`} onClick={() => onWatchDemo(d.id)}>
                        <MonitorPlay size={14} /> {d.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {missing.length > 0 && (
                <div className="rounded-[12px] border border-[#dbe5f5] bg-[#f5f8ff] px-3.5 py-3 text-xs leading-[1.6] text-[#1e3a8a]">
                  <p className="m-0 font-semibold">Recommended first:</p>
                  <ul className="m-0 mt-1 grid list-none gap-1 p-0">
                    {missing.map((id) => {
                      const prereq = catalog.lessons.find((l) => l.id === id);
                      return (
                        <li key={id}>
                          <button type="button" className="cursor-pointer border-none bg-transparent p-0 text-xs font-semibold text-[#1d4ed8] underline" onClick={() => onOpenLesson(id)}>
                            {prereq?.title ?? id}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {lesson.safety.length > 0 && (
                <div className="grid gap-2">
                  {lesson.safety.map((s) => (
                    <SafetyCallout key={s.text} level={s.level} text={s.text} />
                  ))}
                </div>
              )}
              <Panel title="What you will learn">
                <List items={lesson.objectives} />
              </Panel>
              {lesson.tools.length > 0 && (
                <Panel title="Tools you need" actions={<Wrench size={15} className="text-[#8b95a6]" />}>
                  <List items={lesson.tools} />
                </Panel>
              )}
            </>
          )}

          {step && (
            <Panel title={`Step ${page} of ${lesson.steps.length}: ${step.title}`}>
              <div className="grid gap-4 text-[13px] leading-[1.7] text-[#344054]">
                <MarkdownText text={step.body} />
                {step.image && <LessonImage image={step.image} />}
              </div>
            </Panel>
          )}

          {page === lastPage && (
            <>
              <Panel title="Expected results" actions={<ListChecks size={15} className="text-[#8b95a6]" />}>
                <List items={lesson.expectedResults} />
              </Panel>
              {lesson.commonMistakes.length > 0 && (
                <Panel title="Common mistakes">
                  <div className="grid gap-2.5">
                    {lesson.commonMistakes.map((m) => (
                      <div key={m.mistake} className="rounded-[12px] border border-[#eef1f5] px-3.5 py-3 text-xs leading-[1.6] text-[#344054]">
                        <p className="m-0 font-semibold text-[#b91c1c]">{m.mistake}</p>
                        <p className="m-0 mt-1">
                          <span className="font-semibold">Why it matters: </span>
                          {m.why}
                        </p>
                        <p className="m-0 mt-1">
                          <span className="font-semibold">Instead: </span>
                          {m.fix}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
              {lesson.knowledgeChecks.length > 0 && (
                <Panel title="Check your understanding" description="Answer in your head, then reveal the answer.">
                  <div className="grid gap-2">
                    {lesson.knowledgeChecks.map((k) => (
                      <KnowledgeCheck key={k.question} {...k} />
                    ))}
                  </div>
                </Panel>
              )}
              {lesson.references.length > 0 && (
                <Panel title="References">
                  <List items={lesson.references} />
                </Panel>
              )}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d1fadf] bg-[#f6fef9] px-4 py-3.5">
                <CheckCircle2 size={18} className="text-[#16a34a]" />
                <p className="m-0 flex-1 text-[13px] font-semibold text-[#14532d]">
                  {status === "completed" ? "You have completed this lesson." : "Finished reading? Mark the lesson complete."}
                </p>
                {status !== "completed" && (
                  <button type="button" className={buttonClass} onClick={() => saveProgress(lesson.id, lesson.version, page, true)}>
                    Mark complete
                  </button>
                )}
                {lesson.quizId && (
                  <button type="button" className={status === "completed" ? buttonClass : secondaryButtonClass} onClick={() => onTakeQuiz(lesson.quizId!)}>
                    Take the quiz
                  </button>
                )}
              </div>
            </>
          )}

          <ErrorNote message={data.actionError} />

          <div className="flex justify-between gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => go(page - 1)} disabled={page === 0}>
              <ArrowLeft size={14} /> Previous
            </button>
            {page < lastPage && (
              <button type="button" className={buttonClass} onClick={() => go(page + 1)}>
                {page === lesson.steps.length ? "Review" : page === 0 ? "Start" : "Next"} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
