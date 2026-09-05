// THE EXECUTORS — what they refuse, and the fact that refusing is an OUTCOME rather than a throw.
//
// The load-bearing assertions here are the two the brief's acceptance criteria name directly:
//
//   • a refusal inside execute RETURNS an outcome; it does not throw (a throw releases the claim and
//     500s the operator, so mislabelling a refusal as a failure would make a settled "no" look like an
//     outage the operator should retry);
//   • a foreign id refuses the WHOLE action rather than being skipped alongside the ones that worked —
//     a per-id skip is an oracle a caller can use to enumerate other tenants' ids.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(() => true),
  findMany: vi.fn(async () => [] as { id: string; status: string }[]),
  getRecommendationOrgSlug: vi.fn(async (id: string) => (id ? "acme" : null) as string | null),
  updateRecommendation: vi.fn(async () => null),
  decide: vi.fn(async () => ({ id: "d1", memoryId: "m1" }) as { id: string; memoryId: string | null } | null),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: h.isDbConfigured,
  getPrisma: () => ({ recommendation: { findMany: h.findMany } }),
}));
vi.mock("@/lib/db/scans-recommendations", () => ({
  getRecommendationOrgSlug: h.getRecommendationOrgSlug,
  updateRecommendation: h.updateRecommendation,
}));
vi.mock("@/lib/db/org-decisions", () => ({
  decide: h.decide,
  isDecisionModule: (v: string) =>
    ["security", "teams", "passports", "contributors", "roadmap", "athena"].includes(v),
}));

import { executeAthenaAction, type AthenaActionContext } from "@/lib/athena/actions-execute";
import type { AthenaAction } from "@/lib/athena/actions";

const ctx: AthenaActionContext = { org: "acme", orgId: "org-1", actor: "dev" };
const act = (id: AthenaAction["id"], params: AthenaAction["params"]): AthenaAction => ({ id, params });

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.getRecommendationOrgSlug.mockResolvedValue("acme");
  h.decide.mockResolvedValue({ id: "d1", memoryId: "m1" });
});

describe("handoff_followups", () => {
  it("claims open items and never reopens a closed one", async () => {
    h.findMany.mockResolvedValue([
      { id: "a", status: "open" },
      { id: "b", status: "done" },
      { id: "c", status: "dismissed" },
      { id: "d", status: "in_progress" },
    ]);
    const out = await executeAthenaAction(act("handoff_followups", { ids: ["a", "b", "c", "d"] }), ctx);
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("handed_off");
    expect(out.data?.marked).toEqual(["a"]);
    expect(out.data?.skipped).toEqual([
      { id: "b", status: "done" },
      { id: "c", status: "dismissed" },
      { id: "d", status: "in_progress" },
    ]);
    expect(h.updateRecommendation).toHaveBeenCalledTimes(1);
    expect(h.updateRecommendation).toHaveBeenCalledWith("a", { status: "in_progress" }, expect.objectContaining({ actor: "dev" }));
  });

  it("REFUSES THE WHOLE ACTION on one foreign id, and touches nothing", async () => {
    h.getRecommendationOrgSlug.mockImplementation(async (id: string) => (id === "x" ? "other-org" : "acme"));
    const out = await executeAthenaAction(act("handoff_followups", { ids: ["a", "x"] }), ctx);
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("refused");
    // No partial success to compare against: a caller cannot learn whether "x" exists anywhere.
    expect(out.data).toBeUndefined();
    expect(h.updateRecommendation).not.toHaveBeenCalled();
  });

  it("refuses an id that resolves to no org at all", async () => {
    h.getRecommendationOrgSlug.mockResolvedValue(null);
    const out = await executeAthenaAction(act("handoff_followups", { ids: ["ghost"] }), ctx);
    expect(out).toMatchObject({ ok: false, kind: "refused" });
    expect(h.updateRecommendation).not.toHaveBeenCalled();
  });

  it("returns a refusal — NOT a throw — when every item had already moved on", async () => {
    h.findMany.mockResolvedValue([{ id: "a", status: "done" }]);
    const out = await executeAthenaAction(act("handoff_followups", { ids: ["a"] }), ctx);
    expect(out.ok).toBe(false);
    expect(out.kind).toBe("refused");
    expect(out.data?.skipped).toEqual([{ id: "a", status: "done" }]);
  });

  it("refuses a batch past the ceiling before reading anything", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `r${i}`);
    const out = await executeAthenaAction(act("handoff_followups", { ids }), ctx);
    expect(out).toMatchObject({ ok: false, kind: "refused" });
    expect(h.getRecommendationOrgSlug).not.toHaveBeenCalled();
  });
});

describe("rule_on_finding", () => {
  const base = { module: "security", itemKey: "acme/api::bp", ruling: "dismissed", rationale: "mirror of upstream" };

  it("records the ruling through decide() — one store, not a second one", async () => {
    const out = await executeAthenaAction(act("rule_on_finding", base), ctx);
    expect(out).toMatchObject({ ok: true, kind: "ruled" });
    expect(h.decide).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ module: "security", itemKey: "acme/api::bp", status: "dismissed", rationale: "mirror of upstream" }),
      "dev",
    );
    expect(out.data).toMatchObject({ decisionId: "d1", memoryId: "m1" });
  });

  it("accepts the athena module — her own findings land in the SAME decision store", async () => {
    const out = await executeAthenaAction(act("rule_on_finding", { ...base, module: "athena" }), ctx);
    expect(out.ok).toBe(true);
    expect(h.decide).toHaveBeenCalledWith("acme", expect.objectContaining({ module: "athena" }), "dev");
  });

  it("refuses a snooze with no future date, and records nothing", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    for (const params of [
      { ...base, ruling: "snoozed" },
      { ...base, ruling: "snoozed", snoozedUntil: past },
      { ...base, ruling: "snoozed", snoozedUntil: "not-a-date" },
    ]) {
      const out = await executeAthenaAction(act("rule_on_finding", params), ctx);
      expect(out).toMatchObject({ ok: false, kind: "refused" });
    }
    expect(h.decide).not.toHaveBeenCalled();
  });

  it("passes a future snooze date through", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const out = await executeAthenaAction(act("rule_on_finding", { ...base, ruling: "snoozed", snoozedUntil: future }), ctx);
    expect(out.ok).toBe(true);
    expect(h.decide).toHaveBeenCalledWith("acme", expect.objectContaining({ snoozedUntil: new Date(future) }), "dev");
  });

  it("refuses a module the STORE does not recognise, even if it got past the catalog", async () => {
    const out = await executeAthenaAction(act("rule_on_finding", { ...base, module: "invented" }), ctx);
    expect(out).toMatchObject({ ok: false, kind: "refused" });
    expect(h.decide).not.toHaveBeenCalled();
  });

  it("refuses when decide() cannot record it, rather than reporting a success", async () => {
    h.decide.mockResolvedValue(null);
    const out = await executeAthenaAction(act("rule_on_finding", base), ctx);
    expect(out).toMatchObject({ ok: false, kind: "refused" });
  });

  it("says so when memory is unavailable rather than claiming it was published", async () => {
    h.decide.mockResolvedValue({ id: "d1", memoryId: null });
    const out = await executeAthenaAction(act("rule_on_finding", base), ctx);
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("memory is not available");
  });
});

describe("the executor table is the dispatch, and it fails safe", () => {
  it("returns a retired outcome for an id with no executor instead of throwing", async () => {
    const out = await executeAthenaAction({ id: "gone" as AthenaAction["id"], params: {} }, ctx);
    expect(out).toMatchObject({ ok: false, kind: "retired" });
  });

  it("refuses (does not throw) with no database", async () => {
    h.isDbConfigured.mockReturnValue(false);
    await expect(executeAthenaAction(act("handoff_followups", { ids: ["a"] }), ctx)).resolves.toMatchObject({ ok: false });
    await expect(
      executeAthenaAction(act("rule_on_finding", { module: "security", itemKey: "k", ruling: "dismissed", rationale: "r" }), ctx),
    ).resolves.toMatchObject({ ok: false });
  });
});
