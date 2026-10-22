// The session-free, dependency-free parts of the site header, extracted so the marketing SiteHeader
// (Brand.tsx) and the 404's StaticHeader (not-found.tsx) consume ONE definition instead of a hand-kept
// mirror — previously adding/renaming a marketing nav item in Brand.tsx silently left the 404's copy
// stale, with nothing detecting the drift.
//
// This module must stay a pure presentational LEAF: not-found.tsx forks off SiteHeader precisely
// because SiteHeader awaits getSession()/DB and could cascade a 404 into the 500 document. Do NOT
// import @/lib/auth, @/lib/db, or anything else that can throw at render here — next/link only.

import Link from "next/link";

/** Lives here (not Brand.tsx)
 *  because it must stay importable from a CLIENT component with no server-only baggage — Brand.tsx
 *  pulls @/lib/auth (session/DB reads) at module scope, which can't be bundled into a client component
 *  (see RouteError.tsx, the reason this got split out: G6-13). Brand.tsx re-exports this for its own
 *  (server-only) callers so nothing else has to change import paths. */
export function Logo({ className = "", size = 24 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false" className="shrink-0 text-white">
        <defs>
          <linearGradient id="logo-mkIn" gradientUnits="userSpaceOnUse" x1="27.7" y1="0" x2="68.7" y2="0">
            <stop offset="0" stopColor="currentColor" />
            <stop offset="1" stopColor="#dfe1ff" />
          </linearGradient>
        </defs>
        <path d="M14 88L50 10L86 88" fill="none" stroke="currentColor" strokeWidth="7.5" />
        <path d="M0 63.8L27.7 58.4" stroke="currentColor" strokeWidth="4.4" />
        <path d="M27.7 58.4L68.7 50.6" stroke="url(#logo-mkIn)" strokeWidth="4.4" />
        <g strokeWidth="3.3">
          <path d="M68.7 50.6L100 36" stroke="#FF5A5F" />
          <path d="M68.7 50.6L100 44" stroke="#FFC247" />
          <path d="M68.7 50.6L100 52.4" stroke="#62E59A" />
          <path d="M68.7 50.6L100 61" stroke="#4CB2FF" />
          <path d="M68.7 50.6L100 69.5" stroke="#BC6DFF" />
        </g>
      </svg>
      <span className="hidden font-mono type-body font-semibold uppercase tracking-[0.22em] text-white sm:inline">
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
  "flex items-center gap-3 type-mono-sm uppercase tracking-widest text-slate-400 sm:gap-6";

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
