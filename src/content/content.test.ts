import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./categories";
import { buildCatalog, catalog } from "./index";
import { CATEGORY_IDS } from "./schema";

// These run as part of `npm run build`, so a broken lesson file stops the build.

describe("bundled content", () => {
  it("has no problems", () => {
    expect(catalog.problems).toEqual([]);
  });

  it("loads every lesson and quiz", () => {
    expect(catalog.lessons.length).toBeGreaterThanOrEqual(3);
    for (const lesson of catalog.lessons) {
      if (lesson.quizId) expect(catalog.quizzes.has(lesson.quizId)).toBe(true);
    }
  });

  it("has at least one lesson, with a quiz, in every category", () => {
    for (const id of CATEGORY_IDS) {
      const inCategory = catalog.lessons.filter((l) => l.category === id);
      expect(inCategory.length, id).toBeGreaterThan(0);
      expect(inCategory.every((l) => l.quizId), id).toBe(true);
    }
  });

  it("lists every category exactly once", () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([...CATEGORY_IDS].sort());
  });

  it("puts electrical safety first in every hands-on lesson's prerequisites", () => {
    const handsOn = catalog.lessons.filter((l) => l.category === "assembly-disassembly");
    for (const lesson of handsOn) expect(lesson.prerequisites).toContain("esd-safety-basics");
  });
});

const lesson = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  title: "T",
  description: "D",
  category: "hardware-fundamentals",
  difficulty: "beginner",
  durationMin: 5,
  objectives: ["O"],
  prerequisites: [],
  tools: [],
  safety: [],
  steps: [{ title: "S", body: "B" }],
  expectedResults: ["E"],
  commonMistakes: [],
  knowledgeChecks: [],
  references: [],
  reviewed: false,
  ...extra,
});

describe("content validation", () => {
  const build = (lessons: Record<string, unknown>, quizzes: Record<string, unknown> = {}, assets: Record<string, string> = {}) =>
    buildCatalog(lessons, quizzes, assets).problems;

  it("accepts a valid lesson", () => {
    expect(build({ "./lessons/a.json": lesson("a") })).toEqual([]);
  });

  it("reports schema errors, typos and wrong file names", () => {
    expect(build({ "./lessons/a.json": lesson("a", { difficulty: "expert" }) })[0]).toContain("difficulty");
    expect(build({ "./lessons/a.json": lesson("a", { titel: "typo" }) })[0]).toContain("titel");
    expect(build({ "./lessons/a.json": lesson("b") })[0]).toContain("file name");
  });

  it("reports broken links between lessons, quizzes and images", () => {
    expect(build({ "./lessons/a.json": lesson("a", { prerequisites: ["missing"] }) })[0]).toContain("prerequisite");
    expect(build({ "./lessons/a.json": lesson("a", { quizId: "nope" }) })[0]).toContain("quiz");
    const withImage = lesson("a", { steps: [{ title: "S", body: "B", image: { src: "x.svg", alt: "x" } }] });
    expect(build({ "./lessons/a.json": withImage })[0]).toContain("x.svg");
    expect(build({ "./lessons/a.json": withImage }, {}, { "./assets/x.svg": "/x.svg" })).toEqual([]);
  });

  it("reports prerequisite loops", () => {
    const problems = build({
      "./lessons/a.json": lesson("a", { prerequisites: ["b"] }),
      "./lessons/b.json": lesson("b", { prerequisites: ["a"] }),
    });
    expect(problems.some((p) => p.includes("loop"))).toBe(true);
  });

  it("reports quiz answers that point at missing choices", () => {
    const problems = build(
      { "./lessons/a.json": lesson("a", { quizId: "a-quiz" }) },
      {
        "./quizzes/a-quiz.json": {
          id: "a-quiz",
          lessonId: "a",
          title: "Q",
          passPercent: 80,
          questions: [{ kind: "single", prompt: "P", choices: ["x", "y"], correct: 5, explanation: "E" }],
        },
      },
    );
    expect(problems[0]).toContain("choice");
  });
});
