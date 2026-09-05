// G7-13 (the export half). The backlog CSV is a DATA-EGRESS surface: it leaves the app carrying no
// scope marker, so what it must prove is (a) it is gated exactly like the JSON read, (b) it mirrors
// the READ SCOPE it was asked for — segment, tech group, and whether closed rows are included — and
// (c) it goes through the canonical csvTable assembler, so the formula-injection guard applies here
// too and can't drift the way a hand-rolled copy once did.

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

vi.mock("@/lib/db", () => ({ getOrgBacklog: vi.fn(), isDbConfigured: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));

import { GET } from "./route";
import { getOrgBacklog } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockBacklog = vi.mocked(getOrgBacklog);
const mockRead = vi.mocked(requireOrgRead);

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
      "repo,title,dimId,dimension,impact,effort,status,owner,dueDate,dueBucket,overdue,projectedPoints,unlocks,lastActivityAt,recommendationId",
    );
    // Exactly one data row — byDue carries the same items and must not double them.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("acme/app,Add CI gate,D2,CI/CD,high,low,open,alice,2026-08-01,later,false,4,L3,");
    expect(headerOf(res, "content-type")).toContain("text/csv");
    expect(headerOf(res, "content-disposition")).toContain('filename="ascent-backlog-acme.csv"');
    expect(headerOf(res, "cache-control")).toBe("private, no-store");
  });

  it("mirrors the read scope: segment, tech group and includeClosed all reach the query AND the filename", async () => {
    const res = await get("org=acme&format=csv&segment=seg1&techGroup=tg1&includeClosed=1");
    expect(mockBacklog).toHaveBeenCalledWith("acme", "seg1", expect.any(Date), "tg1", { includeClosed: true });
    expect(headerOf(res, "content-disposition")).toContain("ascent-backlog-acme-seg1-tg1-all.csv");
  });

  it("neutralizes a spreadsheet formula in a title (the shared csvTable guard)", async () => {
    mockBacklog.mockResolvedValue(backlog([item({ title: "=HYPERLINK(\"http://evil\")" })]) as never);
    const csv = bodyOf(await get("org=acme&format=csv"));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
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
