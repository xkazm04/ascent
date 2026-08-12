// VARIANT B — "The Perimeter".
//
// Metaphor: the stance is a BOUNDARY DRAWN AROUND THE FLEET, read spatially rather than textually.
// A checkpoint at the edge decides what may cross at all (the tool/model allowlist); inside, four
// bands descend from open (T0) to restricted (T3), each band progressively inset so the page reads as
// depth; at the centre sit the sealed paths no agent may author. Every repo is placed as a node in
// the band it belongs to, carrying its real level/overall plus its acknowledgement and provenance —
// so the question this variant answers is not "what does the policy say?" but "where does each repo
// stand relative to the line, and who is over it?". Deliberately the opposite of the Charter: no
// masthead, no prose articles, position IS the statement.

import { Kicker } from "@/components/ui";
import { SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { AiStanceDoc } from "./stanceMock";
import { StancePublishCta } from "./stanceShared";
import { CheckpointStrip, PerimeterBand, SealedZones } from "./perimeterParts";

export function StancePerimeter({ doc, slug }: { doc: AiStanceDoc; slug: string }) {
  if (!doc.published) {
    return (
      <StancePublishCta
        kicker={`${slug} · perimeter undrawn`}
        title="There is no line. Every repo is treated the same by every agent."
        body="Without a stance the fleet has one undifferentiated risk surface: a docs PR and a migration get the same review, and nothing marks the paths that should never be agent-authored. Draw the perimeter once and every repo inherits a band."
        cta="Draw the perimeter"
        bullets={[
          { label: "Checkpoint", text: "Which tools and models may cross into org code at all." },
          { label: "Bands", text: "Four risk tiers, each with its own review requirement." },
          { label: "Sealed", text: "Paths and repos closed to AI authorship entirely." },
          { label: "Proof", text: "What each PR must carry to show which side of the line it came from." },
        ]}
      />
    );
  }

  const breaches = doc.repos.reduce((a, r) => a + r.violations, 0);
  const restricted = doc.repos.filter((r) => r.tier === "T2" || r.tier === "T3").length;

  return (
    <div className="space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="AI perimeter"
        description="One line around the fleet: what crosses it, how deep a change may go without extra review, and what stays sealed. Every scanned repo is placed in the band its risk puts it in."
        right={
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
            {doc.version} · effective {doc.effective}
          </span>
        }
      />

      <div className={TILE_GRID}>
        <Tile label="Inside the line" value={String(doc.repos.length)} sub="repos bound to the stance" />
        <Tile
          label="Elevated or restricted"
          value={String(restricted)}
          color={restricted ? "#f97316" : "#10b981"}
          sub="T2+ · need more than one approval"
        />
        <Tile label="Breaches" value={String(breaches)} color={breaches ? "#ef4444" : "#16a34a"} sub="changes inside a sealed path" />
        <Tile label="Provenance" value={`${doc.cleanRate}%`} color={scoreHex(doc.cleanRate)} sub="repos clear on every condition" />
      </div>

      <section>
        <Kicker>The checkpoint</Kicker>
        <p className="mb-3 mt-2 max-w-3xl text-base text-slate-300">
          Nothing reaches a band until it clears the edge. This is the allowlist a PR check enforces before it ever
          looks at what changed.
        </p>
        <CheckpointStrip tools={doc.tools} />
      </section>

      <section className="space-y-3">
        <Kicker>The bands · open to restricted</Kicker>
        {doc.tiers.map((t, i) => (
          <PerimeterBand key={t.id} doc={doc} tierIndex={i} />
        ))}
      </section>

      <SealedZones doc={doc} />
    </div>
  );
}
