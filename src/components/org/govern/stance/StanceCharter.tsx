// VARIANT A — "The Charter".
//
// Metaphor: the stance is a PUBLISHED DOCUMENT — a masthead, a version stamp, a named owner, and
// numbered articles you can cite in a PR review ("Article III, T2"). Where the baseline governance
// card renders the gate as a bullet list of thresholds, the Charter treats the org's AI position as
// an editorial artifact with standing: it has an effective date, a DRI, a review cadence, and a
// ratification record. Reading top-to-bottom answers "what is our policy?"; the right rail answers
// "who has actually adopted it?". Leans hard on the Index identity (Dateline masthead, roman-numeral
// ordinals in the margin, hairline rules between articles) because a policy's authority is carried
// by its typography as much as its content.

import { Dateline, Kicker } from "@/components/ui";
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { reportPermalink } from "@/lib/ui";
import type { AiStanceDoc } from "./stanceMock";
import { AckMark, ComplianceBar, StancePublishCta, TierBadge, complianceVerdict } from "./stanceShared";
import { Article, ArticleProvenance, ArticleTiers, ArticleTools, ArticleZones } from "./charterArticles";

export function StanceCharter({ doc, slug }: { doc: AiStanceDoc; slug: string }) {
  if (!doc.published) {
    return (
      <StancePublishCta
        kicker={`${slug} · no stance on file`}
        title="Your org has not published an AI stance."
        body="Ambiguity is the most-cited blocker to delegating work to agents: engineers who cannot cite a rule fall back to the safest possible use, and the fleet stalls at assist. Publish the charter once and every repo, PR check and review inherits it."
        cta="Publish your stance"
        bullets={[
          { label: "Article I", text: "Which tools and models are permitted, conditional, or forbidden." },
          { label: "Article II", text: "The paths and repos where AI authorship is not allowed." },
          { label: "Article III", text: "What review a change requires, by risk tier." },
          { label: "Article IV", text: "What a PR must carry to prove how it was authored." },
        ]}
      />
    );
  }

  const bound = doc.repos.length;
  return (
    <div className="space-y-8">
      <Dateline
        left={`${doc.org} · ${doc.title}`}
        right={`${doc.version} · effective ${doc.effective} · ${doc.owner}`}
      />

      <header className="animate-fade-up">
        <Kicker>The charter</Kicker>
        <h2 className="mt-2 max-w-3xl text-3xl font-medium leading-tight text-white">{doc.summary}</h2>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">{doc.reviewCadence}</p>
      </header>

      <div className={TILE_GRID}>
        <Tile
          label="Ratified by"
          value={`${doc.adoptionRate}%`}
          color={scoreHex(doc.adoptionRate)}
          sub={`${doc.repos.filter((r) => r.ack === "current").length}/${bound} repos on ${doc.version}`}
        />
        <Tile label="Zones clear" value={`${doc.cleanRate}%`} color={scoreHex(doc.cleanRate)} sub="repos with no breach" />
        <Tile label="Repos bound" value={String(bound)} sub="every scanned repo" />
        <Tile label="In force since" value={doc.effective} sub={`${doc.history.length} revisions`} />
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Article n={1} title="Permitted tools and models" standfirst="The allowlist. Anything not named here needs a DRI and a review before it touches org code.">
            <ArticleTools doc={doc} />
          </Article>
          <Article n={2} title="No-AI zones" standfirst="Paths and repositories where authorship must be human. Agents may read and propose; they may not commit.">
            <ArticleZones doc={doc} />
          </Article>
          <Article n={3} title="Review by risk tier" standfirst="Review scales with blast radius, not with who wrote the change. Cite the tier in the PR.">
            <ArticleTiers doc={doc} />
          </Article>
          <Article n={4} title="Provenance" standfirst="Every AI-assisted change must be identifiable after the fact — that is what makes the rest of this charter auditable.">
            <ArticleProvenance doc={doc} />
          </Article>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Kicker>Ratification</Kicker>
          <p className="mt-2 text-sm text-slate-400">
            Per-repo adoption of {doc.version}. A repo is bound the moment it is scanned; acknowledgement is the
            maintainer accepting the current revision.
          </p>
          <ul className="mt-4 divide-y divide-divider border-y border-divider">
            {doc.repos.map((r) => (
              <li key={r.fullName} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={reportPermalink(r.fullName, null, doc.org)}
                    className="focus-ring truncate font-mono text-sm text-slate-200 hover:text-accent"
                    title={r.fullName}
                  >
                    {r.name}
                  </a>
                  <TierBadge tier={r.tier} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <AckMark ack={r.ack} />
                  <ComplianceBar repo={r} width="w-16" />
                </div>
                <p className="mt-1 text-sm text-slate-500">{complianceVerdict(r)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-slate-600">
            {doc.repos.filter((r) => r.ack !== "current").length} repos need to re-acknowledge
          </p>
        </aside>
      </div>
    </div>
  );
}
