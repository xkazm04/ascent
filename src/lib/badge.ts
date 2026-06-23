// Shared, dependency-light badge contract — importable by both the server badge route and the
// "use client" BadgeGenerator (no React / server-only deps). Single-sources the two things those two
// files had each re-declared: the report click-through URL (the `?ref=badge` analytics tag) and the
// set of valid badge styles. Keeping them here means a rename (e.g. `?ref=readme-badge`, or a fourth
// style) lands in one place instead of silently desyncing the emitter, the endpoint, and the UI.

/** The "badge → report" attribution permalink. `?ref=badge` tags the click-through so a README hit is
 *  attributable in analytics / server logs (USE-1, the acquisition loop). */
export function badgeReportHref(origin: string, owner: string, repo: string): string {
  return `${origin}/report/${owner}/${repo}?ref=badge`;
}

/** The shields.io-style badge style vocabulary. The badge route's `parseStyle` narrows against this
 *  list and the generator surfaces it as the style chooser, so the two can't offer/accept different sets. */
export type BadgeStyle = "flat" | "flat-square" | "for-the-badge";
export const BADGE_STYLES: BadgeStyle[] = ["flat", "flat-square", "for-the-badge"];
