import { z } from "zod";

// Lessons and quizzes are JSON files in this folder, bundled with the app so
// the library works offline. Every file is checked against these schemas by
// the content tests (part of `npm run build`), and again when the app loads.
// Long text fields are Markdown, rendered by components/MarkdownText.

/** Lowercase slugs, e.g. `esd-safety-basics`. The file name must match. */
export const idSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, digits and dashes");

export const CATEGORY_IDS = [
  "hardware-fundamentals",
  "pc-troubleshooting",
  "assembly-disassembly",
  "windows-maintenance",
  "networking",
  "printers-peripherals",
  "electrical-safety",
  "preventive-maintenance",
  "tools-diagnostics",
  "practical-assessment",
] as const;

const text = z.string().trim().min(1);

const imageSchema = z.strictObject({
  /** A file in src/content/assets. */
  src: z.string().regex(/^[a-z0-9-]+\.(svg|png|jpg|webp)$/),
  alt: text,
  caption: text.optional(),
});

export const lessonSchema = z.strictObject({
  id: idSchema,
  /** Bump when the content changes meaningfully. */
  version: z.number().int().min(1),
  title: text.max(90),
  description: text.max(240),
  category: z.enum(CATEGORY_IDS),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  durationMin: z.number().int().min(1).max(240),
  objectives: z.array(text).min(1),
  prerequisites: z.array(idSchema),
  tools: z.array(text),
  safety: z.array(z.strictObject({ level: z.enum(["caution", "warning", "danger"]), text })),
  steps: z
    .array(
      z.strictObject({
        title: text.max(90),
        /** Markdown. */
        body: text,
        image: imageSchema.optional(),
      }),
    )
    .min(1),
  expectedResults: z.array(text).min(1),
  commonMistakes: z.array(z.strictObject({ mistake: text, why: text, fix: text })),
  /** Short self-check questions shown at the end of the lesson. */
  knowledgeChecks: z.array(z.strictObject({ question: text, answer: text })),
  quizId: idSchema.optional(),
  references: z.array(text),
  /** False until an instructor has checked the content. Shown as "Draft". */
  reviewed: z.boolean(),
  reviewNote: text.optional(),
});

const explanation = text;

const questionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("single"),
    prompt: text,
    choices: z.array(text).min(2),
    correct: z.number().int().min(0),
    explanation,
  }),
  z.strictObject({
    kind: z.literal("multi"),
    prompt: text,
    choices: z.array(text).min(2),
    correct: z.array(z.number().int().min(0)).min(1),
    explanation,
  }),
  z.strictObject({
    kind: z.literal("order"),
    prompt: text,
    /** In the correct order; shown shuffled. */
    items: z.array(text).min(3),
    explanation,
  }),
  z.strictObject({
    kind: z.literal("match"),
    prompt: text,
    pairs: z.array(z.strictObject({ left: text, right: text })).min(2),
    explanation,
  }),
]);

export const quizSchema = z.strictObject({
  id: idSchema,
  lessonId: idSchema,
  title: text,
  passPercent: z.number().int().min(1).max(100),
  questions: z.array(questionSchema).min(1),
});

export type CategoryId = (typeof CATEGORY_IDS)[number];
export type Lesson = z.infer<typeof lessonSchema>;
export type LessonImage = z.infer<typeof imageSchema>;
export type Quiz = z.infer<typeof quizSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Difficulty = Lesson["difficulty"];
