// /scorecard/{owner} — the PUBLIC org scorecard (G7-06): the OpenSSF-Scorecard-shaped
// acquisition loop, built as a lens over the public scan corpus.
//
// WHAT IT PUBLISHES, AND WHY THAT IS THE CONSERVATIVE CHOICE.
// This page aggregates ONLY the reports already published at `/report/{owner}/{repo}` — public repos,
// in the shared public org, that anyone can already open one at a time and that already appear on the
// public register. It is structurally incapable of reading an org's Ascent tenant (no `canReadOrg`
// call, no tenant rollup, no membership), so nothing private is republished and no per-tenant
// aggregate (spend, backlog, contributors, governance) can leak through it.
//
// OPT-IN vs OPT-OUT. Publishing an aggregate of already-public reports is opt-OUT here, because the
// underlying facts are already public and the aggregate adds no new disclosure. Publishing a TENANT's
// fleet scorecard would be a genuinely new disclosure and is therefore not built at all — it needs a
// persisted per-org opt-in flag (a schema change), which is deliberately out of scope. See the
// deployment note in docs; if that flag ever lands, the tenant view is the thing that must be gated,
// not this one.

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import { Kicker } from "@/components/ui";
import { getPublicOrgScorecard } from "@/lib/register/data";
import { validRepoNamePart } from "@/lib/repo-ref";
import { timeAgo } from "@/lib/ui";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { RegisterCta } from "@/components/leaderboard/RegisterPager";
import { ScorecardSummary } from "@/components/leaderboard/ScorecardSummary";

export const dynamic = "force-dynamic";

/** GitHub owner grammar, single-sourced in @/lib/repo-ref so every routed-name surface accepts one set. */
function validOwner(s: string): boolean {
  return s.length <= 39 && validRepoNamePart(s);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner } = await params;
  const title = `${owner}'s public AI-native scorecard | Ascent`;
  const description = `How AI-native ${owner}'s public repositories are: an aggregate maturity score across nine dimensions, with every underlying report open to read.`;
  return {
    title,
    description,
    alternates: { canonical: `/scorecard/${owner}` },
    openGraph: { title, description, url: `/scorecard/${owner}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ScorecardPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: raw } = await params;
  if (!validOwner(raw)) notFound();

  const card = await getPublicOrgScorecard(raw).catch(() => null);
  if (!card) notFound();

  const ranked = card.repos.filter((r) => r.verified);
  const preview = card.repos.filter((r) => !r.verified);

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="border-b border-divider pb-4">
          <Kicker>Public scorecard</Kicker>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">{card.owner}</h1>
          <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-400">
            How AI-native {card.owner}&apos;s public repositories are, aggregated from the same open
            reports on the{" "}
            <Link href="/leaderboard" className="focus-ring rounded-sm text-slate-200 underline decoration-dotted underline-offset-2 hover:text-accent">
              AI-native register
            </Link>
            .{card.scannedAt ? ` Last scan ${timeAgo(card.scannedAt)}.` : ""}
          </p>
        </div>

        <ScorecardSummary card={card} />

        {ranked.length > 0 && (
          <section aria-labelledby="repos" className="mt-14">
            <h2 id="repos" className="text-xl font-bold tracking-tight text-white">
              Scored repositories
            </h2>
            <LeaderboardTable rows={ranked} />
          </section>
        )}

        {preview.length > 0 && (
          <section aria-labelledby="preview" className="mt-14">
            <h2 id="preview" className="text-xl font-bold tracking-tight text-white">
              Preview scans (not counted)
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
              Scored by the deterministic preview rubric with no model in the loop. Listed for
              completeness; excluded from every published number on this page.
            </p>
            <LeaderboardTable rows={preview} ranked={false} />
          </section>
        )}

        <RegisterCta prompt="Want your own scorecard?" />
      </main>
      <SiteFooter />
    </>
  );
}
