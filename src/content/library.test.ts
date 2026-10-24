import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import {
  EMPTY_FILTER,
  emptyAnswer,
  filterLessons,
  gradeQuiz,
  isCorrect,
  lessonStatus,
  missingPrerequisites,
  shuffledIndexes,
  type Answer,
  type ProgressRecord,
} from "./library";
import type { Question, Quiz } from "./schema";

const none = new Set<string>();
const noProgress = new Map<string, ProgressRecord>();
const done = (lessonId: string): ProgressRecord => ({ lessonId, lessonVersion: 1, lastStep: 0, startedAt: 50, completedAt: 100 });

describe("lesson search and filters", () => {
  const lessons = catalog.lessons;

  it("finds lessons by words anywhere in them, ignoring case", () => {
    expect(filterLessons(lessons, { ...EMPTY_FILTER, query: "WRIST strap" }, none, noProgress).map((l) => l.id)).toContain(
      "esd-safety-basics",
    );
    expect(filterLessons(lessons, { ...EMPTY_FILTER, query: "dual-channel" }, none, noProgress).map((l) => l.id)).toEqual([
      "ram-remove-install",
    ]);
    expect(filterLessons(lessons, { ...EMPTY_FILTER, query: "zzzz" }, none, noProgress)).toEqual([]);
  });

  it("filters by category, difficulty, bookmarks and status", () => {
    const byCategory = filterLessons(lessons, { ...EMPTY_FILTER, category: "electrical-safety" }, none, noProgress);
    expect(byCategory.every((l) => l.category === "electrical-safety")).toBe(true);

    const bookmarked = filterLessons(lessons, { ...EMPTY_FILTER, bookmarkedOnly: true }, new Set(["ram-remove-install"]), noProgress);
    expect(bookmarked.map((l) => l.id)).toEqual(["ram-remove-install"]);

    const progress = new Map([["esd-safety-basics", done("esd-safety-basics")]]);
    const completed = filterLessons(lessons, { ...EMPTY_FILTER, status: "completed" }, none, progress);
    expect(completed.map((l) => l.id)).toEqual(["esd-safety-basics"]);
  });

  it("reports unfinished prerequisites", () => {
    const ram = lessons.find((l) => l.id === "ram-remove-install")!;
    expect(missingPrerequisites(ram, noProgress)).toEqual(["esd-safety-basics", "pc-major-components"]);
    expect(missingPrerequisites(ram, new Map([["esd-safety-basics", done("esd-safety-basics")]]))).toEqual(["pc-major-components"]);
  });

  it("derives status from progress", () => {
    expect(lessonStatus(undefined)).toBe("not_started");
    expect(lessonStatus({ ...done("x"), completedAt: null })).toBe("in_progress");
    expect(lessonStatus(done("x"))).toBe("completed");
  });
});

describe("quiz grading", () => {
  const single: Question = { kind: "single", prompt: "p", choices: ["a", "b"], correct: 1, explanation: "e" };
  const multi: Question = { kind: "multi", prompt: "p", choices: ["a", "b", "c"], correct: [0, 2], explanation: "e" };
  const order: Question = { kind: "order", prompt: "p", items: ["a", "b", "c"], explanation: "e" };
  const match: Question = { kind: "match", prompt: "p", pairs: [{ left: "a", right: "1" }, { left: "b", right: "2" }], explanation: "e" };

  it("needs an exact answer for each kind", () => {
    expect(isCorrect(single, { kind: "single", choice: 1 })).toBe(true);
    expect(isCorrect(single, { kind: "single", choice: 0 })).toBe(false);
    expect(isCorrect(multi, { kind: "multi", choices: [2, 0] })).toBe(true);
    expect(isCorrect(multi, { kind: "multi", choices: [0] })).toBe(false);
    expect(isCorrect(multi, { kind: "multi", choices: [0, 1, 2] })).toBe(false);
    expect(isCorrect(order, { kind: "order", order: [0, 1, 2] })).toBe(true);
    expect(isCorrect(order, { kind: "order", order: [1, 0, 2] })).toBe(false);
    expect(isCorrect(match, { kind: "match", picks: [0, 1] })).toBe(true);
    expect(isCorrect(match, { kind: "match", picks: [1, 0] })).toBe(false);
  });

  it("never starts an ordering question already solved", () => {
    for (const seed of ["a", "b", "c", "order the steps"]) {
      const shuffled = shuffledIndexes(5, seed);
      expect([...shuffled].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(shuffled).not.toEqual([0, 1, 2, 3, 4]);
    }
    expect(isCorrect(order, emptyAnswer(order))).toBe(false);
  });

  it("scores and applies the pass mark", () => {
    const quiz: Quiz = { id: "q", lessonId: "l", title: "t", passPercent: 75, questions: [single, multi, order, match] };
    const right: Answer[] = [
      { kind: "single", choice: 1 },
      { kind: "multi", choices: [0, 2] },
      { kind: "order", order: [0, 1, 2] },
      { kind: "match", picks: [0, 1] },
    ];
    expect(gradeQuiz(quiz, right)).toMatchObject({ score: 4, maxScore: 4, percent: 100, passed: true });
    const oneWrong = [{ kind: "single", choice: 0 } as Answer, ...right.slice(1)];
    expect(gradeQuiz(quiz, oneWrong)).toMatchObject({ score: 3, percent: 75, passed: true });
    expect(gradeQuiz(quiz, oneWrong.slice(0, 2))).toMatchObject({ score: 1, passed: false });
  });

  it("every bundled quiz can be passed with its own correct answers", () => {
    for (const quiz of catalog.quizzes.values()) {
      const answers: Answer[] = quiz.questions.map((q) => {
        switch (q.kind) {
          case "single":
            return { kind: "single", choice: q.correct };
          case "multi":
            return { kind: "multi", choices: q.correct };
          case "order":
            return { kind: "order", order: q.items.map((_, i) => i) };
          case "match":
            return { kind: "match", picks: q.pairs.map((_, i) => i) };
        }
      });
      expect(gradeQuiz(quiz, answers).passed).toBe(true);
    }
  });
});
