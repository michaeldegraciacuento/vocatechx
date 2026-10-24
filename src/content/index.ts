import type { z } from "zod";
import { lessonSchema, quizSchema, type Lesson, type Quiz } from "./schema";

export type Catalog = {
  lessons: Lesson[];
  quizzes: Map<string, Quiz>;
  /** URLs of the files in ./assets, by file name. */
  assets: Map<string, string>;
  /** Human-readable content errors. Empty when everything is valid. */
  problems: string[];
};

type Files = Record<string, unknown>;

const fileId = (path: string) => path.split("/").pop()!.replace(/\.json$/, "");

/** Validates every lesson and quiz, and the links between them. Invalid files
 *  are left out and reported, so one bad file never hides the whole library. */
export function buildCatalog(lessonFiles: Files, quizFiles: Files, assetFiles: Record<string, string>): Catalog {
  const problems: string[] = [];
  const assets = new Map(Object.entries(assetFiles).map(([path, url]) => [path.split("/").pop()!, url]));

  const parse = <T extends { id: string }>(files: Files, schema: z.ZodType<T>) => {
    const items: T[] = [];
    for (const [path, json] of Object.entries(files)) {
      const result = schema.safeParse(json);
      if (!result.success) {
        for (const issue of result.error.issues) {
          problems.push(`${path}: ${issue.path.join(".") || "(file)"}: ${issue.message}`);
        }
        continue;
      }
      if (result.data.id !== fileId(path)) {
        problems.push(`${path}: id "${result.data.id}" must match the file name`);
        continue;
      }
      if (items.some((i) => i.id === result.data.id)) {
        problems.push(`${path}: duplicate id "${result.data.id}"`);
        continue;
      }
      items.push(result.data);
    }
    return items;
  };

  const lessons = parse<Lesson>(lessonFiles, lessonSchema);
  const quizzes = new Map(parse<Quiz>(quizFiles, quizSchema).map((q) => [q.id, q]));
  const lessonIds = new Set(lessons.map((l) => l.id));

  for (const lesson of lessons) {
    for (const p of lesson.prerequisites) {
      if (!lessonIds.has(p)) problems.push(`lesson ${lesson.id}: prerequisite "${p}" does not exist`);
    }
    if (lesson.quizId && !quizzes.has(lesson.quizId)) problems.push(`lesson ${lesson.id}: quiz "${lesson.quizId}" does not exist`);
    for (const step of lesson.steps) {
      if (step.image && !assets.has(step.image.src)) problems.push(`lesson ${lesson.id}: image "${step.image.src}" is not in src/content/assets`);
    }
  }
  for (const quiz of quizzes.values()) {
    const owner = lessons.find((l) => l.id === quiz.lessonId);
    if (!owner) problems.push(`quiz ${quiz.id}: lesson "${quiz.lessonId}" does not exist`);
    else if (owner.quizId !== quiz.id) problems.push(`quiz ${quiz.id}: lesson "${quiz.lessonId}" does not link back to it`);
    quiz.questions.forEach((q, i) => {
      const indexes = q.kind === "single" ? [q.correct] : q.kind === "multi" ? q.correct : [];
      if ((q.kind === "single" || q.kind === "multi") && indexes.some((c) => c >= q.choices.length)) {
        problems.push(`quiz ${quiz.id}: question ${i + 1} marks a choice that does not exist`);
      }
    });
  }

  // Prerequisite loops would make lessons impossible to start "in order".
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      problems.push(`prerequisite loop: ${[...path, id].join(" → ")}`);
      return;
    }
    visiting.add(id);
    for (const p of byId.get(id)?.prerequisites ?? []) visit(p, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  lessons.forEach((l) => visit(l.id, []));

  return { lessons, quizzes, assets, problems };
}

export const catalog: Catalog = buildCatalog(
  import.meta.glob("./lessons/*.json", { eager: true, import: "default" }),
  import.meta.glob("./quizzes/*.json", { eager: true, import: "default" }),
  import.meta.glob("./assets/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>,
);
