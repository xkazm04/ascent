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
import { getPublicOrgScorecard, type PublicOrgScorecardRead } from "@/lib/register/data";
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

function scorecardDescription(owner: string, read: PublicOrgScorecardRead | null): string {
  if (read?.kind === "ok" && read.card.verifiedCount > 0 && read.card.avgOverall != null) {
    return `How AI-native ${owner}'s public repositories are: an aggregate maturity score across nine dimensions, with every underlying report open to read.`;
  }
  if (read?.kind === "ok") {
    return `No published score yet for ${owner}. All scanned public repositories were scored by the deterministic preview rubric; no model contributed a judgement.`;
  }
  if (read?.kind === "empty") {
    return `None of ${owner}'s public repositories are on the AI-native register. That absence is not a score of 0.`;
  }
  return `Public scorecard for ${owner} on the AI-native register. A score is published only when a model scored at least one public repository.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string }>;
}): Promise<Metadata> {
  const { owner } = await params;
  const title = `${owner}'s public AI-native scorecard | Ascent`;
  const read = validOwner(owner)
    ? await getPublicOrgScorecard(owner).catch((): PublicOrgScorecardRead => ({ kind: "unavailable" }))
    : null;
  const description = scorecardDescription(owner, read);
  return {
    title,
    description,
    alternates: { canonical: `/scorecard/${owner}` },
    openGraph: { title, description, url: `/scorecard/${owner}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function ScorecardChrome({
  owner,
  lede,
  children,
}: {
  owner: string;
  lede: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-12">
        <div className="border-b border-divider pb-4">
          <Kicker>Public scorecard</Kicker>
          <h1 className="mt-2 type-display font-bold tracking-tight text-white sm:type-display-lg">{owner}</h1>
          <p className="mt-3 max-w-3xl type-lede leading-relaxed text-slate-400">{lede}</p>
        </div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

function registerLede(owner: string, scannedAt: string | null) {
  return (
    <>
      How AI-native {owner}&apos;s public repositories are, aggregated from the same open reports on
      the{" "}
      <Link href="/leaderboard" className="focus-ring rounded-sm text-slate-200 underline decoration-dotted underline-offset-2 hover:text-accent">
        AI-native register
      </Link>
      .{scannedAt ? ` Last scan ${timeAgo(scannedAt)}.` : ""}
    </>
  );
}

/** Matches ScorecardSummary's refuse-to-draw: no "how AI-native" claim when nothing is model-scored. */
function unpublishedLede(owner: string, repoCount: number) {
  return (
    <>
      No published score yet. All {repoCount} scanned public {repoCount === 1 ? "repository" : "repositories"}{" "}
      for {owner} were scored by the deterministic preview rubric. No model contributed a judgement.
      Ascent will not publish a maturity number a model never produced.
    </>
  );
}

function missLede(owner: string) {
  return (
    <>
      Public repositories for {owner} on the{" "}
      <Link href="/leaderboard" className="focus-ring rounded-sm text-slate-200 underline decoration-dotted underline-offset-2 hover:text-accent">
        AI-native register
      </Link>
      . A score is published only when a model scored at least one of them.
    </>
  );
}

/** Persistence-off / thrown query: not a 404, and not an empty score of 0. */
function UnavailableCard({ owner }: { owner: string }) {
  return (
    <div className="mt-12 rounded-2xl border border-divider bg-surface/40 p-10 text-center">
      <p className="type-lede font-semibold text-white">Scorecard unavailable</p>
      <p className="mx-auto mt-2 max-w-md type-body text-slate-400">
        The public register could not be read, so this is not a score and not a claim that {owner} has
        no public scans. Try again in a moment.
      </p>
    </div>
  );
}

/** Valid owner, successful read, nothing public to publish. Absence is not a score of 0. */
function EmptyCard({ owner }: { owner: string }) {
  return (
    <div className="mt-12 rounded-2xl border border-divider bg-surface/40 p-10 text-center">
      <p className="type-lede font-semibold text-white">No public scans yet</p>
      <p className="mx-auto mt-2 max-w-md type-body text-slate-400">
        None of {owner}&apos;s public repositories are on the register. That absence is not a score of
        0. Scan a public repo and it lands here.
      </p>
      <Link
        href="/?scan=1"
        className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 type-body font-semibold text-on-accent transition hover:bg-accent-soft"
      >
        Scan a repository <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export default async function ScorecardPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner: raw } = await params;
  // Invalid GitHub-owner grammar is the only 404. A failed or empty register read is not "this
  // owner does not exist".
  if (!validOwner(raw)) notFound();

  const read: PublicOrgScorecardRead = await getPublicOrgScorecard(raw).catch(() => ({
    kind: "unavailable",
  }));

  if (read.kind !== "ok") {
    return (
      <ScorecardChrome owner={raw} lede={missLede(raw)}>
        {read.kind === "unavailable" ? <UnavailableCard owner={raw} /> : <EmptyCard owner={raw} />}
      </ScorecardChrome>
    );
  }

  const card = read.card;
  const ranked = card.repos.filter((r) => r.verified);
  const preview = card.repos.filter((r) => !r.verified);
  const published = card.verifiedCount > 0 && card.avgOverall != null;

  return (
    <ScorecardChrome
      owner={card.owner}
      lede={published ? registerLede(card.owner, card.scannedAt) : unpublishedLede(card.owner, card.repoCount)}
    >
      <ScorecardSummary card={card} />

      {ranked.length > 0 && (
        <section aria-labelledby="repos" className="mt-14">
          <h2 id="repos" className="type-title font-bold tracking-tight text-white">
            Scored repositories
          </h2>
          <LeaderboardTable rows={ranked} />
        </section>
      )}

      {preview.length > 0 && (
        <section aria-labelledby="preview" className="mt-14">
          <h2 id="preview" className="type-title font-bold tracking-tight text-white">
            Preview scans (not counted)
          </h2>
          <p className="mt-2 max-w-2xl type-body-sm leading-relaxed text-slate-400">
            Scored by the deterministic preview rubric with no model in the loop. Listed for
            completeness; excluded from every published number on this page.
          </p>
          <LeaderboardTable rows={preview} ranked={false} />
        </section>
      )}

      <RegisterCta prompt="Want your own scorecard?" />
    </ScorecardChrome>
  );
}
