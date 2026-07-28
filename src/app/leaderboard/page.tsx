// /leaderboard — THE PUBLIC REGISTER (G7-05). A server-rendered, crawlable, paginated ranking of the
// most AI-native PUBLIC repositories, independent of the client-rendered landing deck.
//
// Three properties this page is responsible for, none of them cosmetic:
//
//  1. CRAWLABLE. The ranking is rendered on the server, every page past the first is a real
//     `?page=N` URL with rel=prev/next and a self-referencing canonical, and the route is listed in
//     sitemap.ts. No part of the board depends on client JS.
//  2. PUBLIC-ONLY. Data comes from `getPublicRegister`, which pins every query to the shared public
//     org AND `isPrivate:false`, and drops a private row per-row on top of that (see lib/register).
//  3. HONEST. Mock-engine scans are NEVER ranked. They are drawn below the board, unranked, each
//     carrying the same `demo` qualifier the README badge uses. A register that silently ranked a
//     deterministic preview against a model-scored repo would be worse than no register at all.

import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import { getPublicRegister } from "@/lib/register/data";
import { getDbMode, dbModeLabel } from "@/lib/db/mode";
import { Kicker } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { RegisterCta, RegisterPager } from "@/components/leaderboard/RegisterPager";

export const dynamic = "force-dynamic";

const TITLE = "The AI-native register — Ascent";
const DESCRIPTION =
  "Every public repository Ascent has scored, ranked by AI-native maturity with a full per-dimension breakdown. Model-scored entries only; preview scans are listed separately and never ranked.";

function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const page = pageParam((await searchParams).page);
  // Self-referencing canonical per page — page 2+ is genuinely distinct content, not a duplicate of
  // page 1, so each points at itself rather than collapsing the series onto one URL.
  const canonical = page > 1 ? `/leaderboard?page=${page}` : "/leaderboard";
  const title = page > 1 ? `${TITLE} · page ${page}` : TITLE;
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical },
    openGraph: { title, description: DESCRIPTION, url: canonical, type: "website" },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION },
  };
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = pageParam((await searchParams).page);
  const register = await getPublicRegister({ page }).catch(() => null);
  const rows = register?.entries ?? [];
  const unranked = register?.unverified ?? [];
  const latest = rows[0]?.scannedAt ?? unranked[0]?.scannedAt;
  const startRank = register ? (register.page - 1) * register.perPage + 1 : 1;

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-divider pb-4">
          <div>
            <Kicker>The index · ranked</Kicker>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              The AI-native register
            </h1>
            <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-400">
              Every public repository Ascent has scored, ranked by overall maturity and broken down
              across all nine dimensions. Every public scan is open — click any repo to read its full
              report, or open an owner&apos;s{" "}
              <span className="text-slate-300">public scorecard</span> from its name.
            </p>
          </div>
          {register && (
            <div className="text-right">
              <span className="block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                {register.totalVerified} ranked · {register.totalRepos} public{" "}
                {register.totalRepos === 1 ? "repo" : "repos"} scored
              </span>
              <span
                className="mt-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600"
                title={`This register is served live from ${dbModeLabel(getDbMode())}.`}
              >
                Served live from {dbModeLabel(getDbMode())}
                {latest ? <> · as of {timeAgo(latest)}</> : null}
              </span>
            </div>
          )}
        </div>

        {register && rows.length > 0 ? (
          <>
            <LeaderboardTable rows={rows} startRank={startRank} />
            {register.windowed && (
              <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-slate-600">
                Ranked within the {register.totalVerified} highest-scoring scored repositories.
              </p>
            )}
            <RegisterPager page={register.page} totalPages={register.totalPages} basePath="/leaderboard" />
          </>
        ) : (
          <div className="mt-12 rounded-2xl border border-divider bg-surface/40 p-10 text-center">
            <p className="text-lg font-semibold text-white">
              {unranked.length > 0 ? "Nothing model-scored yet" : "No public scans yet"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-base text-slate-400">
              {unranked.length > 0
                ? "Every public scan so far came from the deterministic preview rubric, so there is nothing to rank. A real scan puts a repo on the board."
                : "The register fills as repositories get scanned. Be the first — scan a public repo and it lands on the board."}
            </p>
            <Link
              href="/?scan=1"
              className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Scan a repository <span aria-hidden>→</span>
            </Link>
          </div>
        )}

        {unranked.length > 0 && (
          // NOT a second leaderboard. These scores came from the deterministic rubric with no model in
          // the loop, so they are shown without positions and with the `demo` qualifier on every row.
          <section aria-labelledby="unranked" className="mt-14">
            <h2 id="unranked" className="text-xl font-bold tracking-tight text-white">
              Preview scans — not ranked
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              These repositories were scored by the deterministic preview rubric: no model contributed a
              judgement, so the numbers are a floor, not a rating. They are listed for completeness and
              are excluded from the ranking above.
            </p>
            <LeaderboardTable rows={unranked} ranked={false} />
          </section>
        )}

        {(rows.length > 0 || unranked.length > 0) && (
          <RegisterCta prompt="Want your repo on the register?" />
        )}
      </main>
      <SiteFooter />
    </>
  );
}
