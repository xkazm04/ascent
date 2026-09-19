// The count math behind the Alerts chip's unread badge. Prisma is faked (same pattern as
// org-signals.test.ts) so what's pinned is exactly this module's contract: the window is measured
// STRICTLY after the watermark, the read is two bounded queries (scan-memory UNION control-failed
// AlertEvents, never a per-repo fan-out), and the count saturates at the display cap instead of a
// second count query.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { getOrgMovementSince, MOVEMENT_CAP, CONTROL_FAILED_EVENT } from "./org-movement";

const SINCE = new Date("2026-07-20T00:00:00Z");

/** One persisted scan-pipeline memory row, as the query selects it. */
function row(i: number, event = "regression", namespace: string | null = `acme/repo${i}`) {
  return {
    namespace,
    tags: JSON.stringify([namespace, event]),
    content: `Regression detected on acme/repo${i}`,
    createdAt: new Date(SINCE.getTime() + (i + 1) * 3_600_000),
  };
}

/** One control-failed AlertEvent, as the query selects it. */
function controlRow(
  i: number,
  over: { repoFullName?: string | null; title?: string; hoursAfter?: number } = {},
) {
  const hoursAfter = over.hoursAfter ?? i + 1;
  return {
    repoFullName: over.repoFullName === undefined ? `acme/api${i}` : over.repoFullName,
    title: over.title ?? `Branch protection failed on acme/api${i}`,
    createdAt: new Date(SINCE.getTime() + hoursAfter * 3_600_000),
  };
}

const memoryFindMany = vi.fn();
const alertFindMany = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
  mockGetPrisma.mockReturnValue({
    orgMemory: { findMany: memoryFindMany },
    alertEvent: { findMany: alertFindMany },
  });
  memoryFindMany.mockResolvedValue([]);
  alertFindMany.mockResolvedValue([]);
});

describe("getOrgMovementSince", () => {
  it("filters STRICTLY after the watermark, scoped to this org, in TWO bounded reads (no per-repo fan-out)", async () => {
    memoryFindMany.mockResolvedValue([row(0), row(1)]);
    const m = await getOrgMovementSince("acme", SINCE);

    expect(memoryFindMany).toHaveBeenCalledTimes(1);
    expect(alertFindMany).toHaveBeenCalledTimes(1);
    const memoryArgs = memoryFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      take: number;
      orderBy: unknown;
    };
    expect(memoryArgs.where).toMatchObject({ orgId: "org_1", source: "scan-pipeline", createdAt: { gt: SINCE } });
    expect(memoryArgs.where).toMatchObject({ archived: false, supersededBy: null });
    expect(memoryArgs.take).toBe(MOVEMENT_CAP + 1);
    expect(memoryArgs.orderBy).toEqual({ createdAt: "desc" });

    const alertArgs = alertFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      take: number;
      orderBy: unknown;
    };
    expect(alertArgs.where).toMatchObject({
      orgId: "org_1",
      kind: "control",
      severity: "critical",
      createdAt: { gt: SINCE },
    });
    expect(alertArgs.take).toBe(MOVEMENT_CAP + 1);
    expect(alertArgs.orderBy).toEqual({ createdAt: "desc" });

    expect(m).not.toBeNull();
    expect(m!.count).toBe(2);
    expect(m!.capped).toBe(false);
    expect(m!.since).toBe(SINCE);
    // Newest-first after the union sort, even if a mock returned the older row first.
    expect(m!.items.map((i) => i.repo)).toEqual(["acme/repo1", "acme/repo0"]);
    expect(m!.items[0]).toMatchObject({ event: "regression" });
  });

  it("zero-state: nothing since the watermark is count 0, NOT a null (up to date ≠ no data)", async () => {
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m).toEqual({ since: SINCE, items: [], count: 0, capped: false });
  });

  it("a control-failed AlertEvent with no memory row still increments the Alerts count", async () => {
    alertFindMany.mockResolvedValue([
      controlRow(0, { repoFullName: "acme/api", title: "Branch protection failed on acme/api" }),
    ]);
    const m = await getOrgMovementSince("acme", SINCE);

    expect(memoryFindMany).toHaveBeenCalledTimes(1);
    expect(alertFindMany).toHaveBeenCalledTimes(1);
    expect(m).not.toBeNull();
    expect(m!.count).toBe(1);
    expect(m!.capped).toBe(false);
    expect(m!.items).toEqual([
      {
        repo: "acme/api",
        event: CONTROL_FAILED_EVENT,
        summary: "Branch protection failed on acme/api",
        at: new Date(SINCE.getTime() + 3_600_000),
      },
    ]);
  });

  it("unions scan-memory and control-failed rows, newest first", async () => {
    memoryFindMany.mockResolvedValue([row(0)]); // 1h after since
    alertFindMany.mockResolvedValue([controlRow(0, { repoFullName: "acme/api", hoursAfter: 3 })]);
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.count).toBe(2);
    expect(m!.items.map((i) => i.event)).toEqual([CONTROL_FAILED_EVENT, "regression"]);
    expect(m!.items[0]!.repo).toBe("acme/api");
  });

  it("saturates at the cap: the probe row is dropped from the list and flips `capped`", async () => {
    memoryFindMany.mockResolvedValue(Array.from({ length: MOVEMENT_CAP + 1 }, (_, i) => row(i)));
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.count).toBe(MOVEMENT_CAP);
    expect(m!.items).toHaveLength(MOVEMENT_CAP);
    expect(m!.capped).toBe(true);
  });

  it("saturates the cap across the union, not per source", async () => {
    memoryFindMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => row(i)));
    alertFindMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => controlRow(i, { hoursAfter: i + 10 })));
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.count).toBe(MOVEMENT_CAP);
    expect(m!.capped).toBe(true);
    expect(m!.items.filter((i) => i.event === CONTROL_FAILED_EVENT)).toHaveLength(5);
    expect(m!.items.filter((i) => i.event === "regression")).toHaveLength(4);
  });

  it("carries the event tag through, and survives a malformed/absent tags blob", async () => {
    memoryFindMany.mockResolvedValue([
      row(0, "level-change"),
      { namespace: "acme/x", tags: "not-json", content: "…", createdAt: SINCE },
      { namespace: null, tags: null, content: "…", createdAt: SINCE },
    ]);
    const m = await getOrgMovementSince("acme", SINCE);
    expect(m!.items.map((i) => i.event)).toEqual(["level-change", "", ""]);
    expect(m!.items[2]!.repo).toBeNull();
  });

  it("returns null (degrade to the countless chip) when persistence is off or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getOrgMovementSince("acme", SINCE)).toBeNull();

    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgId.mockResolvedValue(null);
    expect(await getOrgMovementSince("acme", SINCE)).toBeNull();
    expect(memoryFindMany).not.toHaveBeenCalled();
    expect(alertFindMany).not.toHaveBeenCalled();
  });
});
