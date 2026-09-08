"use client";

// Variant A — "Ledger": one flat, editorial index of every practice, a single row apiece, the org's
// own standards first then the biggest mined reuse opportunity. Calm and scannable top-to-bottom; the
// whole row (and an explicit "View →" affordance) opens the shared detail modal. The space-efficient
// replacement for the old stack of full-height cards — the entire library fits on one screen.

import { OrgTable, Meter, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { StateSwatch } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import { categoryLabel, type PracticeRow } from "./practiceRows";

export function PracticeLedger({ rows, onOpen }: { rows: PracticeRow[]; onOpen: (r: PracticeRow) => void }) {
  return (
    <OrgTable
      caption="Practice library"
      minWidth={860}
      head={
        <tr className="text-left">
          <th className="px-4 py-2.5 font-normal">Practice</th>
          <th className="px-4 py-2.5 font-normal">Category</th>
          <th className="px-4 py-2.5 font-normal">Source</th>
          <th className="px-4 py-2.5 font-normal">Adoption</th>
          <th className="px-4 py-2.5 font-normal">Rollout</th>
          <th className="px-4 py-2.5 font-normal" aria-label="Actions" />
        </tr>
      }
    >
      {rows.map((r) => (
        <tr
          key={r.key}
          // The deep-link anchor four surfaces route to (`…/practices#practice-<id>`): the executive
          // briefing, plan initiatives, the overview's fix-first list and its posture dimensions.
          // (Governance's "cheapest path to green" chips were the fifth until that card was deleted
          // 2026-08-19.) Mined practices only — the emitted id is always a catalogued practice id,
          // never an authored playbook's uuid. See usePracticeHash.
          id={r.source === "mined" ? `practice-${r.id}` : undefined}
          onClick={() => onOpen(r)}
          // The affordance, not a sentence above the table telling the reader rows open: the whole
          // row lifts on hover and its "View →" takes the accent with it, and the row names its own
          // destination for anyone who hovers or reads it aloud.
          title={`Open ${r.label} — exemplar, gap repos and apply actions`}
          className="group cursor-pointer align-middle"
        >
          <td className="px-4 py-3">
            <div className="font-medium text-white">{r.label}</div>
            <div className="mt-0.5 max-w-md truncate type-body-sm text-slate-500">{r.what}</div>
          </td>
          <td className="whitespace-nowrap px-4 py-3 type-mono-sm text-slate-400">{categoryLabel(r.dimId)}</td>
          <td className="px-4 py-3">
            <SourcePill source={r.source} />
          </td>
          <td className="px-4 py-3">
            <AdoptionCell row={r} />
            {r.reachLabel && <div className="mt-1 type-caption text-slate-500">{r.reachLabel}</div>}
          </td>
          <td className="px-4 py-3">
            <RolloutCell rollout={r.rollout} />
          </td>
          <td className="px-4 py-3 text-right">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen(r);
              }}
              className="focus-ring whitespace-nowrap rounded-md border border-slate-700 px-2.5 py-1 type-mono-sm text-slate-300 transition group-hover:border-accent group-hover:text-white hover:border-accent hover:text-white"
            >
              View →
            </button>
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}

/**
 * Adoption, with the KIND of adoption on the mark rather than only its size.
 *
 * The column used to render three different facts through one grey mono readout: a measured share, a
 * declared count, and — the damaging one — a mined practice NO repository has been assessed for,
 * which arrived as the same em dash a zero would. `getOrgPractices` builds `total` only from repos
 * whose latest scan carries dimensions, so an unscanned fleet reaches this cell as `0/0`. That is now
 * `not-judged`: the hatch the kit reserves for evidence we do not have, and the state whose
 * `rendersValue` is false everywhere a number could otherwise be printed.
 */
function AdoptionCell({ row }: { row: PracticeRow }) {
  if (row.source === "mined" && (row.mined?.total ?? 0) === 0) {
    return (
      <div className="flex items-center gap-1.5">
        <StateSwatch state="not-judged" />
        <span className="type-mono-sm text-slate-500">not assessed</span>
      </div>
    );
  }
  // An authored playbook's adoption is a RECORDED APPLICATION, not an observation of the repo — the
  // dashed swatch says so beside every one of them, the way the rollout matrix's Assessed column does.
  const state = row.source === "authored" ? "declared" : "measured";
  return (
    <div className="flex items-center gap-2">
      <StateSwatch state={state} />
      {row.adoptionPct != null ? (
        <>
          <Meter
            className="w-16"
            size="sm"
            value={row.adoptionPct}
            color={scoreHex(row.adoptionPct)}
            ariaLabel={`${row.label} adoption`}
          />
          <span className="type-mono-sm tabular-nums text-slate-300">{row.adoptionLabel}</span>
        </>
      ) : (
        <span className="type-mono-sm text-slate-500">{row.adoptionLabel}</span>
      )}
    </div>
  );
}

/**
 * What this practice has PUT IN MOTION — the starter PRs the page's own apply action opened, carried
 * through the shared ImprovementPr lifecycle: in flight → landed → measured lift. Applying used to
 * leave zero trace on the row that offered it; this is the trace. Silent (an em dash) until the
 * practice has been applied at least once, so the ledger stays calm for untouched rows.
 */
function RolloutCell({ rollout }: { rollout: PracticeRow["rollout"] }) {
  if (!rollout || (rollout.open === 0 && rollout.merged === 0)) {
    return <span className="type-mono-sm text-slate-600">—</span>;
  }
  const { open, merged, lift } = rollout;
  return (
    <div className="space-y-0.5 whitespace-nowrap type-mono-sm tabular-nums">
      {open > 0 && <div className="text-accent">{open} in flight</div>}
      {merged > 0 && <div className="text-slate-300">{merged} landed</div>}
      {merged > 0 &&
        (lift != null ? (
          <div className="type-note" style={{ color: deltaHex(lift) }}>
            {fmtDelta(lift)} avg {/* the practice's own dimension, measured post-merge */}
          </div>
        ) : (
          <div className="type-note text-slate-500">awaiting rescan</div>
        ))}
    </div>
  );
}

function SourcePill({ source }: { source: PracticeRow["source"] }) {
  const authored = source === "authored";
  return (
    <span
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 type-label tracking-wider ${
        authored ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-700 bg-slate-900 text-slate-400"
      }`}
    >
      {authored ? "Authored" : "Mined"}
    </span>
  );
}
