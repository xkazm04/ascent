// The presentational core of the site footer — brand slot, tagline, nav links, attribution — shared
// by the server SiteFooter (Brand.tsx) and the /about deck's inline client footer (AboutCTA). The two
// footers previously hand-kept mirrored JSX with no shared source for the tagline, link set, or
// attribution, and had already drifted (the /about copy re-typed the tagline and dropped the
// attribution line on exactly the public-facing page).
//
// Like StaticNav, this must stay a pure presentational LEAF: AboutCTA is a client component, and
// Brand.tsx's module-scope @/lib/auth + @/lib/db imports can't cross that boundary. next/link and
// lib/site constants only.

import Link from "next/link";
import { SITE_TAGLINE_TITLE } from "@/lib/site";

/** The canonical footer nav, in render order — the default link set (SiteFooter renders it as-is).
 *  Feedback is the public issue tracker (this repo's GitHub issues) — the one always-available
 *  feedback channel; Privacy/Terms are the legal pages every public surface must link. */
export const FOOTER_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/badge", label: "Badge" },
  { href: "/connect", label: "Connect" },
  { href: "/usage", label: "Usage" },
  { href: "https://github.com/xkazm04/ascent/issues", label: "Feedback" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** The hosting/hackathon attribution line — rendered by EVERY footer (it must not drop off public pages). */
export const FOOTER_ATTRIBUTION = "Built on Vercel + Aurora DSQL · #H0Hackathon";

/**
 * Footer content block: `brand` is the caller's mark (the server Logo, or /about's text wordmark),
 * `links` defaults to the canonical set — pass a curated subset ONLY as a deliberate, commented
 * decision at the call site. The wrapping <footer> shell (borders, padding, deck-bar clearance)
 * stays with each caller; the content contract lives here.
 */
export function SiteFooterCore({
  brand,
  links = FOOTER_LINKS,
}: {
  brand: React.ReactNode;
  links?: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <>
      {brand}
      <p className="mt-3 font-mono text-sm uppercase tracking-widest text-slate-400">{SITE_TAGLINE_TITLE}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-sm uppercase tracking-widest text-slate-400">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="focus-ring rounded-sm hover:text-accent">
            {l.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">{FOOTER_ATTRIBUTION}</p>
    </>
  );
}
