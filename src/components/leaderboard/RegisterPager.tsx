// Server-rendered pager for the public register. Deliberately anchor-based (no client state, no
// router hook): the ranking must be crawlable, which means every page past the first has to be a real
// URL a crawler can follow and index, not a click a JS bundle handles. rel=prev/next gives the crawler
// the sequence explicitly.

import Link from "next/link";

const CHIP =
  "focus-ring inline-flex items-center gap-2 rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white";

export function RegisterPager({ page, totalPages, basePath }: { page: number; totalPages: number; basePath: string }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`);
  return (
    <nav aria-label="Register pages" className="mt-8 flex items-center justify-between gap-3 border-t border-divider pt-5">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={CHIP}>
          <span aria-hidden>←</span> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={CHIP}>
          Next <span aria-hidden>→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** The growth loop shared by the register and the scorecard: viewer → scanned repo → embedded badge. */
export function RegisterCta({ prompt }: { prompt: string }) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-5">
      <span className="text-sm text-slate-500">{prompt}</span>
      <div className="flex flex-wrap gap-2">
        <Link href="/?scan=1" className={CHIP}>
          <span aria-hidden>▸</span> Scan your repo
        </Link>
        <Link href="/badge" className={CHIP}>
          <span aria-hidden>◆</span> Add a README badge
        </Link>
      </div>
    </div>
  );
}
