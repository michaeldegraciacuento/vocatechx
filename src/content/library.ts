import type { CategoryId, Difficulty, Lesson, Question, Quiz } from "./schema";

// Pure helpers behind the Learning Library UI, kept free of React and Tauri so
// they can be unit-tested.

export type LessonStatus = "not_started" | "in_progress" | "completed";

export type ProgressRecord = { lessonId: string; lessonVersion: number; lastStep: number; startedAt: number; completedAt: number | null };

export function lessonStatus(record: ProgressRecord | undefined): LessonStatus {
  if (!record) return "not_started";
  return record.completedAt !== null ? "completed" : "in_progress";
}

export type LessonFilter = {
  query: string;
  category: CategoryId | null;
  difficulty: Difficulty | null;
  bookmarkedOnly: boolean;
  status: LessonStatus | null;
};

export const EMPTY_FILTER: LessonFilter = { query: "", category: null, difficulty: null, bookmarkedOnly: false, status: null };

/** Lowercase text without accents, for forgiving search. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function searchableText(lesson: Lesson): string {
  return fold(
    [
      lesson.title,
      lesson.description,
      ...lesson.objectives,
      ...lesson.tools,
      ...lesson.steps.map((s) => `${s.title} ${s.body}`),
      ...lesson.commonMistakes.map((m) => m.mistake),
    ].join(" "),
  );
}

/** Every word of the query must appear somewhere in the lesson. Title matches rank first. */
export function filterLessons(
  lessons: Lesson[],
  filter: LessonFilter,
  bookmarks: ReadonlySet<string>,
  progress: ReadonlyMap<string, ProgressRecord>,
): Lesson[] {
  const words = fold(filter.query).split(/\s+/).filter(Boolean);
  const matches = lessons.filter((l) => {
    if (filter.category && l.category !== filter.category) return false;
    if (filter.difficulty && l.difficulty !== filter.difficulty) return false;
    if (filter.bookmarkedOnly && !bookmarks.has(l.id)) return false;
    if (filter.status && lessonStatus(progress.get(l.id)) !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = searchableText(l);
    return words.every((w) => haystack.includes(w));
  });
  if (words.length === 0) return matches;
  const titleHits = (l: Lesson) => words.filter((w) => fold(l.title).includes(w)).length;
  return [...matches].sort((a, b) => titleHits(b) - titleHits(a));
}

/** Prerequisites the user has not completed yet. */
export function missingPrerequisites(lesson: Lesson, progress: ReadonlyMap<string, ProgressRecord>): string[] {
  return lesson.prerequisites.filter((id) => lessonStatus(progress.get(id)) !== "completed");
}

// ---------------------------------------------------------------------------
// Quizzes

/** What the learner answered, per question kind. */
export type Answer =
  | { kind: "single"; choice: number | null }
  | { kind: "multi"; choices: number[] }
  | { kind: "order"; order: number[] } // indexes into the question's items
  | { kind: "match"; picks: (number | null)[] }; // for each left item, an index into the pairs' right side

export function emptyAnswer(q: Question): Answer {
  switch (q.kind) {
    case "single":
      return { kind: "single", choice: null };
    case "multi":
      return { kind: "multi", choices: [] };
    case "order":
      return { kind: "order", order: shuffledIndexes(q.items.length, q.prompt) };
    case "match":
      return { kind: "match", picks: q.pairs.map(() => null) };
  }
}

/** A stable shuffle (seeded by the prompt) that never starts in the correct order. */
export function shuffledIndexes(length: number, seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 2 ** 32);
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.every((v, i) => v === i) && length > 1) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

export function isAnswered(answer: Answer): boolean {
  switch (answer.kind) {
    case "single":
      return answer.choice !== null;
    case "multi":
      return answer.choices.length > 0;
    case "order":
      return true;
    case "match":
      return answer.picks.every((p) => p !== null);
  }
}

/** One point per question, only when it is entirely right. */
export function isCorrect(q: Question, answer: Answer): boolean {
  if (q.kind !== answer.kind) return false;
  switch (q.kind) {
    case "single":
      return answer.kind === "single" && answer.choice === q.correct;
    case "multi": {
      if (answer.kind !== "multi") return false;
      const want = [...new Set(q.correct)].sort();
      const got = [...new Set(answer.choices)].sort();
      return want.length === got.length && want.every((v, i) => v === got[i]);
    }
    case "order":
      return answer.kind === "order" && answer.order.length === q.items.length && answer.order.every((v, i) => v === i);
    case "match":
      return answer.kind === "match" && answer.picks.length === q.pairs.length && answer.picks.every((p, i) => p === i);
  }
}

export type QuizResult = { score: number; maxScore: number; percent: number; passed: boolean; correct: boolean[] };

export function gradeQuiz(quiz: Quiz, answers: Answer[]): QuizResult {
  const correct = quiz.questions.map((q, i) => answers[i] !== undefined && isCorrect(q, answers[i]));
  const score = correct.filter(Boolean).length;
  const maxScore = quiz.questions.length;
  const percent = Math.round((score / maxScore) * 100);
  return { score, maxScore, percent, passed: percent >= quiz.passPercent, correct };
}
