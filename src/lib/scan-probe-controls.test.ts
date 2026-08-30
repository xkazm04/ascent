// The pure half of the control probe (moonshot #10). Two guards matter more than the rest:
//
//   • UNKNOWN IS NOT OFF — a denied protection read must produce `unmeasurable`, never a `fail`.
//     A mapper that defaults a denied read to `false` reports a repo that genuinely enforces branch
//     protection as wide open, which is the exact false negative fetchBranchGovernance returns null
//     to avoid.
//   • HEARTBEAT BOUND — 100 identical probes across 25h write 2 rows per control, not 100.

import { describe, expect, it } from "vitest";
import type { Governance } from "@/lib/types";
import type { ControlObservationRow } from "@/lib/db/control-observations";
import {
  CONTROL_IDS,
  GOVERNANCE_CONTROL_IDS,
  HEARTBEAT_AFTER_MS,
  diffSamples,
  governanceToSamples,
  postureToSamples,
  repoMetaToSamples,
} from "./scan-probe-controls";

const gov = (over: Partial<Governance> = {}): Governance => ({
  defaultBranch: "main",
  protected: true,
  requiresPullRequest: true,
  requiredApprovals: 2,
  requiresCodeOwnerReview: false,
  requiresStatusChecks: true,
  requiresSignatures: false,
  linearHistory: false,
  ruleCount: 4,
  readable: true,
  ...over,
});

function row(controlId: string, state: string, value: string | null, observedAt: string): ControlObservationRow {
  return {
    id: `o_${controlId}`,
    orgId: "org_1",
    repoId: "repo_1",
    repoFullName: "acme/api",
    controlId,
    state: state as ControlObservationRow["state"],
    value,
    prevState: null,
    prevValue: null,
    evidenceJson: "{}",
    source: "probe",
    actorLogin: null,
    transition: false,
    occurredAt: observedAt,
    observedAt,
    scanId: null,
    jobId: null,
    deliveryId: null,
    createdAt: observedAt,
  };
}

describe("unknown is not off", () => {
  it("a DENIED governance read yields the full control set as unmeasurable — no `fail` anywhere", () => {
    const samples = governanceToSamples(null);
    expect(samples.map((s) => s.controlId)).toEqual([...GOVERNANCE_CONTROL_IDS]);
    expect(samples.every((s) => s.state === "unmeasurable")).toBe(true);
    expect(samples.some((s) => s.state === "fail")).toBe(false);
    // A value we could not read is never rendered as one we did.
    expect(samples.every((s) => s.value === null)).toBe(true);
  });

  it("`readable: false` is treated exactly like a null read", () => {
    expect(governanceToSamples(gov({ readable: false })).every((s) => s.state === "unmeasurable")).toBe(true);
  });

  it("an OBSERVED-absent control is `fail` — the distinction the ledger turns on", () => {
    const samples = governanceToSamples(gov({ protected: false }));
    const bp = samples.find((s) => s.controlId === CONTROL_IDS.branchProtection);
    expect(bp).toMatchObject({ state: "fail", value: "false" });
  });

  it("a null security posture is unmeasurable, not a repo with no program", () => {
    expect(postureToSamples(null).every((s) => s.state === "unmeasurable")).toBe(true);
  });

  it("a metadata read that failed for any reason OTHER than 404 never flags the repo as gone", () => {
    const samples = repoMetaToSamples(null);
    expect(samples.find((s) => s.controlId === CONTROL_IDS.repoPresent)?.state).toBe("unmeasurable");
  });

  it("a 404 IS an observation: repo-present fails, and the rest is unmeasurable (nothing to read)", () => {
    const samples = repoMetaToSamples({ present: false, visibility: null, archived: null, defaultBranch: null });
    expect(samples.find((s) => s.controlId === CONTROL_IDS.repoPresent)).toMatchObject({ state: "fail" });
    expect(samples.filter((s) => s.state === "unmeasurable")).toHaveLength(2);
  });
});

describe("scalar controls carry their measurement in `value`", () => {
  it("required-approvals passes at 2 and records the count, so 2 → 1 is still a change", () => {
    const s = governanceToSamples(gov())!.find((x) => x.controlId === CONTROL_IDS.requiredApprovals);
    expect(s).toMatchObject({ state: "pass", value: "2" });
  });

  it("a capped advisory count is rendered as a floor (N+), never as an exact number", () => {
    const s = postureToSamples({ advisoryCount: 100, advisoryCapped: true, orgSecurityPolicy: true }).find(
      (x) => x.controlId === CONTROL_IDS.advisories,
    );
    expect(s?.value).toBe("100+");
  });

  it("visibility is a descriptor: always pass, with the fact in `value`", () => {
    const s = repoMetaToSamples({ present: true, visibility: "private", archived: false, defaultBranch: "main" }).find(
      (x) => x.controlId === CONTROL_IDS.repoVisibility,
    );
    expect(s).toMatchObject({ state: "pass", value: "private" });
  });
});

describe("diffSamples — write on change, heartbeat on silence", () => {
  const now = Date.parse("2026-08-30T12:00:00.000Z");
  const fresh = new Date(now - 60_000).toISOString();

  it("writes nothing for an unchanged, recently-seen control", () => {
    const prev = [row(CONTROL_IDS.branchProtection, "pass", "true", fresh)];
    const next = [{ controlId: CONTROL_IDS.branchProtection, state: "pass" as const, value: "true" }];
    expect(diffSamples(prev, next, HEARTBEAT_AFTER_MS, now)).toEqual([]);
  });

  it("writes a BASELINE row for a control never observed before", () => {
    const next = [{ controlId: CONTROL_IDS.branchProtection, state: "pass" as const, value: "true" }];
    expect(diffSamples([], next, HEARTBEAT_AFTER_MS, now)).toHaveLength(1);
    expect(diffSamples([], next, HEARTBEAT_AFTER_MS, now)[0]!.heartbeat).toBeUndefined();
  });

  it("writes on a VALUE-only change (approvals 2 → 1) even though both states pass", () => {
    const prev = [row(CONTROL_IDS.requiredApprovals, "pass", "2", fresh)];
    const next = [{ controlId: CONTROL_IDS.requiredApprovals, state: "pass" as const, value: "1" }];
    expect(diffSamples(prev, next, HEARTBEAT_AFTER_MS, now)).toHaveLength(1);
  });

  it("HEARTBEAT BOUND: 100 identical probes over 25h write 2 rows per control, not 100", () => {
    const control = CONTROL_IDS.branchProtection;
    const sample = { controlId: control, state: "pass" as const, value: "true" };
    let ledger: ControlObservationRow[] = [];
    let writes = 0;
    const start = Date.parse("2026-08-30T00:00:00.000Z");
    for (let i = 0; i < 100; i++) {
      const t = start + i * (25 * 3_600_000) / 100; // 100 probes spread across 25 hours
      const due = diffSamples(ledger, [sample], HEARTBEAT_AFTER_MS, t);
      if (due.length > 0) {
        writes += due.length;
        ledger = [row(control, "pass", "true", new Date(t).toISOString())];
      }
    }
    expect(writes).toBe(2); // the baseline + one heartbeat at the 24h mark
  });

  it("treats an unparseable previous stamp as DUE rather than as fresh", () => {
    const prev = [row(CONTROL_IDS.branchProtection, "pass", "true", "not-a-date")];
    const next = [{ controlId: CONTROL_IDS.branchProtection, state: "pass" as const, value: "true" }];
    const out = diffSamples(prev, next, HEARTBEAT_AFTER_MS, now);
    expect(out).toHaveLength(1);
    expect(out[0]!.heartbeat).toBe(true);
  });
});
