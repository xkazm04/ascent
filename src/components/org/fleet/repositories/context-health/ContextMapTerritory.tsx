// VARIANT 3 — "Map vs territory".
//
// METAPHOR: cartography. The context layer is a MAP; the codebase is the TERRITORY. Health is not a
// property of either one — it's the agreement between them. So the surface is SPATIAL: every repo is
// plotted on a plane of how fast its territory moves against how current its map is, and the
// dangerous quadrant (fast code, stale map) is a place on screen you can point at. Underneath, a
// heat matrix breaks each repo's map into the five things a map can be wrong about.
//
// WHY IT DIFFERS from the other variants: Half-life is a clock, Prompt audit is a judgement — both
// are per-repo lists. This is the only fleet-SHAPED view: it answers "where is my organization's
// context problem concentrated?" before it answers anything about an individual repo, and it is the
// only one where a repo with NO context reads as *uncharted* territory rather than a zero.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { SectionHeader, Tile, TILE_LEDGER, InlineEmpty } from "@/components/org/shared/ui";
import { heatCell, scoreHex } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { fleetContextSummary, type RepoContextHealth } from "./contextHealthMock";
import { DriftQuadrant, quadrantOf } from "./DriftQuadrant";

/** The five ways a map can be wrong — the matrix columns. Each resolves to a 0..100 score. */
const AXES: { key: string; label: string; score: (r: RepoContextHealth) => number }[] = [
  { key: "present", label: "Exists", score: (r) => (r.present ? 100 : 0) },
  { key: "fresh", label: "Current", score: (r) => r.potency },
  { key: "spec", label: "Specific", score: (r) => r.specificity },
  { key: "cov", label: "Covering", score: (r) => Math.round((r.coverage.covered / Math.max(1, r.coverage.total)) * 100) },
  { key: "prov", label: "Curated", score: (r) => (r.provenance === "human" ? 100 : r.provenance === "mixed" ? 55 : r.provenance === "generated" ? 15 : 0) },
];

function MatrixRow({ r }: { r: RepoContextHealth }) {
  return (
    <tr className="text-slate-300">
      <th scope="row" className="whitespace-nowrap px-4 py-2 text-left font-normal">
        {r.present ? (
          <Link href={`/report/${r.fullName}`} className="font-mono text-sm text-white hover:text-accent">
            {r.fullName}
          </Link>
        ) : (
          <span className="font-mono text-sm text-slate-400">{r.fullName}</span>
        )}
      </th>
      {AXES.map((a) => {
        const v = a.score(r);
        const cell = heatCell(v, 0.16 + (v / 100) * 0.62);
        return (
          <td key={a.key} className="px-1 py-1">
            <div
              className="rounded px-2 py-1.5 text-center font-mono text-sm tabular-nums"
              style={{ backgroundColor: cell.fill, color: cell.text }}
              title={`${r.fullName} — ${a.label}: ${v}`}
            >
              {v}
            </div>
          </td>
        );
      })}
      <td className="px-3 py-2 text-right font-mono text-sm tabular-nums" style={{ color: scoreHex(r.quality) }}>
        {r.quality}
      </td>
    </tr>
  );
}

export function ContextMapTerritory({ slug, rows }: { slug: string; rows: RepoContextHealth[] }) {
  const s = fleetContextSummary(rows);
  const sortedC = [...rows].map((r) => r.commitsPerWeek).sort((a, b) => a - b);
  const medianCommits = sortedC[Math.floor(sortedC.length / 2)] ?? 0;
  const fiction = rows.filter((r) => quadrantOf(r, medianCommits) === "fiction");
  const uncharted = rows.filter((r) => quadrantOf(r, medianCommits) === "uncharted");
  const mapped = rows.filter((r) => quadrantOf(r, medianCommits) === "mapped");
  const ordered = [...rows].sort((a, b) => a.quality - b.quality);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Map vs territory"
        description="The context layer is a map of a codebase that keeps moving. What matters is the agreement between them — and where it has broken."
        right={
          <Link
            href={orgTabHref(slug, "backlog")}
            className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Queue remapping work →
          </Link>
        }
      />

      <div className={`${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`}>
        <Tile
          label="Fiction"
          value={fiction.length}
          sub="fast-moving repos under a stale map"
          color={fiction.length ? scoreHex(15) : undefined}
          href={`#context-matrix`}
        />
        <Tile label="Uncharted" value={uncharted.length} sub="active repos with no map at all" />
        <Tile label="Well mapped" value={mapped.length} sub="fast-moving and still accurate" color={mapped.length ? scoreHex(85) : undefined} />
        <Tile label="Map/territory agreement" value={`${s.avgQuality}%`} sub="fleet mean" color={scoreHex(s.avgQuality)} />
      </div>

      <Surface tone="strong" className="p-5">
        <Kicker tone="muted">The drift plane · bubble size = commits since the map was drawn</Kicker>
        <div className="mt-3">
          {rows.length === 0 ? <InlineEmpty>No repositories in scope.</InlineEmpty> : <DriftQuadrant rows={rows} />}
        </div>
        <p className="mt-3 text-sm text-slate-400">
          {fiction.length > 0 ? (
            <>
              <span className="text-slate-200">{fiction.length} repos sit in Fiction</span> — {fiction.slice(0, 3).map((r) => r.name).join(", ")}
              {fiction.length > 3 ? ` +${fiction.length - 3} more` : ""}. Every agent run there is guided by a map the code
              has already left behind.
            </>
          ) : (
            <>No repo is moving fast under a stale map. The fleet&apos;s maps are keeping pace with its territory.</>
          )}
        </p>
      </Surface>

      <div id="context-matrix">
        <Kicker tone="muted">Five ways a map goes wrong</Kicker>
        {ordered.length === 0 ? (
          <InlineEmpty>No repositories in scope.</InlineEmpty>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-divider">
            <table className="w-full text-base" style={{ minWidth: "680px" }}>
              <caption className="sr-only">Per-repository context quality across five axes</caption>
              <thead className="bg-surface/60 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Repository</th>
                  {AXES.map((a) => (
                    <th key={a.key} scope="col" className="px-2 py-2 text-center">
                      {a.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right">Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider [&>tr]:transition-colors [&>tr:hover]:bg-surface/40">
                {ordered.slice(0, 12).map((r) => (
                  <MatrixRow key={r.fullName} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
