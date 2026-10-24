import { AlertOctagon, AlertTriangle, Bookmark, BookmarkCheck, Info } from "lucide-react";
import type { LessonStatus } from "../../content/library";
import type { Difficulty, Lesson, LessonImage as LessonImageData } from "../../content/schema";
import { catalog } from "../../content";
import { Badge } from "../network/ui";

// Shared building blocks (Panel, Badge, buttons…) come from "../network/ui";
// this file adds only the Learning Library specifics.

const DIFFICULTY: Record<Difficulty, { label: string; tone: "ok" | "info" | "warn" }> = {
  beginner: { label: "Beginner", tone: "ok" },
  intermediate: { label: "Intermediate", tone: "info" },
  advanced: { label: "Advanced", tone: "warn" },
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const d = DIFFICULTY[difficulty];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}

export function StatusBadge({ status }: { status: LessonStatus }) {
  if (status === "completed") return <Badge tone="ok">Completed</Badge>;
  if (status === "in_progress") return <Badge tone="info">In progress</Badge>;
  return null;
}

/** Shown on every lesson an instructor has not reviewed yet. */
export function DraftBadge({ lesson }: { lesson: Lesson }) {
  if (lesson.reviewed) return null;
  return (
    <span title={lesson.reviewNote ?? "This lesson has not been reviewed by an instructor yet."}>
      <Badge tone="neutral">Draft</Badge>
    </span>
  );
}

const SAFETY = {
  danger: { icon: AlertOctagon, label: "Danger", className: "border-[#fecaca] bg-[#fef2f2] text-[#7f1d1d]", iconClass: "text-[#dc2626]" },
  warning: { icon: AlertTriangle, label: "Warning", className: "border-[#fde68a] bg-[#fffbeb] text-[#78350f]", iconClass: "text-[#d97706]" },
  caution: { icon: Info, label: "Caution", className: "border-[#dbe5f5] bg-[#f5f8ff] text-[#1e3a8a]", iconClass: "text-[#2563eb]" },
} as const;

export function SafetyCallout({ level, text }: { level: keyof typeof SAFETY; text: string }) {
  const s = SAFETY[level];
  const Icon = s.icon;
  return (
    <div className={`flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-xs leading-[1.6] ${s.className}`} role="note">
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${s.iconClass}`} />
      <p className="m-0">
        <span className="font-bold">{s.label}: </span>
        {text}
      </p>
    </div>
  );
}

export function LessonImage({ image }: { image: LessonImageData }) {
  const src = catalog.assets.get(image.src);
  if (!src) return null;
  return (
    <figure className="m-0 grid gap-2">
      <img src={src} alt={image.alt} className="w-full rounded-[12px] border border-[#e3e8ef]" draggable={false} />
      {image.caption && <figcaption className="text-[11px] leading-[1.5] text-[#788397]">{image.caption}</figcaption>}
    </figure>
  );
}

export function BookmarkButton({ bookmarked, onToggle, disabled }: { bookmarked: boolean; onToggle: () => void; disabled?: boolean }) {
  const Icon = bookmarked ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
      aria-pressed={bookmarked}
      title={bookmarked ? "Remove bookmark" : "Bookmark this lesson"}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark this lesson"}
      className={`grid h-8 w-8 flex-shrink-0 cursor-pointer place-items-center rounded-lg border bg-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        bookmarked ? "border-[#bfd3fb] text-[#2563eb]" : "border-[#e3e8ef] text-[#8b95a6] hover:text-[#172033]"
      }`}
    >
      <Icon size={15} />
    </button>
  );
}
