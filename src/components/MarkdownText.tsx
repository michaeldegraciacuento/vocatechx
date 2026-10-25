import type { ReactNode } from "react";

/**
 * Renders the small Markdown subset Ralp and the lessons use (paragraphs,
 * headings, lists, code blocks, simple tables, **bold**, `code`) as React elements. Never uses innerHTML, so
 * model output cannot inject markup.
 */
export function MarkdownText({ text }: { text: string }) {
  return <div className="grid gap-2.5">{renderBlocks(text)}</div>;
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold text-[#172033]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-[#eef1f5] px-1 py-0.5 font-mono text-[0.92em] text-[#1e3a8a]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

type ListBlock = { ordered: boolean; items: string[] };

function renderBlocks(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: ListBlock | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length} className="m-0">{renderInline(paragraph.join(" "))}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i} className="pl-1">{renderInline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="m-0 grid list-decimal gap-1.5 pl-5">{items}</ol>
      ) : (
        <ul key={blocks.length} className="m-0 grid list-disc gap-1.5 pl-5">{items}</ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push(
        <pre key={blocks.length} className="m-0 overflow-x-auto rounded-[9px] bg-[#101827] px-3.5 py-3 font-mono text-[12px] leading-[1.6] text-[#dbe7ff]">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // A table: consecutive lines starting with "|"; the "|---|" row is skipped.
    if (trimmed.startsWith("|")) {
      flushParagraph();
      flushList();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      i--;
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            {head && (
              <thead>
                <tr>
                  {head.map((c, j) => (
                    <th key={j} className="border-b border-[#dce2eb] px-2.5 py-1.5 font-semibold text-[#172033]">{renderInline(c)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j} className="border-b border-[#eef1f5] px-2.5 py-1.5">{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);

    if (!trimmed) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(<p key={blocks.length} className="m-0 mt-1 font-semibold text-[#172033]">{renderInline(heading[1])}</p>);
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((numbered ?? bullet)![1]);
    } else if (list && /^\s{2,}/.test(line)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${trimmed}`;
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
