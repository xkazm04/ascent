// Shared "outline pill" class for the report header chrome. The Re-test control (FreshnessControl) and
// the Export-PDF / Onboarding-skill anchors (ReportHeader) sit side by side in the same header row and
// are meant to look identical; the Tailwind class string had been hand-copied at each site and could
// silently drift on a spacing/hover tweak. `pillClass` is the single definition — pass the per-element
// variant (accent color triad, optional focus ring, optional explicit text-sm) so each call site renders
// exactly as before.

const PILL_BASE = "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition hover:border-accent hover:text-white";

/**
 * The bordered header action link (Trends → / Compare → / Full report → / Export CSV ↓) shared by the
 * /trends and /report/compare page headers. The class string was hand-copied between the two pages and
 * had already drifted: trends applied the repo-wide `focus-ring` utility, the compare page (cloned
 * before focus-ring landed) omitted it, leaving keyboard users the browser-default outline on one of
 * two sibling pages (trends-comparison 07-16 #5). Single definition, focus-ring included.
 */
export const HEADER_ACTION_LINK_CLASS =
  "focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-base text-slate-300 hover:border-accent hover:text-white";

export function pillClass(opts?: { accent?: boolean; focusRing?: boolean; textSm?: boolean }): string {
  const { accent = false, focusRing = false, textSm = false } = opts ?? {};
  return [
    focusRing ? "focus-ring" : null,
    PILL_BASE,
    textSm ? "text-sm" : null,
    accent ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-700 text-slate-300",
  ]
    .filter(Boolean)
    .join(" ");
}
