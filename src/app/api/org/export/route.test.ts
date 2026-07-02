// /api/org/export authorization + serialization wiring — this route serializes the FULL, unbounded
// contributor PII list (login, real name, commit/AI-commit counts, lastActiveAt) for an org. The
// load-bearing invariant: the requireOrgRead gate runs BEFORE any people-data read, so a non-member /
// signed-out caller can't download another tenant's contributor PII (a one-edit cross-tenant
// exfiltration). The non-negotiable assertion is gate-before-read: when requireOrgRead returns a
// denial Response (401/403), the handler returns EXACTLY that Response and getContributorInsights /
// getOrgGovernance are NEVER called. Also pins: pre-gate short-circuits (503 DB-off, 400 bad kind /
// missing org), CSV content-type + sanitized attachment filename, org-scoping of the read, and the
// RFC-4180 csvField quoting of a contributor name containing a comma/quote/newline.
//
// The authz + db boundaries are mocked so we can assert exactly when (and whether) the data read fires.
// next/server's NextResponse is mocked as a subclass of Response because the CSV branch uses the
// `new NextResponse(body, init)` constructor (not just the static .json helper).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // Extends Response so BOTH `NextResponse.json(...)` and `new NextResponse(csv, { headers })` work.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  getContributorInsights: vi.fn(),
  getOrgGovernance: vi.fn(),
  getOrgRollup: vi.fn(),
  getOrgTeamRollup: vi.fn(),
  listSegments: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));

import { GET } from "./route";
import { isDbConfigured, getContributorInsights, getOrgGovernance, getOrgRollup, getOrgTeamRollup, listSegments } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetContributorInsights = vi.mocked(getContributorInsights);
const mockGetOrgGovernance = vi.mocked(getOrgGovernance);
const mockGetOrgRollup = vi.mocked(getOrgRollup);
const mockGetOrgTeamRollup = vi.mocked(getOrgTeamRollup);
const mockListSegments = vi.mocked(listSegments);
const mockRequireOrgRead = vi.mocked(requireOrgRead);

const get = (qs: string) => GET(new Request(`http://localhost/api/org/export${qs}`));
const deny = (status: number) => new Response(JSON.stringify({ error: "denied" }), { status });

// A realistic contributor row, matching the ContributorInsight shape the route maps to CSV cells.
const contributor = (over: Partial<Record<string, unknown>> = {}) => ({
  login: "octocat",
  name: "Octo Cat",
  commits: 42,
  aiCommits: 7,
  aiShare: 17,
  repos: 3,
  lastActiveAt: "2026-01-02T00:00:00.000Z",
  championScore: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  // Default: authorized. Individual tests override to a denial Response.
  mockRequireOrgRead.mockResolvedValue(null);
  mockListSegments.mockResolvedValue([]);
  mockGetContributorInsights.mockResolvedValue({ contributors: [contributor()] } as never);
  mockGetOrgGovernance.mockResolvedValue({ perRepo: [] } as never);
  mockGetOrgRollup.mockResolvedValue({ repos: [] } as never);
  mockGetOrgTeamRollup.mockResolvedValue({ teams: [] } as never);
});

describe("GET /api/org/export — tenant gate (cross-tenant PII exfiltration guard)", () => {
  it("denies an unauthorized contributors read and NEVER serializes any PII (gate before read)", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(403));

    const res = await get("?org=victim&kind=contributors");

    expect(res.status).toBe(403);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("victim");
    // The non-negotiable invariant: the people-data read is short-circuited by the gate.
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
    expect(mockGetOrgGovernance).not.toHaveBeenCalled();
    // And nothing leaks in the denial body.
    expect(await res.text()).not.toContain("octocat");
  });

  it("denies an unauthorized CSV export too — the gate runs before any contributor row is built", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));

    const res = await get("?org=victim&kind=contributors&format=csv");

    expect(res.status).toBe(401);
    expect(mockRequireOrgRead).toHaveBeenCalledWith("victim");
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
    // No CSV attachment is produced for a denied caller.
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).not.toContain("octocat");
  });

  it("denies an unauthorized delivery export and never reads governance", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(403));

    const res = await get("?org=victim&kind=delivery&format=csv");

    expect(res.status).toBe(403);
    expect(mockGetOrgGovernance).not.toHaveBeenCalled();
  });

  it("returns the gate's denial status unchanged (gate verdict is not rewritten)", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));
    expect((await get("?org=acme&kind=contributors")).status).toBe(401);

    mockRequireOrgRead.mockResolvedValue(deny(403));
    expect((await get("?org=acme&kind=contributors")).status).toBe(403);
  });

  it("gates BEFORE the read for an ALLOWED caller too (requireOrgRead resolves before the data fetch)", async () => {
    const order: string[] = [];
    mockRequireOrgRead.mockImplementation(async () => {
      order.push("gate");
      return null;
    });
    mockGetContributorInsights.mockImplementation(async () => {
      order.push("read");
      return { contributors: [] } as never;
    });

    await get("?org=acme&kind=contributors");

    expect(order).toEqual(["gate", "read"]);
  });
});

describe("GET /api/org/export — authorized export", () => {
  it("serves the contributor CSV scoped to the caller's org with the right content-type + disposition", async () => {
    const res = await get("?org=acme&kind=contributors&format=csv");

    expect(res.status).toBe(200);
    // Gate ran (allowed) and THEN the org-scoped read fired for that same org.
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    expect(mockGetContributorInsights).toHaveBeenCalledTimes(1);
    expect(mockGetContributorInsights.mock.calls[0][0]).toBe("acme");

    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="ascent-contributors-acme.csv"',
    );

    const body = await res.text();
    expect(body).toContain("login,name,commits,aiCommits,aiSharePct,repos,lastActiveAt");
    expect(body).toContain("octocat");
  });

  it("returns JSON (not a CSV attachment) when format is omitted", async () => {
    const res = await get("?org=acme&kind=contributors");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBeNull();
    const body = await res.json();
    expect(body.org).toBe("acme");
    expect(body.kind).toBe("contributors");
    expect(body.header).toContain("login");
  });

  it("reads the team rollup (not contributors/governance) for kind=teams", async () => {
    mockGetOrgTeamRollup.mockResolvedValue({
      teams: [
        {
          slug: "@acme/frontend",
          name: "frontend",
          repoCount: 3,
          totalOwned: 4,
          defaultOwnerCount: 2,
          avgOverall: 78,
          avgAdoption: 82,
          avgRigor: 74,
          posture: "ai-native",
          contributors: 5,
          aiContributors: 4,
          aiCommitShare: 61,
          comparedRepos: 2,
          improving: 2,
          declining: 0,
          avgDelta: 6,
        },
      ],
    } as never);

    const res = await get("?org=acme&kind=teams&format=csv");

    expect(res.status).toBe(200);
    expect(mockGetOrgTeamRollup).toHaveBeenCalledTimes(1);
    expect(mockGetOrgTeamRollup.mock.calls[0][0]).toBe("acme");
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
    expect(mockGetOrgGovernance).not.toHaveBeenCalled();
    const body = await res.text();
    expect(body).toContain("team,name,reposScanned");
    expect(body).toContain("@acme/frontend");
  });

  it("reads governance (not contributors) for kind=delivery", async () => {
    mockGetOrgGovernance.mockResolvedValue({
      perRepo: [
        {
          fullName: "acme/repo",
          name: "repo",
          protected: true,
          requiresPullRequest: true,
          requiredApprovals: 1,
          requiresStatusChecks: false,
          requiresSignatures: false,
          ruleCount: 2,
        },
      ],
    } as never);

    const res = await get("?org=acme&kind=delivery&format=csv");

    expect(res.status).toBe(200);
    expect(mockGetOrgGovernance).toHaveBeenCalledTimes(1);
    expect(mockGetOrgGovernance.mock.calls[0][0]).toBe("acme");
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
    const body = await res.text();
    expect(body).toContain("acme/repo");
  });
});

describe("GET /api/org/export — filename sanitization + CSV quoting (injection / RFC-4180)", () => {
  it("sanitizes a hostile org slug out of the content-disposition filename (no , / \" path chars)", async () => {
    const res = await get("?org=" + encodeURIComponent('a/../b,x"') + "&kind=contributors&format=csv");

    const disp = res.headers.get("content-disposition") ?? "";
    // safeFilenameSlug collapses everything but [a-z0-9-]; nothing dangerous survives in the filename.
    const filename = disp.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(filename).not.toMatch(/[,"/]/);
    expect(filename.startsWith("ascent-contributors-")).toBe(true);
  });

  it("RFC-4180 quotes a contributor name containing a comma, quote, or newline (csvField lock)", async () => {
    mockGetContributorInsights.mockResolvedValue({
      contributors: [contributor({ login: "evil", name: 'Doe, "Jane"\nInc' })],
    } as never);

    const res = await get("?org=acme&kind=contributors&format=csv");
    const body = await res.text();

    // The hostile name is wrapped in quotes with embedded quotes doubled, per RFC 4180.
    expect(body).toContain('"Doe, ""Jane""\nInc"');
    // The raw comma in the name must NOT leak as an unquoted field separator.
    expect(body).not.toContain("Doe, \"Jane\",");
  });

  it("neutralizes spreadsheet formula injection in a contributor name (=/+/-/@ forced to literal)", async () => {
    mockGetContributorInsights.mockResolvedValue({
      contributors: [contributor({ login: "evil", name: "=HYPERLINK(0)" })],
    } as never);

    const res = await get("?org=acme&kind=contributors&format=csv");
    const body = await res.text();

    // A cell starting with = (or + - @) is prefixed with ' and quoted, so it renders as text, not a live formula.
    expect(body).toContain("\"'=HYPERLINK(0)\"");
    // The raw, executable form must NOT appear unguarded.
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("GET /api/org/export — pre-gate short-circuits (no gate, no read)", () => {
  it("returns 503 when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const res = await get("?org=acme&kind=contributors");

    expect(res.status).toBe(503);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
  });

  it("returns 400 when `org` is missing", async () => {
    const res = await get("?kind=contributors");

    expect(res.status).toBe(400);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown kind BEFORE gating or reading (no PII path opened)", async () => {
    const res = await get("?org=acme&kind=secrets");

    expect(res.status).toBe(400);
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetContributorInsights).not.toHaveBeenCalled();
    expect(mockGetOrgGovernance).not.toHaveBeenCalled();
  });
});
