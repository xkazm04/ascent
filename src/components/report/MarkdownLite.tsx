// A deliberately tiny renderer for model-written prose — the four constructs the scan prompt asks
// for and NOTHING else: paragraphs (blank-line separated), `- ` bullet lists, **bold**, and
// `inline code`. Not a markdown engine, and it never renders raw HTML.
//
// WHY THIS EXISTS. A dimension assessment used to arrive as one paragraph and render as one <p>:
// a 900-character wall in which the finding, the evidence, and the caveat all sat at the same
// weight, unreadable in the heatmap drill-in that shows it. The prompt now asks the model to
// STRUCTURE the summary (short paragraphs, bullets for parallel points, bold for the one thing to
// remember, backticks for files and commands). This component makes that structure visible; without
// it the model's markers would print as literal asterisks — worse than the wall.
//
// WHY SO SMALL. Everything rendered here is model output describing repository content, and
// repository content is UNTRUSTED. A real markdown renderer admits links, images, and HTML — every
// one an injection surface for a repo that wants the report to say something. Four inert constructs
// keep the whole thing plain text with formatting; there is no href, no src, no dangerouslySetInnerHTML.
//
// Text with no markers at all is a single paragraph, so every scan persisted before the prompt
// change renders exactly as it did.

import type { ReactNode } from "react";

/** One paragraph or one bullet list. */
type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** Split prose into paragraph / bullet-list blocks. Pure. Exported for the tests. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "ul", items: list });
    list = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1]!);
    } else if (line === "") {
      flushPara();
      flushList();
    } else if (list.length) {
      // A wrapped continuation of the previous bullet.
      list[list.length - 1] += ` ${line}`;
    } else {
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Render **bold** and `code` inside one line. Everything else is a text node. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Alternation keeps ONE pass: bold, then code. Unclosed markers fall through as literal text.
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-white">{m[1]}</strong>);
    else out.push(<code key={k++} className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[0.9em] text-slate-200">{m[2]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`space-y-2.5 ${className}`}>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="leading-relaxed">
            {renderInline(b.text)}
          </p>
        ) : (
          <ul key={i} className="space-y-1 pl-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2 leading-relaxed">
                <span aria-hidden className="select-none text-slate-600">·</span>
                <span>{renderInline(it)}</span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
