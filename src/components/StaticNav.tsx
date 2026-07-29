// The session-free, dependency-free parts of the site header, extracted so the marketing SiteHeader
// (Brand.tsx) and the 404's StaticHeader (not-found.tsx) consume ONE definition instead of a hand-kept
// mirror — previously adding/renaming a marketing nav item in Brand.tsx silently left the 404's copy
// stale, with nothing detecting the drift.
//
// This module must stay a pure presentational LEAF: not-found.tsx forks off SiteHeader precisely
// because SiteHeader awaits getSession()/DB and could cascade a 404 into the 500 document. Do NOT
// import @/lib/auth, @/lib/db, or anything else that can throw at render here — next/link only.

import Image from "next/image";
import Link from "next/link";

/** Generated ascending-chevron mark + mono wordmark (Altimeter identity). Lives here (not Brand.tsx)
 *  because it must stay importable from a CLIENT component with no server-only baggage — Brand.tsx
 *  pulls @/lib/auth (session/DB reads) at module scope, which can't be bundled into a client component
 *  (see RouteError.tsx, the reason this got split out: G6-13). Brand.tsx re-exports this for its own
 *  (server-only) callers so nothing else has to change import paths. */
export function Logo({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/brand/logo-mark-nobg.png"
        alt=""
        width={size}
        height={size}
        priority
        style={{ width: size, height: size }}
      />
      <span className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">
        Ascent
      </span>
    </span>
  );
}

/** Header shell classes shared by every sticky top bar (marketing, 404, org dashboard).
 *  Height contract: the bar renders ~56px tall, mirrored by `--header-h` in globals.css — the token
 *  Surface's scroll-mt and DeckSection's top padding derive from. If the header's vertical metrics
 *  change (extra row, taller banner), update `--header-h` alongside. */
export const HEADER_SHELL = "sticky top-0 z-30 border-b border-divider/70 bg-ink/80 backdrop-blur";

/** Inner container of the marketing/404 header (the org header uses its wider ORG_SHELL instead). */
export const HEADER_INNER = "mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5";

/** The marketing header's <nav> element classes. */
export const HEADER_NAV =
  "flex items-center gap-3 font-mono text-sm uppercase tracking-widest text-slate-400 sm:gap-6";

/** The static (session-free) marketing nav items, in render order. */
export const MARKETING_NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/pricing", label: "Pricing" },
  // The org edition's marketing deck. It sits before /about deliberately: the buyer for the fleet
  // product is the one who needs a top-level entry point, and /about-org's own footer links back to
  // /about for the per-repo story.
  { href: "/about-org", label: "For orgs" },
  { href: "/about", label: "About" },
];

/** The static marketing nav links (hidden below sm), rendered identically in both headers. */
export function MarketingNavLinks() {
  return (
    <>
      {MARKETING_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="focus-ring hidden rounded-sm hover:text-white sm:inline"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}
