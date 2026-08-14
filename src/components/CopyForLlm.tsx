"use client";

// Reusable "copy a markdown payload to the clipboard, to paste into Claude Code / an LLM" button.
// This is the baseline of the LLM-consumption direction: every Ascent surface that produces results
// (briefings, reports, gap analyses, security findings) can hand a dev a ready-to-paste brief. Uses
// the async Clipboard API with a legacy execCommand fallback for non-secure contexts.

import { useEffect, useRef, useState } from "react";
import { attemptCopy, isCopyableText, nextCopyState } from "./copy-for-llm.logic";
import { chipButtonClass } from "@/components/ui";

export function CopyForLlm({
  text,
  label = "Copy for LLM",
  ariaLabel,
  className = "",
  onCopied,
}: {
  text: string;
  label?: string;
  /** Distinct accessible name when the visible label is generic (e.g. several "Copy" chips on one page). Defaults to label. */
  ariaLabel?: string;
  className?: string;
  /** Fired once when a copy succeeds — e.g. to count a "use" (Org Skills Library, §8.7). Best-effort. */
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  // Manual-copy fallback surface (pdf-llm-export #4): when BOTH clipboard paths fail (clipboard
  // blocked by Permissions-Policy, iframe/embedded contexts, some mobile browsers), retrying fails
  // identically — the failed flash alone was a dead end with no route to the payload. So a failure
  // also opens a readonly, auto-selected textarea holding the full text: manual Ctrl+C always works.
  // Unlike the 2.5s failed flash, the fallback persists until dismissed (or a later copy succeeds).
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (fallbackOpen) {
      fallbackRef.current?.focus();
      fallbackRef.current?.select();
    }
  }, [fallbackOpen]);
  // Re-entrancy guard: a second click while a copy is still in flight is ignored, so a rapid
  // double-click can't double-fire `onCopied` (which inflates the best-effort "use" count, §8.7).
  const inFlight = useRef(false);
  // Track the pending auto-reset so a fresh attempt cancels the previous one — otherwise an earlier
  // timer flips the button back to idle 500ms after a later successful copy.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // G5-27: an empty/whitespace-only payload can never be a success — `attemptCopy` refuses it, and
  // the button must say so rather than flashing "Copied". Derived from the current `text` (no extra
  // state to fall out of sync), and it also suppresses the manual-copy textarea, which would
  // otherwise open holding nothing — a dead end offering the user an empty box to Ctrl+C.
  const nothingToCopy = !isCopyableText(text);

  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const ok = await attemptCopy(text, navigator.clipboard, legacyCopy);
      const { next, resetMs } = nextCopyState(ok);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (next === "copied") {
        setFailed(false);
        setCopied(true);
        setFallbackOpen(false); // a later successful copy supersedes the manual-copy surface
        onCopied?.();
      } else {
        setCopied(false);
        setFailed(true);
        // Only offer the manual-copy surface when there IS a payload to hand over (G5-27).
        setFallbackOpen(!nothingToCopy);
      }
      resetTimer.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
        resetTimer.current = null;
      }, resetMs);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title="Copy a markdown briefing to paste into Claude Code or another LLM"
        aria-label={ariaLabel ?? label}
        className={chipButtonClass(copied ? "success" : failed ? "danger" : "idle", className)}
      >
        <span aria-hidden>{copied ? "✓" : failed ? "⚠" : "⧉"}</span>
        {copied ? "Copied" : failed ? (nothingToCopy ? "Nothing to copy" : "Copy failed") : label}
      </button>
      {/* pdf-llm-export #2: the button's accessible NAME is a fixed aria-label, so its visible
          Copied / Copy-failed swap was invisible to screen readers (and aria-live on the button
          itself is unreliable). Announce the outcome through a dedicated polite live region. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied
          ? "Copied to clipboard."
          : failed
            ? nothingToCopy
              ? "Nothing to copy. This brief is empty."
              : "Copy failed. The text is shown below: select it and copy manually."
            : ""}
      </span>
      {fallbackOpen && (
        <div className="mt-2 w-full max-w-xl rounded-lg border border-slate-700 bg-slate-950/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-400">
              Automatic copy is blocked here. The text is selected below: press <kbd className="rounded border border-slate-700 px-1 font-mono">Ctrl</kbd>+<kbd className="rounded border border-slate-700 px-1 font-mono">C</kbd> (⌘C on Mac).
            </p>
            <button
              type="button"
              onClick={() => setFallbackOpen(false)}
              aria-label="Close manual copy panel"
              className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
            >
              Close
            </button>
          </div>
          <textarea
            ref={fallbackRef}
            readOnly
            value={text}
            rows={6}
            aria-label="Markdown briefing to copy manually"
            onFocus={(e) => e.currentTarget.select()}
            className="focus-ring mt-2 w-full resize-y rounded-md border border-slate-700 bg-slate-900 p-2 font-mono text-sm text-slate-200"
          />
        </div>
      )}
    </>
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
