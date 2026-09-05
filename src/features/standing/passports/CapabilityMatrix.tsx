// #13 — Standing › Passports › Capabilities: the fleet's declared-vs-proven-vs-wired matrix.
//
// The view every competitor's dashboard cannot give, because it scores a repo against the VENDOR's
// criteria: this scores each repo against its OWN declared contract (`.ai/manifest.yaml`) and shows
// which of those declarations its own doctor has actually proven.
//
// The layout is deliberately two-part. The table is repos whose contract was read. Everything else —
// a repo scanned before the readout shipped, or one whose manifest could not be parsed — sits in a
// separate band BELOW, out of every denominator. A single table with "0/0" rows would make "we have
// not looked" indistinguishable from "declares nothing", and the whole point of the surface is that
// those are different answers to a CISO's question.

import { OrgTable, Tile, TILE_LEDGER, MeterRow } from "@/components/org/shared/ui";
import { Kicker, SectionHeading } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { buildCapabilityMatrix, verifiedRatio, type CapabilityMatrixInput } from "./capabilityAgg";
import { CapabilityMatrixLegend } from "./CapabilityMatrixLegend";
import { CapabilityMatrixRowView } from "./CapabilityMatrixRowView";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

export function CapabilityMatrix({ repos, rollout = [] }: { repos: CapabilityMatrixInput[]; rollout?: FoundationRolloutRow[] }) {
  const matrix = buildCapabilityMatrix(repos);
  const ratio = verifiedRatio(matrix);
  // Spec #35 handoff 2's promised column. Keyed lower-case because the audit-derived rollout rows and
  // the rollup's `fullName` come from two different writes of the same name.
  const rolloutByRepo = new Map(rollout.map((r) => [r.repo.toLowerCase(), r]));

  return (
    <section className="space-y-6">
      <div>
        <Kicker>declared vs proven</Kicker>
        <SectionHeading
          title="Capabilities"
          intro="Every repository against its OWN .ai/manifest.yaml: what it declares it can do, what its doctor has proven, and where each control is enforced."
        />
      </div>

      <div className={`${TILE_LEDGER} sm:grid-cols-3`}>
        <Tile label="Repos assessed" value={matrix.totals.repos} sub={`${matrix.unassessed.length} not assessed`} />
        <Tile
          label="Capabilities proven"
          value={ratio === null ? "—" : `${matrix.totals.verified}/${matrix.totals.declared}`}
          sub={ratio === null ? "no manifest read yet" : `${ratio}% of what the fleet declares`}
          color={ratio === null ? undefined : scoreHex(ratio)}
        />
        <Tile label="Declarations with a control" value={matrix.totals.wired} sub="pre-push or CI hard pass" />
      </div>

      {ratio !== null && (
        <MeterRow layout="labelled" value={ratio} display={`${ratio}%`} label="proven of declared" color={scoreHex(ratio)} />
      )}

      {matrix.rows.length === 0 ? (
        <p className="type-body text-slate-400">
          No repository in this view has had its <code>.ai/manifest.yaml</code> read yet. Re-scan a repository that
          carries one and it appears here — nothing is inferred in the meantime.
        </p>
      ) : (
        <OrgTable
          caption="Repositories by declared capability"
          minWidth={660 + matrix.capabilities.length * 72}
          head={
            <tr>
              <th className="px-4 py-3 text-left">Repository</th>
              {matrix.capabilities.map((c) => (
                <th key={c} className="px-3 py-3 text-center font-mono">
                  {c}
                </th>
              ))}
              <th className="px-4 py-3 text-right">Proven</th>
              {/* The cross-link, not a fourth catalogue: what this repo REPORTS BACK, so "where is
                  the standard in, and where is it proving itself?" stops being a three-tab join. */}
              <th className="px-4 py-3 text-left">Report-back</th>
              <th className="px-4 py-3 text-left">Declared</th>
            </tr>
          }
        >
          {matrix.rows.map((row) => (
            <CapabilityMatrixRowView
              key={row.fullName}
              row={row}
              capabilities={matrix.capabilities}
              rollout={rolloutByRepo.get(row.fullName.toLowerCase())}
            />
          ))}
        </OrgTable>
      )}

      <CapabilityMatrixLegend unassessed={matrix.unassessed.length} />

      {matrix.unassessed.length > 0 && (
        <div className="rounded-2xl border border-dashed border-divider p-5">
          <p className="type-label tracking-[0.2em] text-slate-500">not assessed — re-scan</p>
          <p className="mt-2 type-body-sm text-slate-400">
            These repositories are counted in no ratio above. Their latest scan did not read a manifest, so the honest
            statement is that we do not know what they declare — not that they declare nothing.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 type-body-sm text-slate-300">
            {matrix.unassessed.map((u) => (
              <li key={u.fullName} className="type-caption">
                {u.fullName}
                <span className="ml-1.5 text-slate-500">
                  ({u.reason === "unreadable" ? "manifest unreadable" : "no manifest in this scan"})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
