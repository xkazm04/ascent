"use client";

// Co-located primitives for the Claude Code connect surface: a copy-to-clipboard button and the
// labelled read-only field that wraps it. Extracted from ClaudeCodeSetup.tsx so that file stays an
// orchestrator (AGENTS.md 300-LOC rule) — pure relocation, behavior unchanged.

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="focus-ring shrink-0 rounded border border-divider px-2 py-1 font-mono text-xs text-slate-400 transition hover:border-accent hover:text-white"
    >
      {/* aria-live so the Copy→Copied transition is announced to screen-reader users. */}
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function Field({
  label,
  value,
  copyText,
  mono = true,
  children,
}: {
  label: string;
  value: string;
  /**
   * What the Copy button puts on the clipboard, when that differs from what is displayed. Used by the
   * masked ingest token: the DOM shows bullets, the clipboard gets the working credential. Defaults
   * to `value` so every other field copies exactly what it shows.
   */
  copyText?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-divider bg-surface-strong/60 px-2.5 py-1.5">
        <code className={`flex-1 truncate text-slate-200 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</code>
        {children}
        <CopyButton text={copyText ?? value} />
      </div>
    </div>
  );
}
