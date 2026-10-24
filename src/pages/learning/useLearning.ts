import { useCallback, useMemo } from "react";
import type { ProgressRecord } from "../../content/library";
import { api, type LabBest, type QuizBest } from "../../lib/api";
import { useBackendAction } from "../../lib/useBackendAction";
import { useBackendData } from "../../lib/useBackendData";

export type LearningData = {
  loading: boolean;
  error: string | null;
  progress: ReadonlyMap<string, ProgressRecord>;
  bookmarks: ReadonlySet<string>;
  quizzes: ReadonlyMap<string, QuizBest>;
  labs: ReadonlyMap<string, LabBest>;
  toggleBookmark: (lessonId: string) => void;
  /** Saves how far the user got, then refreshes. Completion is permanent. */
  saveProgress: (lessonId: string, version: number, step: number, completed: boolean) => Promise<void>;
  recordQuiz: (quizId: string, score: number, maxScore: number, passed: boolean) => Promise<void>;
  recordLab: (labId: string, mistakes: number, hints: number, durationS: number) => Promise<void>;
  actionError: string | null;
};

/** The signed-in account's learning progress, bookmarks and quiz scores. */
export function useLearning(): LearningData {
  const state = useBackendData(api.learnState);
  const bookmark = useBackendAction(api.learnSetBookmark);
  const progressAction = useBackendAction(api.learnUpdateProgress);
  const quizAction = useBackendAction(api.learnRecordQuiz);
  const labAction = useBackendAction(api.learnRecordLab);
  const reload = state.reload;

  const progress = useMemo(() => new Map((state.data?.progress ?? []).map((p) => [p.lessonId, p])), [state.data]);
  const bookmarks = useMemo(() => new Set(state.data?.bookmarks ?? []), [state.data]);
  const quizzes = useMemo(() => new Map((state.data?.quizzes ?? []).map((q) => [q.quizId, q])), [state.data]);
  const labs = useMemo(() => new Map((state.data?.labs ?? []).map((l) => [l.labId, l])), [state.data]);

  const setBookmark = bookmark.run;
  const toggleBookmark = useCallback(
    (lessonId: string) => {
      setBookmark(lessonId, !bookmarks.has(lessonId)).then(reload);
    },
    [bookmarks, setBookmark, reload],
  );

  const runProgress = progressAction.run;
  const saveProgress = useCallback(
    async (lessonId: string, version: number, step: number, completed: boolean) => {
      await runProgress(lessonId, version, step, completed);
      reload();
    },
    [runProgress, reload],
  );

  const runQuiz = quizAction.run;
  const recordQuiz = useCallback(
    async (quizId: string, score: number, maxScore: number, passed: boolean) => {
      await runQuiz(quizId, score, maxScore, passed);
      reload();
    },
    [runQuiz, reload],
  );

  const runLab = labAction.run;
  const recordLab = useCallback(
    async (labId: string, mistakes: number, hints: number, durationS: number) => {
      await runLab(labId, mistakes, hints, durationS);
      reload();
    },
    [runLab, reload],
  );

  return {
    loading: state.loading,
    error: state.error,
    progress,
    bookmarks,
    quizzes,
    labs,
    toggleBookmark,
    saveProgress,
    recordQuiz,
    recordLab,
    actionError: bookmark.error ?? progressAction.error ?? quizAction.error ?? labAction.error,
  };
}
