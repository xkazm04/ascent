// THE LIVE TAB'S THREE VIEWS over one standing runner (spark theater-upgrade, 2026-09-18):
//
//   Theater  — the passive third screen, a chrome-less page at /theater/<slug> (opens in its own tab)
//   Ledger   — the returning operator's view: chronicle, approval inbox, since-you-last-looked
//   Cockpit  — setup, manual runs and the sky chart
//
// Plain links, no client state: the view is the URL (`?view=`), so a reload, a bookmark or a second
// screen lands exactly where the operator was. Server-renderable (no hooks), so it carries no
// "use client" and costs the page nothing.

import Link from "next/link";

export type LiveView = "ledger" | "cockpit";

type SearchParams = { [key: string]: string | string[] | undefined };

/** `?tab=live&view=<view>` with every other param preserved — a view switch must not drop the stack scope. */
export function liveViewHref(sp: SearchParams, view: LiveView | "wall"): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "view") continue;
    if (Array.isArray(v)) for (const one of v) params.append(k, one);
    else if (v != null) params.set(k, v);
  }
  if (!params.has("tab")) params.set("tab", "live");
  params.set("view", view);
  return `?${params.toString()}`;
}

/** The theater's own page — outside the org shell, so it can own the whole screen. */
export const theaterHref = (slug: string): string => `/theater/${encodeURIComponent(slug)}`;

const LINK = "focus-ring rounded-md px-3 py-1.5 type-body-sm font-medium transition";
const ON = "bg-accent/15 text-accent";
const OFF = "text-slate-400 hover:text-slate-100";

export function LiveViewSwitch({
  slug,
  current,
  ledgerHref,
  cockpitHref,
}: {
  slug: string;
  current: LiveView;
  ledgerHref: string;
  cockpitHref: string;
}) {
  return (
    <nav aria-label="Live views" className="inline-flex items-center gap-1 rounded-lg border border-divider p-0.5">
      <a
        href={theaterHref(slug)}
        target="_blank"
        rel="noopener"
        className={`${LINK} ${OFF}`}
        title="Open the theater — a full-screen view for a screen nobody is operating"
      >
        Theater ↗
      </a>
      <Link href={ledgerHref} aria-current={current === "ledger" ? "page" : undefined} className={`${LINK} ${current === "ledger" ? ON : OFF}`}>
        Ledger
      </Link>
      <Link href={cockpitHref} aria-current={current === "cockpit" ? "page" : undefined} className={`${LINK} ${current === "cockpit" ? ON : OFF}`}>
        Cockpit
      </Link>
    </nav>
  );
}
