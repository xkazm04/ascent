// A request result: glyph and words, no status hue. `ok` is a check; a refusal is "!".
import type { StatusKind } from "./providerStatusLine";

export function ConnectNotice({ ok, text, note }: { ok: boolean; text: string; note?: string }) {
  return (
    <div role="status" className="min-w-0">
      <p className="type-body-sm text-slate-100">
        <span aria-hidden>{ok ? "✓ " : "! "}</span>
        {text}
      </p>
      {note ? <p className="mt-1 type-body-sm text-slate-400">{note}</p> : null}
    </div>
  );
}

export function StatusSentence({ line }: { line: { text: string; kind: StatusKind } | null }) {
  if (!line) return null;
  if (line.kind === "problem") return <ConnectNotice ok={false} text={line.text} />;
  return <p className="type-body-sm text-slate-400">{line.text}</p>;
}
