// Her prose, rendered by the report's MarkdownLite — the repo's ONE renderer for model-written text,
// and its security posture is the reason: four inert constructs (paragraphs, `- ` bullets, **bold**,
// `code`), no href, no src, no dangerouslySetInnerHTML. Model output is untrusted; a real markdown
// engine admits links, images and raw HTML, and every one of those is an injection surface for a
// memory row or a repository that wants the drawer to say something.
//
// The ONE thing this sibling adds is fence-skipping. `parseAthenaBlocks` already lifts every
// `athena:table` / `athena:chart` fence out before the prose is persisted, so a well-formed turn
// arrives here with none. This is the belt for the paths that bypass that parse — an older row, a
// hand-written degrade line, and the `delta` stream the event union has room for, which will deliver
// raw completion text mid-fence by construction. A half-written fence rendered as prose is a
// paragraph of raw JSON shown to the operator, which is exactly the failure blocks.ts exists to stop.

import { MarkdownLite } from "@/components/report/MarkdownLite";

/** Every CLOSED fence removed, then everything from an UNCLOSED fence to the end. Pure. */
export function stripFences(text: string): string {
  return text
    .replace(/^[ \t]*```[^\n]*\r?\n[\s\S]*?^[ \t]*```[ \t]*$/gm, "")
    .replace(/^[ \t]*```[\s\S]*$/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function AthenaProse({ text, className = "" }: { text: string; className?: string }) {
  const clean = stripFences(text);
  if (!clean) return null;
  return <MarkdownLite text={clean} className={`type-body-sm text-slate-300 ${className}`} />;
}
