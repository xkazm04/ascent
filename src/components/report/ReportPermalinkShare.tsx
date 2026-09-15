"use client";

// HAND THE PERMALINK OVER — UAT `SAM-L1-04` (recurrence 3) + `SAM-L1-12`.
//
// The scan flow ends on `/report?repo=…` and, for three runs, never named the durable address of the
// artifact the visitor just waited minutes for. `reportPermalink()` had 25+ call sites and exactly one
// on the scan path — inside a signed-in notify-email branch. Meanwhile `/pricing` sells "Public report
// permalink" as a Free-tier bullet, so the product was billing (at $0, but billing) a feature it never
// handed you.
//
// It also serves the JOB the retired badge used to: *"hand me a badge and a level I'd stake my name on
// in the README"*. The badge is not coming back (`RV-SAM-L1-03`, removed 2026-08-29) — but a markdown
// link carrying the level line is embeddable by URL, is a link rather than an image, and states the same
// claim. That is the whole of `SAM-L1-12` option (b), decided and recorded in the 2026-08-30 drain.
//
// The route it points at already exists (`src/app/report/[owner]/[repo]/page.tsx`) and is PUBLIC: it
// resolves through `readableOrgForOwner`, which falls back to the public org, so a private repo's report
// stays gated exactly as it is today. Nothing here widens access — it names an address the reader could
// already have typed.

import { useState, useSyncExternalStore } from "react";
import { CopyForLlm } from "@/components/CopyForLlm";
import { pillClass } from "@/components/report/pill";

// `window.location.origin` never changes for the life of a report page, so the store has nothing to
// subscribe to — hoisted (stable identities) so useSyncExternalStore never re-subscribes or re-reads.
const subscribeNever = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

/** `L3 · Managed · 62` — the claim a reader stakes their name on, in one line. */
export function levelLine(levelId: string, levelName: string, score: number): string {
  return `${levelId} · ${levelName} · ${score}`;
}

export function ReportPermalinkShare({
  fullName,
  path,
  pinnedPath,
  level,
}: {
  /** `owner/name`, for the README link text and the accessible copy labels. */
  fullName: string;
  /** The canonical, UNPINNED permalink path — the one that stays current in a README. */
  path: string;
  /** The commit-pinned permalink path, when this scan has a head SHA. This is the one to paste into a
   *  PR or a Slack thread, where "the report as of this commit" is the honest claim. */
  pinnedPath?: string;
  /** Pre-rendered `L3 · Managed · 62`. */
  level: string;
}) {
  const [open, setOpen] = useState(false);
  // Read from the browser, never from an env var: the correct origin is whatever host this reader is
  // on, which is also the only answer that is right on a self-hosted deployment. Through
  // useSyncExternalStore (location IS an external system) with a "" server snapshot, so SSR renders the
  // relative path — a valid link — and the client renders it absolute, with no effect-driven re-render.
  const origin = useSyncExternalStore(subscribeNever, getOrigin, getServerOrigin);

  const abs = (p: string) => `${origin}${p}`;
  const url = abs(path);
  const readme = `[Ascent: ${level}](${url})`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Copy this report's permanent link"
        className={pillClass({ focusRing: true, textSm: true })}
      >
        {/* No emoji: the export row's glyphs are typographic (↓ / ⧉) and the brand copy tests forbid
            pictographs. `∞` reads as "the link that doesn't expire", which is the claim. */}
        <span aria-hidden>∞</span> Permalink
      </button>
      {open && (
        <div className="mt-2 w-full max-w-xl rounded-lg border border-slate-700 bg-slate-950/80 p-3 text-left">
          <p className="type-body-sm text-slate-400">
            This report has a permanent address. <span className="text-slate-300">{level}</span> — the level line to
            put beside it.
          </p>
          <ShareRow
            label="Permalink"
            hint="Stays on the latest scan — the one for a README or a docs page."
            value={url}
            ariaLabel={`Copy the permalink to the ${fullName} report`}
          />
          {pinnedPath && (
            <ShareRow
              label="This commit"
              hint="Pinned to the commit this scan read — for a PR or a Slack thread."
              value={abs(pinnedPath)}
              ariaLabel={`Copy the commit-pinned permalink to the ${fullName} report`}
            />
          )}
          <ShareRow
            label="README"
            hint="Markdown: the level line, linked to the permalink."
            value={readme}
            ariaLabel={`Copy the README markdown for the ${fullName} report`}
          />
        </div>
      )}
    </>
  );
}

/** One copyable line: what it is, what it's for, the exact text, and a copy control. The value is a
 *  readonly input rather than a `<p>` so it is selectable and Ctrl+C-able when the clipboard is blocked. */
function ShareRow({
  label,
  hint,
  value,
  ariaLabel,
}: {
  label: string;
  hint: string;
  value: string;
  ariaLabel: string;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2">
        <span className="type-mono-sm uppercase tracking-widest text-slate-500">{label}</span>
        <span className="type-body-sm text-slate-500">{hint}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={value}
          // "Copy the permalink to the acme/web report" → "The permalink to the acme/web report": the
          // field and its copy button need DISTINCT accessible names, or a screen-reader user hears the
          // same label twice and cannot tell which one they landed on.
          aria-label={ariaLabel.replace(/^Copy the /, "The ")}
          onFocus={(e) => e.currentTarget.select()}
          className="focus-ring min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 type-mono-sm text-slate-200"
        />
        <CopyForLlm text={value} label="Copy" ariaLabel={ariaLabel} title={ariaLabel} />
      </div>
    </div>
  );
}
