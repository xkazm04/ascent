// G7-13 (the export half). The backlog CSV is a DATA-EGRESS surface: it leaves the app carrying no
// scope marker, so what it must prove is (a) it is gated exactly like the JSON read, (b) it mirrors
// the READ SCOPE it was asked for — segment, tech group, and whether closed rows are included — and
// (c) it goes through the canonical csvTable assembler, so the formula-injection guard applies here
// too and can't drift the way a hand-rolled copy once did.
//
// JSON GET pins the same tenant wall without format=csv: missing ?org 400, 503 when the database is
// unset, requireOrgRead before getOrgBacklog, and includeClosed=1 as the G6-02 recovery view.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
    constructor(
      readonly body: string,
      readonly init?: ResponseInit,
    ) {}
  },
}));

vi.mock("@/lib/db", () => ({ getOrgBacklog: vi.fn(), isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));

import { GET } from "./route";
import { getOrgBacklog, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockBacklog = vi.mocked(getOrgBacklog);
const mockRead = vi.mocked(requireOrgRead);
const mockIsDb = vi.mocked(isDbConfigured);

function item(over: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    title: "Add CI gate",
    dimId: "D2",
    dimLabel: "CI/CD",
    impact: "high",
    effort: "low",
    status: "open",
    assigneeLogin: "alice",
    targetDate: "2026-08-01",
    dueBucket: "later",
    dueInDays: 30,
    overdue: false,
    repo: "acme/app",
    repoName: "app",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    projectedPoints: 4,
    unlocks: "L3",
    rationale: "",
    explore: [],
    claimActor: null,
    leaseUntil: null,
    needsHuman: false,
    ...over,
  };
}

function backlog(items: unknown[]) {
  return {
    org: "acme",
    includesClosed: false,
    repos: 1,
    tracked: items.length,
    active: items.length,
    assigned: 0,
    unassigned: 0,
    dueSoon: 0,
    open: items.length,
    inProgress: 0,
    done: 0,
    dismissed: 0,
    overdue: 0,
    byOwner: [{ login: "alice", active: items.length, open: items.length, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items }],
    // The same rows re-bucketed — the export must NOT read this, or every item would appear twice.
    byDue: [{ bucket: "later", label: "Later", items }],
    assignees: ["alice"],
  };
}

// The mocked NextResponse constructor stores the body; a JSON error path returns a real Response.
const bodyOf = (res: unknown) => (res as { body: string }).body;
const headerOf = (res: unknown, k: string) =>
  ((res as { init?: ResponseInit }).init?.headers as Record<string, string>)[k];

function get(qs: string) {
  return GET(new Request(`http://localhost/api/org/backlog?${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDb.mockReturnValue(true);
  mockRead.mockResolvedValue(null as never);
  mockBacklog.mockResolvedValue(backlog([item()]) as never);
});

describe("GET /api/org/backlog?format=csv", () => {
  it("is gated by the same org read check as the JSON path", async () => {
    mockRead.mockResolvedValue(Response.json({ error: "no access" }, { status: 403 }) as never);
    const res = await get("org=acme&format=csv");
    expect((res as Response).status).toBe(403);
    expect(mockBacklog).not.toHaveBeenCalled();
  });

  it("emits one row per item with a CSV content type and a scoped filename", async () => {
    const res = await get("org=acme&format=csv");
    const csv = bodyOf(res);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "repo,title,dimId,dimension,impact,effort,status,owner,dueDate,dueBucket,overdue,projectedPoints,unlocks,rationale,explore,lastActivityAt,claimActor,leaseUntil,needsHuman,recommendationId",
    );
    // Exactly one data row — byDue carries the same items and must not double them.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("acme/app,Add CI gate,D2,CI/CD,high,low,open,alice,2026-08-01,later,false,4,L3,");
    // Unclaimed default: empty claim/lease, needsHuman false — so a later claimed row is distinguishable.
    expect(lines[1]).toContain(",2026-01-01T00:00:00.000Z,,,false,rec1");
    expect(headerOf(res, "content-type")).toContain("text/csv");
    expect(headerOf(res, "content-disposition")).toContain('filename="ascent-backlog-acme.csv"');
    expect(headerOf(res, "cache-control")).toBe("private, no-store");
  });

  it("mirrors the read scope: segment, tech group and includeClosed all reach the query AND the filename", async () => {
    const res = await get("org=acme&format=csv&segment=seg1&techGroup=tg1&includeClosed=1");
    expect(mockBacklog).toHaveBeenCalledWith("acme", "seg1", expect.any(Date), "tg1", { includeClosed: true });
    expect(headerOf(res, "content-disposition")).toContain("ascent-backlog-acme-seg1-tg1-all.csv");
  });

  it("exports claimActor, leaseUntil and needsHuman so a held or escalated row is distinguishable", async () => {
    mockBacklog.mockResolvedValue(
      backlog([
        item({
          claimActor: "agent:ci",
          leaseUntil: "2026-08-02T12:00:00.000Z",
          needsHuman: true,
        }),
      ]) as never,
    );
    const csv = bodyOf(await get("org=acme&format=csv"));
    const header = csv.trim().split("\n")[0]!.split(",");
    const row = csv.trim().split("\n")[1]!.split(",");
    expect(header).toEqual(expect.arrayContaining(["claimActor", "leaseUntil", "needsHuman"]));
    expect(row[header.indexOf("claimActor")]).toBe("agent:ci");
    expect(row[header.indexOf("leaseUntil")]).toBe("2026-08-02T12:00:00.000Z");
    expect(row[header.indexOf("needsHuman")]).toBe("true");
  });

  it("exports rationale and explore so a downloaded batch can rebuild the fix prompt", async () => {
    mockBacklog.mockResolvedValue(
      backlog([
        item({
          rationale: "CI is the gate that makes later rungs cheap.",
          explore: ["Which workflow is the source of truth?", "Who owns the required checks?"],
        }),
      ]) as never,
    );
    const csv = bodyOf(await get("org=acme&format=csv"));
    const header = csv.trim().split("\n")[0]!.split(",");
    const row = csv.trim().split("\n")[1]!.split(",");
    expect(header).toEqual(expect.arrayContaining(["rationale", "explore"]));
    expect(row[header.indexOf("rationale")]).toBe("CI is the gate that makes later rungs cheap.");
    expect(row[header.indexOf("explore")]).toBe(
      "Which workflow is the source of truth?; Who owns the required checks?",
    );
  });

  it("leaves empty rationale and explore as empty cells, never 0", async () => {
    const csv = bodyOf(await get("org=acme&format=csv"));
    const header = csv.trim().split("\n")[0]!.split(",");
    const row = csv.trim().split("\n")[1]!.split(",");
    expect(row[header.indexOf("rationale")]).toBe("");
    expect(row[header.indexOf("explore")]).toBe("");
  });

  it("neutralizes a spreadsheet formula in a title (the shared csvTable guard)", async () => {
    mockBacklog.mockResolvedValue(backlog([item({ title: "=HYPERLINK(\"http://evil\")" })]) as never);
    const csv = bodyOf(await get("org=acme&format=csv"));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("neutralizes a spreadsheet formula in rationale and explore", async () => {
    mockBacklog.mockResolvedValue(
      backlog([
        item({
          rationale: "=HYPERLINK(\"http://evil\")",
          explore: ["=CMD()"],
        }),
      ]) as never,
    );
    const csv = bodyOf(await get("org=acme&format=csv"));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(`"'=CMD()"`);
  });

  it("404s rather than emitting a header-only 'successful' export when the org has no backlog", async () => {
    mockBacklog.mockResolvedValue(null as never);
    const res = await get("org=acme&format=csv");
    expect((res as Response).status).toBe(404);
  });

  it("leaves the default JSON read untouched", async () => {
    const res = await get("org=acme");
    expect(await (res as Response).json()).toHaveProperty("backlog.org", "acme");
  });
});

describe("GET /api/org/backlog — JSON read", () => {
  it("503s when the database is unset, before the gate", async () => {
    mockIsDb.mockReturnValue(false);
    const res = await get("org=acme");
    expect((res as Response).status).toBe(503);
    expect(await (res as Response).json()).toEqual({ error: "The backlog requires a database." });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockBacklog).not.toHaveBeenCalled();
  });

  it("400s without ?org and never gates or loads", async () => {
    const res = await get("");
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).json()).toEqual({ error: "Missing ?org." });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockBacklog).not.toHaveBeenCalled();
  });

  it("returns the org-read denial and never loads the backlog", async () => {
    mockRead.mockResolvedValue(Response.json({ error: "no access" }, { status: 403 }) as never);
    const res = await get("org=acme");
    expect((res as Response).status).toBe(403);
    expect(mockRead).toHaveBeenCalledWith("acme");
    expect(mockBacklog).not.toHaveBeenCalled();
  });

  it("defaults includeClosed to false when the flag is absent", async () => {
    const res = await get("org=acme");
    expect(mockBacklog).toHaveBeenCalledWith("acme", null, expect.any(Date), null, { includeClosed: false });
    expect(await (res as Response).json()).toHaveProperty("backlog.org", "acme");
  });

  it("forwards includeClosed=1 into getOrgBacklog (G6-02 recovery view)", async () => {
    const res = await get("org=acme&includeClosed=1");
    expect(mockBacklog).toHaveBeenCalledWith("acme", null, expect.any(Date), null, { includeClosed: true });
    expect((res as Response).status).toBe(200);
  });
});
