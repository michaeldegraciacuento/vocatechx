import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { emptyAnswer, gradeQuiz, isAnswered, shuffledIndexes, type Answer, type QuizResult } from "../../content/library";
import type { Question, Quiz } from "../../content/schema";
import { ErrorNote, Panel, buttonClass, fieldClass, secondaryButtonClass } from "../network/ui";
import type { LearningData } from "./useLearning";

const optionClass = (checked: boolean, disabled: boolean) =>
  `flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-xs leading-[1.5] text-[#344054] ${
    checked ? "border-[#2563eb] bg-[#f5f8ff]" : "border-[#e3e8ef] bg-white"
  } ${disabled ? "" : "cursor-pointer hover:border-[#c7d2e1]"}`;

function QuestionInput({ q, index, answer, onChange, locked }: { q: Question; index: number; answer: Answer; onChange: (a: Answer) => void; locked: boolean }) {
  const name = `q${index}`;
  // The right-hand options of a matching question, shuffled once.
  const rightOrder = useMemo(() => (q.kind === "match" ? shuffledIndexes(q.pairs.length, `${q.prompt}:right`) : []), [q]);

  if (q.kind === "single" && answer.kind === "single") {
    return (
      <div className="grid gap-1.5" role="radiogroup">
        {q.choices.map((choice, i) => (
          <label key={i} className={optionClass(answer.choice === i, locked)}>
            <input type="radio" name={name} className="mt-0.5" checked={answer.choice === i} disabled={locked} onChange={() => onChange({ kind: "single", choice: i })} />
            {choice}
          </label>
        ))}
      </div>
    );
  }
  if (q.kind === "multi" && answer.kind === "multi") {
    const toggle = (i: number) =>
      onChange({ kind: "multi", choices: answer.choices.includes(i) ? answer.choices.filter((c) => c !== i) : [...answer.choices, i] });
    return (
      <div className="grid gap-1.5">
        {q.choices.map((choice, i) => (
          <label key={i} className={optionClass(answer.choices.includes(i), locked)}>
            <input type="checkbox" className="mt-0.5" checked={answer.choices.includes(i)} disabled={locked} onChange={() => toggle(i)} />
            {choice}
          </label>
        ))}
      </div>
    );
  }
  if (q.kind === "order" && answer.kind === "order") {
    const move = (pos: number, by: number) => {
      const order = [...answer.order];
      [order[pos], order[pos + by]] = [order[pos + by], order[pos]];
      onChange({ kind: "order", order });
    };
    return (
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {answer.order.map((item, pos) => (
          <li key={item} className="flex items-center gap-2 rounded-[10px] border border-[#e3e8ef] bg-white px-3 py-2 text-xs text-[#344054]">
            <span className="w-5 text-[11px] font-bold text-[#8b95a6]">{pos + 1}.</span>
            <span className="flex-1">{q.items[item]}</span>
            <button type="button" className={`${secondaryButtonClass} px-2 py-1`} disabled={locked || pos === 0} onClick={() => move(pos, -1)} aria-label={`Move "${q.items[item]}" up`}>
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              className={`${secondaryButtonClass} px-2 py-1`}
              disabled={locked || pos === answer.order.length - 1}
              onClick={() => move(pos, 1)}
              aria-label={`Move "${q.items[item]}" down`}
            >
              <ArrowDown size={13} />
            </button>
          </li>
        ))}
      </ol>
    );
  }
  if (q.kind === "match" && answer.kind === "match") {
    return (
      <div className="grid gap-1.5">
        {q.pairs.map((pair, i) => (
          <label key={pair.left} className="grid items-center gap-2 text-xs text-[#344054] sm:grid-cols-[160px_1fr]">
            <span className="font-semibold text-[#172033]">{pair.left}</span>
            <select
              className={fieldClass}
              value={answer.picks[i] ?? ""}
              disabled={locked}
              onChange={(e) => {
                const picks = [...answer.picks];
                picks[i] = e.target.value === "" ? null : Number(e.target.value);
                onChange({ kind: "match", picks });
              }}
            >
              <option value="">Choose…</option>
              {rightOrder.map((r) => (
                <option key={r} value={r}>
                  {q.pairs[r].right}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }
  return null;
}

function correctAnswerText(q: Question): string {
  switch (q.kind) {
    case "single":
      return q.choices[q.correct];
    case "multi":
      return q.correct.map((c) => q.choices[c]).join("; ");
    case "order":
      return q.items.map((item, i) => `${i + 1}. ${item}`).join("  ");
    case "match":
      return q.pairs.map((p) => `${p.left} → ${p.right}`).join("; ");
  }
}

/** A lesson's quiz. Every attempt is saved; the library shows the best score. */
export function QuizView({ quiz, data, onBack }: { quiz: Quiz; data: LearningData; onBack: () => void }) {
  const fresh = () => quiz.questions.map(emptyAnswer);
  const [answers, setAnswers] = useState<Answer[]>(fresh);
  const [result, setResult] = useState<QuizResult | null>(null);
  const best = data.quizzes.get(quiz.id);
  const unanswered = answers.filter((a) => !isAnswered(a)).length;

  const submit = async () => {
    const graded = gradeQuiz(quiz, answers);
    setResult(graded);
    await data.recordQuiz(quiz.id, graded.score, graded.maxScore, graded.passed);
  };

  const retry = () => {
    setAnswers(fresh());
    setResult(null);
  };

  return (
    <div className="grid gap-5">
      <div>
        <button type="button" className={`${secondaryButtonClass} mb-3`} onClick={onBack}>
          <ArrowLeft size={14} /> Back to lesson
        </button>
        <h2 className="m-0 text-xl font-bold tracking-[-0.3px] text-[#172033]">{quiz.title}</h2>
        <p className="m-0 mt-1 text-xs text-[#788397]">
          {quiz.questions.length} questions · pass mark {quiz.passPercent}%
          {best ? ` · your best: ${best.bestScore}/${best.maxScore} after ${best.attempts} ${best.attempts === 1 ? "attempt" : "attempts"}` : ""}
        </p>
      </div>

      {result && (
        <div
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 ${
            result.passed ? "border-[#d1fadf] bg-[#f6fef9] text-[#14532d]" : "border-[#fde68a] bg-[#fffbeb] text-[#78350f]"
          }`}
          role="status"
        >
          {result.passed ? <CheckCircle2 size={22} className="text-[#16a34a]" /> : <XCircle size={22} className="text-[#d97706]" />}
          <p className="m-0 flex-1 text-sm font-semibold">
            {result.score} of {result.maxScore} correct ({result.percent}%) — {result.passed ? "passed" : `you need ${quiz.passPercent}% to pass`}.
          </p>
          <button type="button" className={secondaryButtonClass} onClick={retry}>
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      )}

      {quiz.questions.map((q, i) => {
        const correct = result?.correct[i];
        return (
          <Panel key={i} title={`${i + 1}. ${q.prompt}`} description={q.kind === "multi" ? "Select all that apply." : q.kind === "order" ? "Use the arrows to put them in order." : undefined}>
            <div className="grid gap-3">
              <QuestionInput q={q} index={i} answer={answers[i]} locked={result !== null} onChange={(a) => setAnswers((all) => all.map((x, j) => (j === i ? a : x)))} />
              {result && (
                <div
                  className={`rounded-[10px] px-3.5 py-3 text-xs leading-[1.6] ${correct ? "bg-[#ecfdf3] text-[#14532d]" : "bg-[#fef2f2] text-[#7f1d1d]"}`}
                >
                  <p className="m-0 font-semibold">{correct ? "Correct." : `Not quite. Correct answer: ${correctAnswerText(q)}`}</p>
                  <p className="m-0 mt-1">{q.explanation}</p>
                </div>
              )}
            </div>
          </Panel>
        );
      })}

      <ErrorNote message={data.actionError} />
      {!result && (
        <div className="flex items-center justify-end gap-3">
          {unanswered > 0 && <span className="text-[11px] text-[#8b95a6]">{unanswered} unanswered</span>}
          <button type="button" className={buttonClass} onClick={submit} disabled={unanswered > 0}>
            Submit answers
          </button>
        </div>
      )}
    </div>
  );
}
