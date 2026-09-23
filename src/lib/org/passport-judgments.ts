// The ONE judgment model for a passport finding: one key, one read.
//
// A passport blocker can carry a human judgment in two ledgers, written through different doors:
//   - an OWNER's decline ("we accept this gap") in Repository.passportOverridesJson.declined, keyed by
//     field path and joined to its finding by minted id — PATCH /api/report/passport/overrides;
//   - a MEMBER's OrgDecision (module "passports": accepted / dismissed / snoozed) keyed by the finding's
//     itemKey — POST /api/org/decision.
// Four surfaces ask "is this blocker decided?": the drawer's BlockerList, the rail badge, the fleet
// Pareto and its issue draft. Each used to answer on its own, with its own key scheme, and they
// disagreed (the badge re-counted a dismissed blocker once its sentence changed; the Pareto filed an
// issue against a team that had dismissed the gap; the drawer buried a re-surfaced decline behind a
// member's greyed "Dismissed" pill). Every one of them now asks this module.
//
// THE KEY. A durable minted id (`auto.self-verify-gaps`) is the identity — the cause, not the sentence
// that described it on decision day. A blocker with no id, or with the POSITIONAL `*.unclassified.<i>`
// id `upgradePassport` back-fills for a stored sentence it cannot classify (passport-migrate.ts calls
// that id non-durable: it moves when the list changes), keys on a hash of its normalized prose instead.
// The prose key of a durable-id blocker survives only as a READ-ONLY alias, so a decision recorded
// before minted ids keeps resolving; nothing is ever written under it.
//
// THE STATE, under one fixed precedence:
//   overlay reconfirm > overlay decline > OrgDecision > open
// An owner's decline outranks a member's decision because it is the stronger, owner-gated judgment —
// and a decline the overlay RE-SURFACED (kind changed, severity rose, aged out) is the one state that
// must stay in front of the reader, so it outranks everything and reads as open.
//
// A COVERAGE HOLE (`*-unassessable`, `enforcement-not-observable`) is a limit of the scan's evidence,
// not a gap in the app: it gets no judgment at all — no key, no control, no bucket.
//
// Pure and framework-free: no Prisma, no React. `findings.ts` re-exports the key primitives from here so
// the derived-finding builders and their callers keep one import path.

import { isCoverageHoleFinding, isCoverageHoleText } from "@/lib/analyze/passport";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { DeclinedByChoice } from "@/lib/types";

/**
 * FNV-1a, 32-bit, hex. Used only where a passport finding has no durable id of its own. Not a security
 * hash — it needs to be fast, dependency-free and identical on every run. Collisions are scoped to one
 * repo's blocker list, where a handful of strings makes them negligible.
 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Normalize blocker prose before hashing or matching, so whitespace/case churn doesn't rotate a key. */
export function stableBlockerText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The prose key: repo + a hash of the normalized sentence. The identity of a blocker with no durable
 *  id, and a read-only alias for one that has one. Never the write key for a durable-id blocker. */
export function blockerKey(fullName: string, blocker: string): string {
  return `${fullName}::${fnv1a(stableBlockerText(blocker))}`;
}

/** The id key: repo + the minted finding id. Rewording the sentence leaves it untouched. */
export function findingItemKey(fullName: string, findingId: string): string {
  return `${fullName}::${findingId}`;
}

/** True for a minted id a judgment may be keyed on. False for no id and for a positional
 *  `<axis>.unclassified.<i>` back-fill id, which moves whenever the stored blocker list changes. */
export function isDurableFindingId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && !/^[^.]+\.unclassified(\.|$)/.test(id);
}

/** The narrow shape a judgment needs: a minted id when there is one, and the rendered sentence. */
export interface JudgeableFinding {
  id?: string | null;
  code?: string;
  text: string;
}

/** THE key a judgment on this finding is written under. */
export function passportJudgmentKey(fullName: string, finding: JudgeableFinding): string {
  return isDurableFindingId(finding.id) ? findingItemKey(fullName, finding.id) : blockerKey(fullName, finding.text);
}

/** Every key a judgment on this finding may be READ from, newest first. `[0]` is the write key; the
 *  rest are read-only aliases (the prose key a durable-id blocker was decided under before minted ids).
 *  CLEANUP: the alias is dead weight once every pre-Direction-8 passport decision has been re-decided
 *  or aged out — after 2027-03-01, return `[passportJudgmentKey(...)]` and delete the title alias in
 *  `resolvedKeys` (src/lib/db/org-decisions.ts). */
export function passportJudgmentKeys(fullName: string, finding: JudgeableFinding): string[] {
  const key = passportJudgmentKey(fullName, finding);
  return isDurableFindingId(finding.id) ? [key, blockerKey(fullName, finding.text)] : [key];
}

export type PassportJudgmentState = "open" | "reconfirm" | "declined" | "dismissed" | "accepted" | "snoozed";

export interface PassportJudgment {
  /** The write key — what a DecisionControl records under. */
  key: string;
  state: PassportJudgmentState;
  /** True for `open` and `reconfirm`: the finding still asks for a human. */
  open: boolean;
  /** Which ledger decided it, or null when nobody has. */
  source: "overlay" | "decision" | null;
  by: string | null;
  /** The owner's decline reason, the member's rationale, or the overlay's re-confirmation sentence. */
  reason: string | null;
}

/** Is this finding a limit of the scan's evidence rather than a gap in the app? */
function isCoverageHole(finding: JudgeableFinding): boolean {
  if (finding.id) {
    const code = finding.code ?? finding.id.slice(finding.id.indexOf(".") + 1);
    return isCoverageHoleFinding({ id: finding.id, code });
  }
  return isCoverageHoleText(finding.text);
}

/**
 * The one answer to "is this passport finding decided?". Null for a coverage hole, which is never a
 * decidable finding. `decisions` is a `decisionMap` view, which has already collapsed an expired snooze
 * to "open" — so an expired snooze reads open here too.
 */
export function judgeFinding(input: {
  fullName: string;
  finding: JudgeableFinding;
  declined?: readonly DeclinedByChoice[] | null;
  decisions?: DecisionMap | null;
}): PassportJudgment | null {
  const { fullName, finding } = input;
  if (isCoverageHole(finding)) return null;
  const keys = passportJudgmentKeys(fullName, finding);
  const key = keys[0]!;

  // The overlay joins a decline to its finding by minted id only — never by prose (the join 0.4.0
  // removed), and never on a non-durable id.
  const decline = isDurableFindingId(finding.id) ? input.declined?.find((d) => d.findingId === finding.id) : undefined;
  if (decline?.needsReconfirm) {
    return { key, state: "reconfirm", open: true, source: "overlay", by: decline.by ?? null, reason: decline.reconfirmReason ?? null };
  }
  if (decline) {
    return { key, state: "declined", open: false, source: "overlay", by: decline.by ?? null, reason: decline.reason ?? null };
  }

  const decisions = input.decisions ?? {};
  const decision = keys.map((k) => decisions[k]).find(Boolean);
  if (decision && decision.status !== "open") {
    return { key, state: decision.status, open: false, source: "decision", by: decision.decidedBy, reason: decision.rationale || null };
  }
  return { key, state: "open", open: true, source: null, by: null, reason: null };
}
