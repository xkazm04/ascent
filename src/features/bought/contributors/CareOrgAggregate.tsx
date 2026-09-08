"use client";

// The org-side care aggregate — the pieces the Contributors tab's Care section renders (§5.2).
//
// The floors are not a UI nicety: `CHAMPION_MIN_POP` is the same guard the Contributors / Adoption /
// Teams tabs apply, and it is stated ON SCREEN rather than silently applied — an org that cannot see
// why a panel is empty assumes the data is broken, and one that can see the floor learns the rule.
// It is stated by the ledger graphic now (`CarePrivacyLedger`), not by the paragraph that used to
// live here. There is no per-person row here and there is no prop that could produce one.
//
// `CareOrgBands` moved to CareOrgBandStrips.tsx when it became a quartile strip; this file keeps the
// tiles, the kept-moves cards, the ask themes and the outcomes table.

import { Meter, OrgTable, SectionEmpty, TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui";
import { CareAction, CareCategoryChip } from "@/features/developer/CareBits";
import { type CareOrgView } from "@/lib/org/developer-view";

export function CareOrgSuppressed({ org }: { org: CareOrgView }) {
  return (
    <SectionEmpty>
      {org.population === 0
        ? `No developer has shared anything yet. Care aggregates appear once at least ${org.floor} have opted in — the same floor the Contributors tab uses.`
        : `${org.population} developer${org.population === 1 ? "" : "s"} opted in — below the floor of ${org.floor}, so every aggregate stays suppressed. With this few participants an "aggregate" would identify individuals.`}
    </SectionEmpty>
  );
}

export function CareOrgAdoptionTiles({ org }: { org: CareOrgView }) {
  const pct = (n: number) => (org.population ? Math.round((n / org.population) * 100) : 0);
  return (
    <div className={`${TILE_LEDGER} mt-3 sm:grid-cols-2 lg:grid-cols-4`}>
      <Tile label="Developers" value={org.population} sub="could opt in" />
      <Tile label="Mentor set up" value={org.adoption.setUp} sub={`${pct(org.adoption.setUp)}% of the workspace`} />
      <Tile label="Sharing an aggregate" value={org.adoption.sharing} sub={`${pct(org.adoption.sharing)}% — always their choice`} />
      <Tile label="Moves kept fleet-wide" value={org.topKeptMoves.reduce((a, m) => a + m.keptBy, 0)} sub="counts only" />
    </div>
  );
}

export function CareOrgKeptMoves({ org, layout = "cards" }: { org: CareOrgView; layout?: "cards" | "rows" }) {
  // (O) The header's old rationale lands here: what a kept move IS, and what it can become.
  if (org.topKeptMoves.length === 0) {
    return (
      <SectionEmpty>
        No move has been kept by anyone yet. These are the changes developers here tried and chose to keep; the ones
        that describe an artifact rather than a habit can be authored into the registry from this panel.
      </SectionEmpty>
    );
  }
  const max = Math.max(...org.topKeptMoves.map((m) => m.keptBy), 1);

  if (layout === "rows") {
    return (
      <div className="mt-3 space-y-3">
        {org.topKeptMoves.map((m) => (
          <div key={m.title} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="type-body text-slate-200">{m.title}</span>
                <CareCategoryChip category={m.category} />
              </div>
              <Meter className="mt-1.5" value={(m.keptBy / max) * 100} ariaLabel={`${m.title}: kept by ${m.keptBy}`} />
            </div>
            <span className="w-24 shrink-0 type-mono-sm tabular-nums text-slate-400">kept by {m.keptBy}</span>
            {m.promotable ? (
              <CareAction label="Author as registry skill →" intent="registry.authorFromMove" payload={{ title: m.title }} />
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {org.topKeptMoves.map((m) => (
        <div key={m.title} className="rounded-xl border border-divider bg-ink p-4">
          <div className="flex items-baseline justify-between gap-3">
            <CareCategoryChip category={m.category} />
            <span className="type-mono-sm tabular-nums text-white">{m.keptBy}</span>
          </div>
          <p className="mt-2 type-body text-slate-200">{m.title}</p>
          <Meter className="mt-3" value={(m.keptBy / max) * 100} ariaLabel={`${m.title}: kept by ${m.keptBy}`} />
          {m.promotable ? (
            <div className="mt-3">
              <CareAction label="Author as registry skill →" intent="registry.authorFromMove" payload={{ title: m.title }} />
            </div>
          ) : (
            <p className="mt-3 type-body-sm text-slate-600">Not a registry candidate — a habit, not an artifact.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CareOrgAsks({ org }: { org: CareOrgView }) {
  // (O) The header's old rationale: why anyone would want this list at all.
  if (org.asks.length === 0) {
    return (
      <SectionEmpty>
        No interview themes shared yet. Once developers share them these become the registry&apos;s backlog — written,
        anonymized and counted, by the people who feel the waste.
      </SectionEmpty>
    );
  }
  const max = Math.max(...org.asks.map((a) => a.count), 1);
  return (
    <ol className="mt-3 divide-y divide-divider border-y border-divider">
      {org.asks.map((a) => (
        <li key={a.theme} className="flex items-center gap-4 py-2.5">
          <span className="min-w-0 flex-1 type-body text-slate-200">&ldquo;{a.theme}&rdquo;</span>
          <Meter className="w-24 shrink-0" value={(a.count / max) * 100} ariaLabel={`${a.theme}: ${a.count} developers`} />
          <span className="w-16 shrink-0 text-right type-mono-sm tabular-nums text-slate-400">{a.count}</span>
        </li>
      ))}
    </ol>
  );
}

export function CareOrgOutcomes({ org }: { org: CareOrgView }) {
  if (org.outcomes.length === 0) {
    return <SectionEmpty>No outcome link yet: a kept move needs two scans of a repo before a delta is honest.</SectionEmpty>;
  }
  return (
    <OrgTable
      className="mt-3"
      minWidth={560}
      caption="Kept moves linked to repository score movement"
      head={
        <tr>
          <th className="px-4 py-2 text-left">Kept move</th>
          <th className="px-4 py-2 text-left">Dimension</th>
          <th className="px-4 py-2 text-right">Repos</th>
          <th className="px-4 py-2 text-right">Avg delta</th>
        </tr>
      }
    >
      {org.outcomes.map((o) => (
        <tr key={o.move}>
          <td className="px-4 py-2.5 type-body text-slate-200">{o.move}</td>
          <td className="px-4 py-2.5 type-mono-sm uppercase tracking-widest text-slate-500">{o.dimension}</td>
          <td className="px-4 py-2.5 text-right font-mono type-body tabular-nums text-slate-400">{o.repos}</td>
          <td className="px-4 py-2.5 text-right font-mono type-body tabular-nums" style={{ color: deltaHex(o.avgDelta) }}>
            {fmtDelta(o.avgDelta)}
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}
