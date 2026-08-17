"use client";

// Org-mode pieces, shared by all three variants (each wraps them in its own chrome).
//
// The floors are not a UI nicety: `CHAMPION_MIN_POP` is the same guard the Contributors / Adoption /
// Teams tabs apply, and it is stated ON SCREEN rather than silently applied — an org that cannot see
// why a panel is empty assumes the data is broken, and one that can see the floor learns the rule.
// There is no per-person row here and there is no prop that could produce one.

import { Meter, OrgTable, SectionEmpty, TILE_LEDGER, Tile } from "@/components/org/shared/ui";
import { deltaHex, fmtDelta } from "@/components/ui";
import { CareAction, CareCategoryChip } from "./CareBits";
import {
  CARE_SHAPE_LABEL,
  CARE_SHAPE_ORDER,
  careShapeValue,
  type CareOrgView,
} from "@/lib/org/care-view";

export function CareOrgFloorNote({ org }: { org: CareOrgView }) {
  return (
    <p className="text-sm text-slate-500">
      Aggregates only, and only above a floor of {org.floor} participating developers ({org.population} in this
      workspace). No row here is a person, and no view of this tab can name one.
    </p>
  );
}

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
  if (org.topKeptMoves.length === 0) return <SectionEmpty>No move has been kept by anyone yet.</SectionEmpty>;
  const max = Math.max(...org.topKeptMoves.map((m) => m.keptBy), 1);

  if (layout === "rows") {
    return (
      <div className="mt-3 space-y-3">
        {org.topKeptMoves.map((m) => (
          <div key={m.title} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-slate-200">{m.title}</span>
                <CareCategoryChip category={m.category} />
              </div>
              <Meter className="mt-1.5" value={(m.keptBy / max) * 100} ariaLabel={`${m.title}: kept by ${m.keptBy}`} />
            </div>
            <span className="w-24 shrink-0 font-mono text-sm tabular-nums text-slate-400">kept by {m.keptBy}</span>
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
            <span className="font-mono text-sm tabular-nums text-white">{m.keptBy}</span>
          </div>
          <p className="mt-2 text-base text-slate-200">{m.title}</p>
          <Meter className="mt-3" value={(m.keptBy / max) * 100} ariaLabel={`${m.title}: kept by ${m.keptBy}`} />
          {m.promotable ? (
            <div className="mt-3">
              <CareAction label="Author as registry skill →" intent="registry.authorFromMove" payload={{ title: m.title }} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Not a registry candidate — a habit, not an artifact.</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CareOrgAsks({ org }: { org: CareOrgView }) {
  if (org.asks.length === 0) return <SectionEmpty>No interview themes shared yet.</SectionEmpty>;
  const max = Math.max(...org.asks.map((a) => a.count), 1);
  return (
    <ol className="mt-3 divide-y divide-divider border-y border-divider">
      {org.asks.map((a) => (
        <li key={a.theme} className="flex items-center gap-4 py-2.5">
          <span className="min-w-0 flex-1 text-base text-slate-200">&ldquo;{a.theme}&rdquo;</span>
          <Meter className="w-24 shrink-0" value={(a.count / max) * 100} ariaLabel={`${a.theme}: ${a.count} developers`} />
          <span className="w-16 shrink-0 text-right font-mono text-sm tabular-nums text-slate-400">{a.count}</span>
        </li>
      ))}
    </ol>
  );
}

export function CareOrgBands({ org }: { org: CareOrgView }) {
  const fields = CARE_SHAPE_ORDER.filter((f) => org.shapeBands[f]);
  if (fields.length === 0) return <SectionEmpty>No shape distribution yet — nobody has shared these counts.</SectionEmpty>;
  return (
    <OrgTable
      className="mt-3"
      minWidth={520}
      caption="Session-shape distribution across participating developers, as quartiles"
      head={
        <tr>
          <th className="px-4 py-2 text-left">Shape</th>
          <th className="px-4 py-2 text-right">p25</th>
          <th className="px-4 py-2 text-right">median</th>
          <th className="px-4 py-2 text-right">p75</th>
        </tr>
      }
    >
      {fields.map((f) => {
        const band = org.shapeBands[f]!;
        return (
          <tr key={f}>
            <td className="px-4 py-2.5 text-base text-slate-200">{CARE_SHAPE_LABEL[f]}</td>
            <td className="px-4 py-2.5 text-right font-mono text-base tabular-nums text-slate-400">{careShapeValue(f, band.p25)}</td>
            <td className="px-4 py-2.5 text-right font-mono text-base tabular-nums text-white">{careShapeValue(f, band.p50)}</td>
            <td className="px-4 py-2.5 text-right font-mono text-base tabular-nums text-slate-400">{careShapeValue(f, band.p75)}</td>
          </tr>
        );
      })}
    </OrgTable>
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
          <td className="px-4 py-2.5 text-base text-slate-200">{o.move}</td>
          <td className="px-4 py-2.5 font-mono text-sm uppercase tracking-widest text-slate-500">{o.dimension}</td>
          <td className="px-4 py-2.5 text-right font-mono text-base tabular-nums text-slate-400">{o.repos}</td>
          <td className="px-4 py-2.5 text-right font-mono text-base tabular-nums" style={{ color: deltaHex(o.avgDelta) }}>
            {fmtDelta(o.avgDelta)}
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}
