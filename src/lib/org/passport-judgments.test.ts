// The contract of the ONE passport judgment model (card ai-native-passports#A, challenge-2026-09-23).
//
// A passport blocker's human judgment lives in two ledgers — an owner's overlay decline
// (Repository.passportOverridesJson.declined) and a member's OrgDecision (module "passports") — and
// four readers used to re-derive "is this blocker decided?" each in their own way: the drawer, the
// rail badge, the fleet Pareto and its issue draft. These pin the two things every reader now shares:
// the KEY (a durable minted id, else the prose hash) and the STATE, under one fixed precedence:
// overlay reconfirm > overlay decline > OrgDecision > open.

import { describe, it, expect } from "vitest";
import type { DecisionMap } from "@/lib/org/decision-map";
import type { DeclinedByChoice } from "@/lib/types";
import { blockerKey } from "@/lib/org/findings";
import {
  isDurableFindingId,
  judgeFinding,
  passportJudgmentKey,
  passportJudgmentKeys,
} from "@/lib/org/passport-judgments";

const SV_ID = "auto.self-verify-gaps";
const SV_OLD = "Agent can't self-verify: missing build, lint script(s).";
const SV_NEW = "Agent can't self-verify: missing build script(s).";

const CI = { id: "prod.ci-not-gating", code: "ci-not-gating", text: "CI does not gate merges (no enforced required checks)." };

const decline = (over: Partial<DeclinedByChoice> = {}): DeclinedByChoice => ({
  path: "productionReadiness.ci",
  label: "CI merge gating",
  reason: "docs mirror",
  blocker: CI.text,
  findingId: CI.id,
  at: "2026-09-01",
  by: "alice",
  ...over,
});

describe("passportJudgmentKey — one key per blocker", () => {
  it("keys a durable minted id on the id, for ANY wording of the sentence", () => {
    expect(passportJudgmentKey("acme/api", { id: SV_ID, text: SV_OLD })).toBe("acme/api::auto.self-verify-gaps");
    expect(passportJudgmentKey("acme/api", { id: SV_ID, text: SV_NEW })).toBe("acme/api::auto.self-verify-gaps");
    expect(passportJudgmentKey("acme/api", { id: SV_ID, text: "anything at all" })).toBe("acme/api::auto.self-verify-gaps");
  });

  it("never keys a decision on a non-durable migrated id — `unclassified` falls back to the prose hash", () => {
    const t = "Some pre-0.4.0 sentence no classifier recognises.";
    expect(passportJudgmentKey("acme/api", { id: "auto.unclassified.2", text: t })).toBe(blockerKey("acme/api", t));
    expect(isDurableFindingId("auto.unclassified.2")).toBe(false);
    expect(isDurableFindingId(SV_ID)).toBe(true);
  });

  it("guard: a pre-0.4.0 blocker with no id keeps the legacy prose key", () => {
    expect(passportJudgmentKey("acme/api", { text: "No CI pipeline" })).toBe(blockerKey("acme/api", "No CI pipeline"));
    expect(passportJudgmentKeys("acme/api", { text: "No CI pipeline" })).toEqual([blockerKey("acme/api", "No CI pipeline")]);
  });

  it("read keys are [write key, legacy prose alias] for a durable id — the alias is never the write key", () => {
    expect(passportJudgmentKeys("acme/api", { id: SV_ID, text: SV_NEW })).toEqual([
      "acme/api::auto.self-verify-gaps",
      blockerKey("acme/api", SV_NEW),
    ]);
  });
});

describe("judgeFinding — one state, fixed precedence", () => {
  it("an overlay decline that needs re-confirming beats a member's OrgDecision under the same key: state 'reconfirm' (open)", () => {
    const decisions: DecisionMap = { "acme/web::prod.ci-not-gating": { status: "dismissed", rationale: "n/a", decidedBy: "bob" } };
    const j = judgeFinding({
      fullName: "acme/web",
      finding: CI,
      declined: [decline({ needsReconfirm: true, reconfirmReason: "hardened" })],
      decisions,
    });
    expect(j?.state).toBe("reconfirm");
    expect(j?.open).toBe(true);
    expect(j?.key).toBe("acme/web::prod.ci-not-gating");
  });

  it("a standing overlay decline reads 'declined', with its author and reason", () => {
    const j = judgeFinding({ fullName: "acme/web", finding: CI, declined: [decline()], decisions: {} });
    expect(j).toMatchObject({ state: "declined", open: false, by: "alice", reason: "docs mirror", source: "overlay" });
  });

  it("an OrgDecision resolves the finding when no overlay decline speaks for it", () => {
    const decisions: DecisionMap = { "acme/web::prod.ci-not-gating": { status: "dismissed", rationale: "docs mirror", decidedBy: "bob" } };
    expect(judgeFinding({ fullName: "acme/web", finding: CI, decisions })).toMatchObject({
      state: "dismissed",
      open: false,
      by: "bob",
      reason: "docs mirror",
      source: "decision",
    });
  });

  it("an OrgDecision stored under the legacy prose key still resolves a durable-id finding (read-only alias)", () => {
    const decisions: DecisionMap = { [blockerKey("acme/web", CI.text)]: { status: "accepted", rationale: "", decidedBy: "bob" } };
    expect(judgeFinding({ fullName: "acme/web", finding: CI, decisions })?.state).toBe("accepted");
  });

  it("an expired snooze (decisionMap collapsed it to 'open') is OPEN", () => {
    const decisions: DecisionMap = { "acme/web::prod.ci-not-gating": { status: "open", rationale: "later", decidedBy: "bob" } };
    const j = judgeFinding({ fullName: "acme/web", finding: CI, decisions });
    expect(j?.state).toBe("open");
    expect(j?.open).toBe(true);
  });

  it("an undecided finding is open", () => {
    expect(judgeFinding({ fullName: "acme/web", finding: CI })).toMatchObject({ state: "open", open: true, source: null });
  });

  it("guard: a coverage hole gets no judgment at all — no key, no control, no bucket", () => {
    const holes = [
      { id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed." },
      { id: "prod.enforcement-not-observable", code: "enforcement-not-observable", text: "Enforcement (branch protection) not observable." },
      { id: "auto.self-verify-unassessable", code: "self-verify-unassessable", text: "Self-verify could not be assessed." },
    ];
    for (const f of holes) expect(judgeFinding({ fullName: "acme/web", finding: f })).toBeNull();
  });
});
