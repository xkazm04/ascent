"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

// Fallback chips when the live index is empty (DB-less MVP, or no scans yet).
const FALLBACK_EXAMPLES = ["facebook/react", "vercel/next.js", "anthropics/claude-code"];

/**
 * Forgiving client-side normalization: accepts a full URL, a `git@` SSH URL, a
 * `github.com/owner/repo`, a trailing slash, or a bare `owner/repo`, and returns a clean
 * `owner/repo` — or null when it can't be coerced into a valid GitHub repo reference.
 */
export function normalizeRepo(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, ""); // SSH form
  s = s.replace(/^https?:\/\//i, ""); // scheme
  s = s.replace(/^(www\.)?github\.com\//i, ""); // host prefix
  s = s.replace(/\.git$/i, ""); // .git suffix
  s = s.replace(/^\/+|\/+$/g, ""); // leading/trailing slashes
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner = "", repo = ""] = parts;
  const ok = /^[A-Za-z0-9_.-]+$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return `${owner}/${repo}`;
}

export function ScanForm({
  autoFocus = false,
  examples,
}: {
  autoFocus?: boolean;
  /** Live "Try:" chips (e.g. top-scoring repos from the index); falls back to a static set. */
  examples?: string[];
}) {
  const router = useRouter();
  // Distinguish live top-scored repos (from the persisted gallery) from the static fallback, so the
  // chips never imply "currently trending" when they're hardcoded defaults.
  const liveExamples = examples != null && examples.length > 0;
  const chips = examples && examples.length > 0 ? examples : FALLBACK_EXAMPLES;
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingChip, setPendingChip] = useState<string | null>(null);

  // Autofocus only on a pointer-precise, wide viewport — on phones a bare autoFocus yanks the
  // keyboard open and scrolls the page past the hero (SP#6).
  useEffect(() => {
    if (!autoFocus || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  function submit() {
    const normalized = normalizeRepo(value);
    if (!normalized) {
      setError("Enter a GitHub repo as owner/repo (or paste its URL).");
      // Retrigger the shake even on repeated invalid submits.
      setShake(false);
      requestAnimationFrame(() => setShake(true));
      return;
    }
    setError(null);
    setSubmitting(true);
    router.push(`/report?repo=${encodeURIComponent(normalized)}`);
  }

  return (
    <div className="w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-busy={submitting}
        className={`flex overflow-hidden rounded-lg border bg-slate-950/70 shadow-2xl shadow-black/40 backdrop-blur focus-within:border-accent ${
          error ? "border-danger/70" : "border-slate-700"
        } ${shake ? "animate-shake" : ""}`}
        onAnimationEnd={() => setShake(false)}
      >
        <span className="hidden items-center pl-4 font-mono text-base text-slate-400 sm:flex">
          github.com/
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="owner/repo"
          aria-label="GitHub repository"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1 bg-transparent px-4 py-3.5 font-mono text-base text-slate-100 placeholder-slate-500 outline-none sm:px-2"
        />
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="focus-ring inline-flex items-center gap-2 bg-accent px-6 font-mono text-sm font-semibold uppercase tracking-widest text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-400"
        >
          {submitting ? (
            <>
              {/* Spinning indicator when motion is allowed… */}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 animate-spin motion-reduce:hidden"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="4" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
              {/* …and a static three-dot fallback under prefers-reduced-motion. */}
              <span aria-hidden className="hidden leading-none motion-reduce:inline">
                •••
              </span>
              Scanning
            </>
          ) : (
            "Scan"
          )}
        </button>
      </form>

      {/* On phones the github.com/ prefix is hidden for width; surface it as a persistent hint
          (the placeholder disappears the moment the user types). */}
      <p className="mt-1.5 font-mono text-sm text-slate-500 sm:hidden">github.com/owner/repo</p>

      {/* Inline validation message, wired to the input via aria-describedby. */}
      {error && (
        <p id={errorId} className="mt-2 animate-fade-up text-base text-danger">
          {error}
        </p>
      )}

      {/* Polite status for screen readers while the scan kicks off. */}
      <span role="status" aria-live="polite" className="sr-only">
        {submitting ? `Scanning ${normalizeRepo(value) ?? value}…` : ""}
      </span>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-sm text-slate-400">
        <span className="uppercase tracking-widest">{liveExamples ? "Top scored:" : "Try:"}</span>
        {chips.map((ex) => {
          const chipPending = pendingChip === ex;
          return (
            <button
              key={ex}
              type="button"
              disabled={submitting}
              onClick={() => {
                setValue(ex);
                setError(null);
                setSubmitting(true);
                setPendingChip(ex);
                router.push(`/report?repo=${encodeURIComponent(ex)}`);
              }}
              className={`focus-ring rounded-md border px-3 py-1 transition disabled:cursor-not-allowed ${
                chipPending
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-accent hover:text-accent"
              } ${submitting && !chipPending ? "opacity-50" : ""}`}
            >
              {ex}
              {chipPending && (
                <span aria-hidden className="ml-1.5 motion-safe:animate-pulse">
                  …
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
