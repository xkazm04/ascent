// The observation ledger's write contract (moonshot #10) — the part W3-M builds its read side on:
//
//   • a FIRST observation is a baseline, never a transition (otherwise every newly-probed repo fires
//     13 "changes" the first time we look at it);
//   • a heartbeat re-assertion is never a transition;
//   • a real change — of state OR of value — is;
//   • `prevState`/`prevValue` always name what the row superseded, so the chain is walkable;
//   • an `unmeasurable` row is written as itself and never collapsed into `fail`.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { listObservationsSince, recordObservations } from "./control-observations";

beforeEach(() => {
  mockIsDbConfigured.mockReset().mockReturnValue(true);
  mockGetPrisma.mockReset();
  mockGetOrgId.mockReset().mockResolvedValue("org_1");
});

function prismaWith(prev: Record<string, unknown>[]) {
  const create = vi.fn(async () => ({}));
  const findMany = vi.fn(async () => prev);
  mockGetPrisma.mockReturnValue({ controlObservation: { create, findMany } });
  return { create, findMany };
}

const prevRow = (controlId: string, state: string, value: string | null) => ({
  id: "o1",
  orgId: "org_1",
  repoId: "repo_1",
  repoFullName: "acme/api",
  controlId,
  state,
  value,
  prevState: null,
  prevValue: null,
  evidenceJson: "{}",
  source: "probe",
  actorLogin: null,
  transition: false,
  occurredAt: new Date("2026-08-29T00:00:00.000Z"),
  observedAt: new Date("2026-08-29T00:00:00.000Z"),
  scanId: null,
  jobId: null,
  deliveryId: null,
  createdAt: new Date("2026-08-29T00:00:00.000Z"),
});

const ctx = { repoFullName: "acme/api", source: "probe" as const, jobId: "job_1" };

describe("transition semantics", () => {
  it("a FIRST observation lands with transition:false — a baseline is not a change", async () => {
    const { create } = prismaWith([]);
    const res = await recordObservations("acme", "repo_1", [{ controlId: "branch-protection", state: "pass", value: "true" }], ctx);

    expect(res).toEqual({ written: 1, transitions: 0 });
    const data = create.mock.calls[0]![0].data;
    expect(data.transition).toBe(false);
    expect(data.prevState).toBeNull();
  });

  it("a real state change is a transition, and names what it superseded", async () => {
    const { create } = prismaWith([prevRow("branch-protection", "pass", "true")]);
    const res = await recordObservations("acme", "repo_1", [{ controlId: "branch-protection", state: "fail", value: "false" }], ctx);

    expect(res).toEqual({ written: 1, transitions: 1 });
    expect(create.mock.calls[0]![0].data).toMatchObject({ transition: true, prevState: "pass", prevValue: "true" });
  });

  it("a VALUE-only change (approvals 2 → 1) is a transition too", async () => {
    const { create } = prismaWith([prevRow("required-approvals", "pass", "2")]);
    const res = await recordObservations("acme", "repo_1", [{ controlId: "required-approvals", state: "pass", value: "1" }], ctx);
    expect(res.transitions).toBe(1);
    expect(create.mock.calls[0]![0].data.prevValue).toBe("2");
  });

  it("a HEARTBEAT re-assertion is written but is never alertable", async () => {
    const { create } = prismaWith([prevRow("branch-protection", "pass", "true")]);
    const res = await recordObservations(
      "acme",
      "repo_1",
      [{ controlId: "branch-protection", state: "pass", value: "true", heartbeat: true }],
      ctx,
    );
    expect(res).toEqual({ written: 1, transitions: 0 });
    expect(create.mock.calls[0]![0].data.transition).toBe(false);
  });

  it("an unmeasurable observation is stored as itself, never collapsed to fail", async () => {
    const { create } = prismaWith([prevRow("branch-protection", "pass", "true")]);
    await recordObservations("acme", "repo_1", [{ controlId: "branch-protection", state: "unmeasurable", value: null }], ctx);
    expect(create.mock.calls[0]![0].data).toMatchObject({ state: "unmeasurable", value: null });
  });
});

describe("provenance", () => {
  it("never fabricates an actor for a probe — only a webhook row carries one", async () => {
    const { create } = prismaWith([]);
    await recordObservations("acme", "repo_1", [{ controlId: "branch-protection", state: "pass", value: "true" }], {
      ...ctx,
      actorLogin: "someone",
    });
    expect(create.mock.calls[0]![0].data.actorLogin).toBeNull();

    const second = prismaWith([]);
    await recordObservations("acme", "repo_1", [{ controlId: "branch-protection", state: "pass", value: "true" }], {
      repoFullName: "acme/api",
      source: "webhook",
      actorLogin: "octocat",
      deliveryId: "d-1",
    });
    expect(second.create.mock.calls[0]![0].data.actorLogin).toBe("octocat");
  });
});

describe("listObservationsSince", () => {
  it("refuses an unparseable `since` instead of silently scanning the whole ledger", async () => {
    const findMany = vi.fn(async () => []);
    mockGetPrisma.mockReturnValue({ controlObservation: { findMany } });
    expect(await listObservationsSince("acme", "not-a-date")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("narrows to the alertable rows on request, and is org-constrained either way", async () => {
    const findMany = vi.fn(async () => []);
    mockGetPrisma.mockReturnValue({ controlObservation: { findMany } });
    await listObservationsSince("acme", "2026-08-01T00:00:00.000Z", { transitionsOnly: true });
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ orgId: "org_1", transition: true });
  });
});
