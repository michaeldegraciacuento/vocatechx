import { BookmarkCheck, BookOpen, CheckCircle2, GraduationCap } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { catalog } from "../content";
import { lessonStatus } from "../content/library";
import { ErrorNote, Spinner } from "./network/ui";
import { MetricCard } from "./devices/ui";
import { LessonView } from "./learning/LessonView";
import { LibraryTab } from "./learning/LibraryTab";
import { ProgressTab } from "./learning/ProgressTab";
import { QuizView } from "./learning/QuizView";
import { useLearning } from "./learning/useLearning";

// Three.js is large, so the lab loads only when its tab is opened.
const HardwareLabPage = lazy(() => import("./lab/HardwareLabPage"));

const TABS = [
  { id: "library", label: "Library" },
  { id: "progress", label: "My progress" },
  { id: "lab", label: "3D Hardware Lab" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** What is open on top of the tabs: a lesson, or a lesson's quiz. */
type View = { kind: "lesson"; id: string } | { kind: "quiz"; id: string; lessonId: string } | null;

function LearningLibraryPage() {
  const data = useLearning();
  const [tab, setTab] = useState<TabId>("library");
  // A library lesson asked for a 3D demo: the lab opens playing it. `key` remounts the lab for each request.
  const [labDemo, setLabDemo] = useState<{ id: string; key: number } | null>(null);
  const [view, setView] = useState<View>(null);
  const lessons = catalog.lessons;

  if (data.loading && data.progress.size === 0 && !data.error) return <Spinner label="Loading your progress…" />;

  const lesson = view?.kind === "lesson" ? lessons.find((l) => l.id === view.id) : undefined;
  const quiz = view?.kind === "quiz" ? catalog.quizzes.get(view.id) : undefined;

  if (lesson) {
    return (
      <LessonView
        key={lesson.id}
        lesson={lesson}
        data={data}
        onBack={() => setView(null)}
        onOpenLesson={(id) => setView({ kind: "lesson", id })}
        onTakeQuiz={(id) => setView({ kind: "quiz", id, lessonId: lesson.id })}
        onWatchDemo={(id) => {
          setView(null);
          setTab("lab");
          setLabDemo({ id, key: Date.now() });
        }}
      />
    );
  }
  if (quiz && view?.kind === "quiz") {
    return <QuizView key={quiz.id} quiz={quiz} data={data} onBack={() => setView({ kind: "lesson", id: view.lessonId })} />;
  }

  const completed = lessons.filter((l) => lessonStatus(data.progress.get(l.id)) === "completed").length;
  const passed = [...data.quizzes.values()].filter((q) => q.passed).length;
  const open = (id: string) => setView({ kind: "lesson", id });

  return (
    <div className="grid gap-6">
      <ErrorNote message={data.error} />
      {catalog.problems.length > 0 && (
        <ErrorNote message={`Some lesson files could not be loaded: ${catalog.problems.slice(0, 3).join("; ")}`} />
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard icon={<BookOpen size={17} />} label="Lessons" value={String(lessons.length)} detail="Available offline" />
        <MetricCard icon={<CheckCircle2 size={17} />} label="Completed" value={`${completed} / ${lessons.length}`} tone={completed > 0 ? "ok" : "neutral"} />
        <MetricCard icon={<GraduationCap size={17} />} label="Quizzes passed" value={`${passed} / ${catalog.quizzes.size}`} tone={passed > 0 ? "ok" : "neutral"} />
        <MetricCard icon={<BookmarkCheck size={17} />} label="Bookmarked" value={String(data.bookmarks.size)} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-[#e3e8ef]" role="tablist" aria-label="Learning Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setLabDemo(null);
            }}
            className={`-mb-px cursor-pointer border-x-0 border-t-0 border-b-2 border-solid bg-transparent px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t.id ? "border-[#2563eb] text-[#1d4ed8]" : "border-transparent text-[#5b6577] hover:text-[#172033]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "library" && <LibraryTab lessons={lessons} data={data} onOpen={open} />}
        {tab === "progress" && <ProgressTab lessons={lessons} data={data} onOpen={open} />}
        {tab === "lab" && (
          <Suspense fallback={<Spinner label="Loading the 3D Hardware Lab…" />}>
            <HardwareLabPage key={labDemo?.key ?? 0} data={data} onOpenLibraryLesson={open} autoDemo={labDemo?.id} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default LearningLibraryPage;
