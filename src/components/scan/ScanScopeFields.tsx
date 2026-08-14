"use client";

import { useId, useState } from "react";
import { isValidGitRef, normalizeSubPath } from "@/lib/scan-scope";

export interface ScanScopeValue {
  /** Branch, tag or commit to score instead of the default branch. Empty ⇒ default branch. */
  ref: string;
  /** Monorepo sub-directory to aim the ingestion budget at. Empty ⇒ whole repository. */
  subPath: string;
}

export const EMPTY_SCOPE: ScanScopeValue = { ref: "", subPath: "" };

/**
 * Validate a scope the user typed, client-side, using the SAME pure predicates the scan routes
 * enforce (src/lib/scan-scope.ts) — so an obviously-bad ref is caught before it costs a round-trip
 * and one of the free tier's monthly scan slots. Returns a message, or null when the value is fine.
 * Server-side validation is still authoritative; this is only the fast path.
 */
export function validateScope(scope: ScanScopeValue): string | null {
  const ref = scope.ref.trim();
  if (ref && !isValidGitRef(ref)) {
    return "Branch/tag must be a valid git ref: letters, digits, . _ - and /, e.g. release/2.1.";
  }
  const subPath = scope.subPath.trim();
  if (subPath && !normalizeSubPath(subPath)) {
    return "Sub-path must be a relative folder inside the repo, e.g. packages/api.";
  }
  return null;
}

/** The scope as URL query params for `/report?repo=…`. Omits empty fields entirely so an unscoped
 *  scan produces exactly the URL it always did. */
export function scopeQuery(scope: ScanScopeValue): string {
  const ref = scope.ref.trim();
  const subPath = normalizeSubPath(scope.subPath.trim()) ?? "";
  return `${ref ? `&ref=${encodeURIComponent(ref)}` : ""}${subPath ? `&path=${encodeURIComponent(subPath)}` : ""}`;
}

/**
 * Optional scan-scope inputs, collapsed by default behind a disclosure so the hero form stays a
 * one-field "paste a repo" affordance.
 *
 * Both fields carry an explicit honesty note rather than only a placeholder: a scoped reading is not
 * comparable with the default-branch corpus and is deliberately not saved to the repo's history, and
 * a user who has just been shown a big number needs to know that BEFORE they screenshot it.
 */
export function ScanScopeFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ScanScopeValue;
  onChange: (next: ScanScopeValue) => void;
  disabled?: boolean;
}) {
  const refId = useId();
  const pathId = useId();
  const noteId = useId();
  // Reveal the panel whenever a scope is present from outside this component — the parent prefills
  // the branch from a pasted `github.com/owner/repo/tree/develop` link, and a scope the user can't
  // see is a scope they can't correct (and a score they'd misread as the default branch's).
  //
  // TRI-STATE, not a boolean OR: `open = userOpened || hasScope` made the toggle INERT once any scope
  // value existed — clicking set userOpened=false while hasScope kept `open` true, so the `−` control
  // and `aria-expanded` never changed and a screen-reader user was told "expanded", activated it, and
  // got no state change. It also made the collapsed-summary chip below unreachable (its condition
  // `!open && hasScope` is `!(userOpened||hasScope) && hasScope` — never true). `null` = the user has
  // not decided, so fall back to auto-reveal; once they decide, their choice wins in both directions.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const hasScope = Boolean(value.ref || value.subPath);
  const open = userToggled ?? hasScope;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        aria-expanded={open}
        className="focus-ring rounded font-mono text-sm uppercase tracking-widest text-slate-400 transition hover:text-accent"
      >
        {open ? "−" : "+"} Branch &amp; sub-path
        {!open && (value.ref || value.subPath) ? (
          <span className="ml-2 normal-case tracking-normal text-accent">
            {[value.ref, value.subPath && `${value.subPath}/`].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="mt-2 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 sm:grid-cols-2">
          <div>
            <label htmlFor={refId} className="block font-mono text-sm text-slate-400">
              Branch, tag or commit
            </label>
            <input
              id={refId}
              value={value.ref}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, ref: e.target.value })}
              placeholder="default branch"
              aria-describedby={noteId}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-base text-slate-100 placeholder-slate-600 outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor={pathId} className="block font-mono text-sm text-slate-400">
              Sub-path (monorepo)
            </label>
            <input
              id={pathId}
              value={value.subPath}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, subPath: e.target.value })}
              placeholder="whole repository"
              aria-describedby={noteId}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-base text-slate-100 placeholder-slate-600 outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <p id={noteId} className="text-sm text-slate-500 sm:col-span-2">
            A sub-path spends the code-sample budget on that folder; repo-wide files (CI workflows,
            root manifests, CODEOWNERS) are always read. Scoped scans aren&apos;t comparable with
            default-branch scores and aren&apos;t saved to the repo&apos;s history.
          </p>
        </div>
      )}
    </div>
  );
}
