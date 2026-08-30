// WHAT A LANE DID, as headlines — the deliverable list an outcome cell prints instead of raw evidence.
//
// The wave-2 sample cell read like a detector dump: two 90-character recommendation titles, then
// `D9 -42: Token permissions [posture/high]: 0/10 — 0/1 workflows…; removed SAST…` uncapped. The
// owner wants ONE short output per deliverable — "Hardened GitHub CI/CD" — several rows per project.
// This module is the pure derivation: from the agent's own `RESOLVED: <id> - <what changed>` lines,
// the lane's kind, and the ATTRIBUTABLE part of the diff. No I/O, no model — `lane-summary.ts` may
// polish the list afterwards, and falls back to exactly this when it cannot.
//
// The verdict gate is the same one the numbers answer to (maturity/attribution.ts): a lane whose pair
// is undelivered, mock, within-noise or unmeasured gets NO movement-derived headline, because a
// headline is a claim and the number behind it was already refused.

import type { LaneDeliverable, LaneDeliverableKind, LoopLaneKind } from "@/lib/db/loop-runs-types";
import type { ComparableScan } from "@/lib/db/scans";
import type { ScanDiff } from "@/lib/report/compare";
import { signalName } from "@/lib/report/compare";
import { attributeDimension, type Attribution } from "@/lib/maturity/attribution";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

export const HEADLINE_WORDS = 8;

/** One `RESOLVED: <id> - <what changed>` line, with the clause the agent wrote. */
export interface AgentClaim {
  id: string;
  what: string;
}

/**
 * The RESOLVED lines of an agent summary, WITH their "what changed" clause. `parseAgentClaims`
 * (lane-commit.ts) keeps only the ids for the trailer; this keeps the clause for the headline. Same
 * line grammar, same id tidy-up, so the two never disagree about which line is a claim.
 */
export function parseClaimLines(summary: string): AgentClaim[] {
  const out: AgentClaim[] = [];
  for (const m of summary.matchAll(/^\s*[-*\s]*RESOLVED\s*:\s*(\S+)\s*(?:[-–—:]\s*(.*))?$/gim)) {
    const id = m[1]!.replace(/^[`'"([]+/, "").replace(/[`'")\],.;:]+$/, "");
    if (!id) continue;
    out.push({ id, what: (m[2] ?? "").trim() });
  }
  return out;
}

/**
 * A clause → a headline: markdown stripped, a leading "I"/"Now"/"Also" dropped, capitalised,
 * trailing punctuation gone, at most HEADLINE_WORDS words. Null when nothing usable is left, so the
 * caller falls back to a template rather than printing an empty line.
 */
export function tidyHeadline(clause: string): string | null {
  let s = clause
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(i|i've|i have|we|now|also|then)\s+/i, "")
    .replace(/[.;:,\s]+$/, "");
  if (!s) return null;
  const words = s.split(" ");
  if (words.length > HEADLINE_WORDS) s = words.slice(0, HEADLINE_WORDS).join(" ").replace(/[,;:\-]+$/, "");
  return s[0]!.toUpperCase() + s.slice(1);
}

/** Per-dimension headline templates for an attributable movement, up and down. */
const DIM_TEMPLATES: Partial<Record<DimensionId, { up: string; down: string }>> = {
  D1: { up: "Added AI tooling conventions", down: "Regressed on AI tooling" },
  D2: { up: "Strengthened automated testing", down: "Weakened automated testing" },
  D3: { up: "Hardened CI/CD delivery", down: "Regressed on CI/CD delivery" },
  D4: { up: "Advanced agentic workflows", down: "Regressed on agentic workflows" },
  D5: { up: "Improved documentation", down: "Regressed on documentation" },
  D6: { up: "Tightened code quality guardrails", down: "Loosened code quality guardrails" },
  D7: { up: "Improved commit hygiene", down: "Regressed on commit signals" },
  D8: { up: "Added agent-readable docs", down: "Regressed on AI process" },
  D9: { up: "Hardened CI/CD security", down: "Regressed on security posture" },
};

const dimLabel = (id: DimensionId): string => DIMENSIONS.find((d) => d.id === id)?.name ?? id;

/** The headline for a dimension movement — the template, or "Improved/Regressed on <label>". */
export function movementHeadline(dimId: DimensionId, up: boolean): string {
  const t = DIM_TEMPLATES[dimId];
  if (t) return up ? t.up : t.down;
  return up ? `Improved ${dimLabel(dimId)}` : `Regressed on ${dimLabel(dimId)}`;
}

export interface DeriveLaneDeliverablesInput {
  kind: LoopLaneKind;
  /** The agent's RESOLVED lines (empty on a deterministic lane, and on a backfill from a row that
   *  never stored its summary). */
  agentClaims: readonly AgentClaim[];
  diff: ScanDiff | null;
  before: ComparableScan | null;
  after: ComparableScan | null;
  /** The lane's pair verdict (`attributeDelivered`). Movement headlines are emitted ONLY when it is
   *  attributable. */
  verdict: Attribution;
  practiceName?: string | null;
  /** Ids the rescan closed by trailer/restatement — `closed` headlines even without a claim line. */
  closedFollowUpIds?: readonly string[];
}

/** Deterministic, pure. See the module header for the four sources and the gate. */
export function deriveLaneDeliverables(input: DeriveLaneDeliverablesInput): LaneDeliverable[] {
  const { diff, before, after } = input;
  const recs = new Map<string, { title: string; dimId: DimensionId | null }>();
  for (const r of [...(after?.recommendations ?? []), ...(before?.recommendations ?? [])]) {
    if (!recs.has(r.id)) recs.set(r.id, { title: r.title, dimId: (r.dimId as DimensionId) || null });
  }
  const out: LaneDeliverable[] = [];
  // ONE ROW = ONE GAP (owner's wave-2 correction). A `closed` deliverable is keyed by the follow-up
  // id it covers, so two gaps that happen to share a TEMPLATED headline stay two rows — the template
  // is our word, not the agent's, and the user needs control over each individual gap.
  //
  // ONE EXCEPTION, and it is the reason `byHeadline` exists: a headline the AGENT ITSELF wrote for
  // two different ids. A real run rendered "Added gating evidence to agent review" TWICE, because two
  // covered ids produced the same clause. That is not two deliverables — the agent described one
  // piece of work and attributed it to both items — and printing it twice reads as a padded ledger.
  // Those merge into one row that CARRIES BOTH IDS in `covers`: the sheet keys rows by the first
  // cover, so dropping the second id would drop a gap off the review surface entirely.
  // The headline key deliberately ignores `dimId`: the same sentence written by the same session IS
  // the same deliverable, and two ids that resolved together are frequently only in the same
  // dimension by accident of how the scan filed them. The merged row keeps the first row's dimension
  // and evidence line, and every id in `covers`.
  const keyOf = (d: LaneDeliverable, byHeadline: boolean) =>
    d.kind === "closed" && d.covers.length > 0 && !byHeadline
      ? `id|${d.covers[0]}`
      : byHeadline
        ? `said|${d.kind}|${d.headline.toLowerCase()}`
        : `${d.kind}|${d.dimId ?? ""}|${d.headline.toLowerCase()}`;
  const push = (d: LaneDeliverable, byHeadline = false) => {
    const key = keyOf(d, byHeadline);
    const dup = out.find((x) => keyOf(x, byHeadline) === key);
    if (dup) {
      dup.covers = [...new Set([...dup.covers, ...d.covers])];
      dup.evidence = dup.evidence ?? d.evidence;
      return;
    }
    out.push(d);
  };

  // 1. The agent's own claims: the clause IS the headline.
  const claimed = new Set<string>();
  for (const c of input.agentClaims) {
    const rec = recs.get(c.id);
    // `written` = the agent's own clause survived tidying. Only those merge by headline; the template
    // fallback below is OUR sentence, so two ids falling back to it stay two rows.
    const written = tidyHeadline(c.what);
    const headline = written ?? (rec?.dimId ? movementHeadline(rec.dimId, true) : null);
    if (!headline) continue;
    claimed.add(c.id);
    push(
      { headline, dimId: rec?.dimId ?? null, kind: "closed", covers: [c.id], evidence: rec?.title ?? null },
      written != null,
    );
  }
  // 1b. Closes the rescan confirmed without a clause on file (a backfill, or a trailer-only session):
  // the dimension's template stands in. Each id keeps its own row — the evidence line (the follow-up
  // title) is what tells two same-dimension closes apart.
  const confirmed = [...(input.closedFollowUpIds ?? []), ...(diff?.recsMovedToDone.map((r) => r.id) ?? [])];
  for (const id of confirmed) {
    if (claimed.has(id)) continue;
    const rec = recs.get(id) ?? (diff?.recsMovedToDone.find((r) => r.id === id) ? { title: diff!.recsMovedToDone.find((r) => r.id === id)!.title, dimId: diff!.recsMovedToDone.find((r) => r.id === id)!.dimId } : null);
    if (!rec) continue;
    claimed.add(id);
    push({
      headline: rec.dimId ? movementHeadline(rec.dimId, true) : "Closed a follow-up",
      dimId: rec.dimId,
      kind: "closed",
      covers: [id],
      evidence: rec.title,
    });
  }

  // 2. The deterministic lanes name their install.
  if (input.kind === "foundation") push({ headline: "Installed the .ai/ foundation", dimId: null, kind: "installed", covers: [], evidence: null });
  if (input.kind === "practice") {
    push({ headline: tidyHeadline(`Installed ${input.practiceName ?? "practice"} starter`) ?? "Installed practice starter", dimId: null, kind: "installed", covers: [], evidence: null });
  }

  // 3. Attributable movements not already covered by a close — the gate is the verdict.
  if (diff && input.verdict.kind === "attributable") {
    const covered = new Set(out.map((d) => d.dimId).filter((x): x is DimensionId => x != null));
    const moved = [...diff.dimensions]
      .filter((d) => d.delta != null && d.delta !== 0 && !covered.has(d.id))
      .sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
    for (const d of moved) {
      if (attributeDimension(d.id, d.delta, before, after).kind !== "attributable") continue;
      const up = (d.delta as number) > 0;
      const kind: LaneDeliverableKind = up ? "hardened" : "regressed";
      const names = [...new Set([...d.appearedSignals, ...d.disappearedSignals].map(signalName))].slice(0, 6);
      push({ headline: movementHeadline(d.id, up), dimId: d.id, kind, covers: names, evidence: d.attribution });
    }
  }

  // NO CAP: every resolved gap keeps its own deliverable. The cell scrolls; it does not condense —
  // condensing many gaps into one high-level note removes the per-gap control the review gate needs.
  return out;
}
