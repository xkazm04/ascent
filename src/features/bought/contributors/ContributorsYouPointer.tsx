// The "You" pointer (docs/REGISTRY-AND-CARE-IMPL.md §5.2).
//
// Contributors is the org reading its developers in aggregate; the Developer route is a developer
// reading themself. Without a pointer between them the second surface is undiscoverable from the
// first — and the first is exactly where someone thinks "where am I in this?". So: if the viewer is
// in the roster, their row/card says so and links across; if they are not (never committed to a
// scanned repo here, or the population is under the naming floor and no rows exist at all), a quiet
// strip offers the same destination without pretending they are missing from a leaderboard.
//
// Server-safe (no hooks, no handlers) — both pieces render inside the tab's server components.

import { orgTabHref } from "@/lib/org/orgTabs";

/** The inline mark on the viewer's own row/card. Nothing else about the row changes. */
export function YouMark({ slug }: { slug: string }) {
  return (
    <a
      href={orgTabHref(slug, "developer")}
      className="focus-ring rounded-full border border-accent/40 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
    >
      you → developer
    </a>
  );
}

/** True when `login` is the viewer's, compared the way every other login comparison here is. */
export function isViewer(login: string, viewerLogin: string | null | undefined): boolean {
  return Boolean(viewerLogin) && login.toLowerCase() === viewerLogin!.toLowerCase();
}

/**
 * The quiet strip for a viewer who is NOT in the roster. Deliberately understated: absence from this
 * table is normal (an EM, a new joiner, anyone under the floor) and must not read as a deficiency.
 */
export function ContributorsYouStrip({ slug, viewerLogin }: { slug: string; viewerLogin: string | null }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/20 px-4 py-3">
      <p className="text-sm text-slate-400">
        {viewerLogin ? (
          <>
            No commits attributed to <span className="font-mono text-slate-300">{viewerLogin}</span> in this
            workspace&apos;s scanned repositories — your own activity, gaps and care loop still have a home.
          </>
        ) : (
          <>Signed in, this page can point you at your own activity, the gaps of the repos you touch, and your care loop.</>
        )}
      </p>
      <a
        href={orgTabHref(slug, "developer")}
        className="focus-ring shrink-0 rounded-md px-2.5 py-1.5 font-mono text-sm uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
      >
        See your own activity →
      </a>
    </div>
  );
}
