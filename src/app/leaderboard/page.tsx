// /leaderboard — public, no-auth ranking of the most AI-native public repositories. Reads the same
// persisted public-scan corpus the landing "register" does (getPublicScanGallery, scoped to the
// PUBLIC org), but as a full-page top-20 board with the complete per-dimension breakdown. Every
// public scan is open, so each row deep-links straight to its report; a GitHub icon opens the repo.
// Live data ⇒ force-dynamic, exactly like the landing.

import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/Brand";
import { getPublicScanGallery } from "@/lib/db";
import { dbModeLabel } from "@/lib/db/mode";
import { Kicker } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leaderboard — Ascent",
  description:
    "The most AI-native public repositories, ranked by maturity score with a full per-dimension breakdown. Every scan is public — open any report, no account needed.",
};

const TOP_N = 20;

export default async function LeaderboardPage() {
  // Top-N by overall maturity, with each scan's per-dimension scores. Null on a DB-less deploy or an
  // empty corpus — the page then shows its "nothing scored yet" state instead of an empty table.
  const gallery = await getPublicScanGallery({ topLimit: TOP_N }).catch(() => null);
  const rows = gallery?.topAiNative ?? [];
  const latest = gallery?.recent[0]?.scannedAt;

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-divider pb-4">
          <div>
            <Kicker>The index · ranked</Kicker>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Leaderboard</h1>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-400">
              The {TOP_N} most AI-native public repositories, ranked by overall maturity and broken down
              across all nine dimensions. Every public scan is open — click any repo to read its full report.
            </p>
          </div>
          {gallery && (
            <div className="text-right">
              <span className="block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                {gallery.totalRepos} public {gallery.totalRepos === 1 ? "repo" : "repos"} rated
              </span>
              {/* DB-backed provenance: the live persistence backend (Aurora DSQL in prod) + corpus freshness. */}
              <span
                className="mt-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600"
                title={`This leaderboard is served live from ${dbModeLabel(gallery.dbMode)}.`}
              >
                Served live from {dbModeLabel(gallery.dbMode)}
                {latest ? <> · as of {timeAgo(latest)}</> : null}
              </span>
            </div>
          )}
        </div>

        {rows.length > 0 ? (
          <LeaderboardTable rows={rows} />
        ) : (
          <div className="mt-12 rounded-2xl border border-divider bg-surface/40 p-10 text-center">
            <p className="text-lg font-semibold text-white">No public scans yet</p>
            <p className="mx-auto mt-2 max-w-md text-base text-slate-400">
              The leaderboard fills as repositories get scanned. Be the first — scan a public repo and it
              lands on the board.
            </p>
            <Link
              href="/?scan=1"
              className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Scan a repository <span aria-hidden>→</span>
            </Link>
          </div>
        )}

        {rows.length > 0 && (
          // Growth loop, mirroring the register footer: convert a viewer into a scanned repo / a badge embed.
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-5">
            <span className="text-sm text-slate-500">Want your repo on the leaderboard?</span>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/?scan=1"
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
              >
                <span aria-hidden>▸</span> Scan your repo
              </Link>
              <Link
                href="/badge"
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-slate-300 transition hover:border-accent hover:text-white"
              >
                <span aria-hidden>◆</span> Add a README badge
              </Link>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
