import type { ReactNode } from "react";

/** A status sentence: glyph plus words. The number or the sentence stays paper, never a status hue. */
export function MemoryNote({ kind, children }: { kind: "risk" | "good"; children: ReactNode }) {
  return (
    <p className="mt-2 type-body-sm text-slate-200">
      <span aria-hidden>{kind === "risk" ? "! " : "✓ "}</span>
      {children}
    </p>
  );
}
