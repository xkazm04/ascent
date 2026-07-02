// The tech-stacks "stack × dimension" heat matrix — one dense row per auto-derived stack (overall,
// Δ vs the whole-fleet baseline, posture, scan coverage, adopt/rigor, and a heat cell per dimension)
// with the fleet baseline pinned on top. Replaces the old per-stack card grid: same summaries, ~4×
// the information density, and every row links onward — the scoped repositories view, the per-stack
// executive brief, and a one-click compare. Server-safe (links only, no hooks).

import Link from "next/link";
import { OrgTable, postureLabel, deltaHex, fmtDelta } from "@/components/org/ui";
import type { SegmentSummary } from "@/lib/db";
import { DIMENSION_SHORT, heatCell, scoreHex } from "@/lib/ui";

const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

/** One dimension heat cell — the repositories-heatmap cell treatment (score-tinted fill, computed
 *  ink) minus the modal; a stack average has no single repo detail to open. "—" when the stack has
 *  no scanned repo scoring this dimension. */
function DimCell({ name, dimId, value }: { name: string; dimId: string; value: number | undefined }) {
  if (value == null) {
    return <div className="mx-auto flex h-7 w-9 items-center justify-center font-mono text-sm text-slate-700">—</div>;
  }
  const cell = heatCell(value, 0.25 + (value / 100) * 0.75);
  return (
    <div
      className="mx-auto flex h-7 w-9 items-center justify-center rounded font-mono text-sm"
      style={{ backgroundColor: cell.fill, color: cell.text }}
      title={`${name} · ${dimShort(dimId)}: ${value}`}
    >
      {value}
    </div>
  );
}

function Row({
  org,
  s,
  fleet,
  dims,
  bKey,
}: {
  org: string;
  s: SegmentSummary;
  fleet: SegmentSummary | null;
  dims: string[];
  bKey: string | null;
}) {
  const isFleet = s.id === null;
  const byId = new Map(s.dimAverages.map((d) => [d.dimId, d.avg]));
  const stackQ = s.id ? `?stack=${encodeURIComponent(s.id)}` : "";
  const delta = fleet && !isFleet ? s.avgOverall - fleet.avgOverall : null;
  // Preserve the comparison's B side: an explicit whole-fleet selection travels as `b=fleet` (a
  // missing `b` means "default to the first other stack" on the server, not the fleet).
  const bForLink = bKey === null ? "fleet" : bKey !== s.id ? bKey : null;
  const compareHref = s.id
    ? `/org/${org}/tech-stacks?a=${encodeURIComponent(s.id)}${bForLink ? `&b=${encodeURIComponent(bForLink)}` : ""}#compare`
    : null;
  return (
    <tr className={isFleet ? "bg-surface/30" : ""}>
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal">
        {isFleet ? (
          <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Whole fleet</span>
        ) : (
          <Link href={`/org/${org}/repositories${stackQ}`} className="font-medium text-white transition hover:text-accent">
            {s.name}
          </Link>
        )}
      </th>
      <td className="px-2 py-2 text-right font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>
        {s.avgOverall}
      </td>
      {fleet && (
        <td className="px-2 py-2 text-right font-mono text-sm tabular-nums">
          {delta == null ? (
            <span className="text-slate-700">—</span>
          ) : (
            <span style={{ color: deltaHex(delta) }}>{fmtDelta(delta)}</span>
          )}
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-2 text-left text-sm text-slate-400">{postureLabel(s.posture)}</td>
      <td className="px-2 py-2 text-right font-mono text-sm tabular-nums text-slate-500">
        {s.scannedCount}/{s.repoCount}
      </td>
      <td className="px-2 py-2 text-right font-mono text-sm tabular-nums" style={{ color: scoreHex(s.avgAdoption) }}>
        {s.avgAdoption}
      </td>
      <td className="px-2 py-2 text-right font-mono text-sm tabular-nums" style={{ color: scoreHex(s.avgRigor) }}>
        {s.avgRigor}
      </td>
      {dims.map((d) => (
        <td key={d} className="px-1 py-1">
          <DimCell name={s.name} dimId={d} value={byId.get(d)} />
        </td>
      ))}
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm">
        {isFleet ? (
          <span className="text-slate-700">baseline</span>
        ) : (
          <>
            <Link href={`/org/${org}/repositories${stackQ}`} className="text-accent transition hover:text-white">repos</Link>
            <span className="text-slate-700"> · </span>
            <Link href={`/org/${org}/executive${stackQ}`} className="text-accent transition hover:text-white">brief</Link>
            <span className="text-slate-700"> · </span>
            <Link href={compareHref!} className="text-accent transition hover:text-white">compare</Link>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * The matrix. `stacks` are the per-stack summaries (ranked by the caller); `fleet` is the optional
 * whole-fleet baseline row (id null) — when present it's pinned on top and an "Δ fleet" column
 * anchors every stack against it. `bKey` is the comparison's current B side, preserved by the
 * per-row compare links so "compare" swaps A without losing B.
 */
export function StackMatrix({
  org,
  stacks,
  fleet,
  dims,
  bKey,
}: {
  org: string;
  stacks: SegmentSummary[];
  fleet: SegmentSummary | null;
  dims: string[];
  bKey: string | null;
}) {
  return (
    <OrgTable
      className="mt-3"
      minWidth={1080}
      caption="Per-stack maturity: overall score, delta versus the whole fleet, posture, scan coverage, adoption, rigor, and each dimension's average"
      head={
        <tr>
          <th scope="col" className="px-3 py-2 text-left">Stack</th>
          <th scope="col" className="px-2 py-2 text-right">Overall</th>
          {fleet && <th scope="col" className="px-2 py-2 text-right">Δ fleet</th>}
          <th scope="col" className="px-3 py-2 text-left">Posture</th>
          <th scope="col" className="px-2 py-2 text-right">Scanned</th>
          <th scope="col" className="px-2 py-2 text-right">Adopt</th>
          <th scope="col" className="px-2 py-2 text-right">Rigor</th>
          {dims.map((d) => (
            <th key={d} scope="col" className="px-1 py-2 text-center">{dimShort(d)}</th>
          ))}
          <th scope="col" className="px-3 py-2 text-right">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      }
    >
      {fleet && <Row org={org} s={fleet} fleet={fleet} dims={dims} bKey={bKey} />}
      {stacks.map((s) => (
        <Row key={s.id} org={org} s={s} fleet={fleet} dims={dims} bKey={bKey} />
      ))}
    </OrgTable>
  );
}
