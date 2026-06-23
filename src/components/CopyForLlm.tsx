"use client";

// Reusable "copy a markdown payload to the clipboard, to paste into Claude Code / an LLM" button.
// This is the baseline of the LLM-consumption direction: every Ascent surface that produces results
// (briefings, reports, gap analyses, security findings) can hand a dev a ready-to-paste brief. Uses
// the async Clipboard API with a legacy execCommand fallback for non-secure contexts.

import { useState } from "react";
import { attemptCopy, nextCopyState } from "./copy-for-llm.logic";

export function CopyForLlm({
  text,
  label = "Copy for LLM",
  className = "",
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  /** Fired once when a copy succeeds — e.g. to count a "use" (Org Skills Library, §8.7). Best-effort. */
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    const ok = await attemptCopy(text, navigator.clipboard, legacyCopy);
    const { next, resetMs } = nextCopyState(ok);
    if (next === "copied") {
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), resetMs);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), resetMs);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a markdown briefing to paste into Claude Code or another LLM"
      aria-live="polite"
      className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition ${
        copied
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
          : failed
            ? "border-danger/50 text-danger"
            : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
      } ${className}`}
    >
      <span aria-hidden>{copied ? "✓" : failed ? "⚠" : "⧉"}</span>
      {copied ? "Copied" : failed ? "Copy failed" : label}
    </button>
  );
}

/** Fallback for contexts where navigator.clipboard is unavailable (http, older browsers). */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
