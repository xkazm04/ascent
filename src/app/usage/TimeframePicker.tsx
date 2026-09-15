// The timeframe control for /usage.
//
// `?days=` has been honoured by the page and by GET /api/usage since they were built — bounded by
// the shared `boundUsageDays` (default 30, up to 365 for a private org, capped at 90 for the shared
// public funnel) — but nothing on the product ever rendered a control for it. Every reader therefore
// got exactly 30 days, and `UsageTrend`'s weekly-bucket path (`BUCKET_THRESHOLD_DAYS = 120`) was
// unreachable from the UI: code on the shipping path that no user could execute. The docs claimed a
// picker existed. This is it.
//
// SERVER COMPONENT, deliberately — no `"use client"`, no `useRouter`/`useSearchParams`. The page is
// `force-dynamic` and reads its whole state from `searchParams` (`?org=`, `?days=`), so a plain
// anchor per option is the entire mechanism: it works before hydration, it is a real link a reader
// can middle-click or bookmark, and it ships no bundle. The org-shell selectors use the router-push
// shape because they must preserve a tab's other scope params; this page has two, and both are
// written here.

import Link from "next/link";

/** The offered windows. 7 and 90 are the two the product could not reach before; 365 exists so the
 *  weekly-bucket rendering has a way in. Each must survive `boundUsageDays` unchanged — a button
 *  that silently resolves to a different window is worse than no button. */
export const TIMEFRAME_OPTIONS = [7, 30, 90, 365] as const;

/**
 * Which options this caller may actually select.
 *
 * `maxDays` is not a second opinion about the cap: the page derives it by asking `boundUsageDays`
 * itself for the largest window (`boundUsageDays("365", isPublic)`), so the control and the query
 * bound can never drift. The shared public funnel is capped at 90 — an anonymous caller must not be
 * able to force the 365-day full-window aggregate — and 365 is rendered DISABLED rather than hidden
 * there, with the reason, because a silently absent option reads as a product that only offers three
 * windows rather than one that is withholding the fourth from this reader.
 */
export function TimeframePicker({
  org,
  days,
  maxDays,
}: {
  org: string;
  /** The window in force, already bounded. A hand-typed `?days=45` matches no option and simply
   *  leaves none highlighted — the value is still honoured; the control does not overrule the URL. */
  days: number;
  /** The largest selectable window for this caller, from `boundUsageDays`. */
  maxDays: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="type-mono-sm uppercase tracking-widest text-slate-500" id="usage-timeframe-label">
        Window
      </span>
      <div
        role="group"
        aria-labelledby="usage-timeframe-label"
        className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900/40 p-0.5"
      >
        {TIMEFRAME_OPTIONS.map((n) => {
          const current = n === days;
          const allowed = n <= maxDays;
          const label = n === 365 ? "1y" : `${n}d`;
          const base = "focus-ring rounded-md px-2.5 py-1 type-body-sm transition";
          if (!allowed) {
            return (
              <span
                key={n}
                aria-disabled="true"
                title={`The shared public view is limited to ${maxDays} days. Sign in to an organization for the full year.`}
                className={`${base} cursor-not-allowed text-slate-600`}
              >
                {label}
              </span>
            );
          }
          return (
            <Link
              key={n}
              href={`/usage?org=${encodeURIComponent(org)}&days=${n}`}
              aria-current={current ? "true" : undefined}
              className={`${base} ${current ? "bg-accent font-semibold text-[#04070e]" : "text-slate-400 hover:text-white"}`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
