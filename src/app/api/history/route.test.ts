// Security/authorization test for GET /api/history — the org-scoping gate that keeps a guessable
// owner/repo slug from leaking ANOTHER tenant's private scan history (route.ts:72-91).
//
// The invariant under test: org A's history is reachable ONLY through org A's resolved slug. The
// route's two guards are (a) the auth gate — when auth is configured and there is no session, return
// 401 and NEVER touch the DB; and (b) org-scoping — the `orgSlug` from `readableOrgForOwner(owner)`
// MUST flow unchanged into `getRepositoryHistory(owner, repo, { orgSlug })`, so a name collision can't
// cross tenants. We mock the auth + db boundaries so we can assert exactly which orgSlug reaches the
// query, and that an unauthenticated (auth-on) caller is denied before any read.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // Extends the real Response so `new NextResponse(body, init)` (the CSV / 304 paths) works as a real
  // Response, and the static `.json()` helper mirrors NextResponse.json for the JSON path.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  isAuthConfigured: vi.fn(),
  readableOrgForOwner: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));

import { GET } from "./route";
import { getSession, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { isDbConfigured, getRepositoryHistory } from "@/lib/db";

const mockGetSession = vi.mocked(getSession);
const mockIsAuthConfigured = vi.mocked(isAuthConfigured);
const mockReadableOrg = vi.mocked(readableOrgForOwner);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetHistory = vi.mocked(getRepositoryHistory);

function get(query: string, headers?: Record<string, string>) {
  return GET(new Request(`http://localhost/api/history${query}`, { headers }));
}

const historyFor = (owner: string, name: string) =>
  ({
    repo: { owner, name, fullName: `${owner}/${name}` },
    scans: [{ id: "s1", scannedAt: "2026-01-01T00:00:00.000Z", overallScore: 80 }],
  }) as unknown as Awaited<ReturnType<typeof getRepositoryHistory>>;

describe("GET /api/history — org-scoping & auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    // Default: auth ON, signed in. Org resolution is overridden per-test.
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue({} as Awaited<ReturnType<typeof getSession>>);
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null);
  });

  // --- Guard (a): auth gate fires BEFORE any DB read ---------------------------------------------

  it("denies (401) when auth is configured and there is no session, and never reads history", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?repo=acme/secret");

    expect(res.status).toBe(401);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("skips the auth gate when auth is NOT configured (local/demo) and still serves", async () => {
    mockIsAuthConfigured.mockReturnValue(false);
    mockGetSession.mockResolvedValue(null);
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(historyFor("acme", "repo"));

    const res = await get("?repo=acme/repo");

    expect(res.status).toBe(200);
    expect(mockGetSession).not.toHaveBeenCalled(); // short-circuited: auth-off skips the session check
  });

  // --- Guard (b): the resolved orgSlug flows INTO the query (the leak-prevention invariant) -------

  it("scopes the query to the caller's OWN org slug from readableOrgForOwner", async () => {
    mockReadableOrg.mockResolvedValue("acme"); // caller is a member of acme
    mockGetHistory.mockResolvedValue(historyFor("acme", "repo"));

    const res = await get("?repo=acme/repo");

    expect(res.status).toBe(200);
    expect(mockReadableOrg).toHaveBeenCalledWith("acme");
    // The org slug the auth layer resolved MUST be the one the DB query is scoped by.
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "repo",
      expect.objectContaining({ orgSlug: "acme" }),
    );
  });

  it("scopes a foreign/private slug to 'public' so a name collision can't leak another tenant", async () => {
    // Caller is NOT a member of 'acme' → readableOrgForOwner downgrades them to the public org.
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null); // no public repo by that name → empty payload

    const res = await get("?repo=acme/private-repo");
    const body = await res.json();

    expect(res.status).toBe(200);
    // The query must be scoped to 'public', NEVER to the private 'acme' org the caller can't read.
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "private-repo",
      expect.objectContaining({ orgSlug: "public" }),
    );
    // No private rows leak: a miss yields an empty scans array, not acme's history.
    expect(body.scans).toEqual([]);
    // Critically, the DB was never queried with the private org slug.
    expect(mockGetHistory).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ orgSlug: "acme" }),
    );
  });

  it("scopes the CSV export with the same resolved org slug (no cross-tenant export)", async () => {
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null);

    const res = await get("?repo=acme/private-repo&format=csv");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "private-repo",
      expect.objectContaining({ orgSlug: "public" }),
    );
  });

  // --- Precondition guards (cheap, also pinned by the finding) -----------------------------------

  it("returns 400 on missing repo and never reads history", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid repo reference and never reads history", async () => {
    const res = await get("?repo=" + encodeURIComponent("https://gitlab.com/a/b"));
    expect(res.status).toBe(400);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("returns 503 when the DB is not configured, before resolving any org", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("?repo=acme/repo");
    expect(res.status).toBe(503);
    expect(mockReadableOrg).not.toHaveBeenCalled();
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------------------------------
// CSV export escaping — the "show my boss / pull into a spreadsheet" artifact (route.ts:16-42).
//
// The helpers (`csvField` / `historyToCsv`) are not exported, so we pin them THROUGH the route's
// `format=csv` path by feeding a hostile history and parsing the response body. The invariants under
// test are the ones that keep a malicious or messy scan row from corrupting / weaponizing the export:
//   1. column-alignment   — a cell with a comma is quoted so it can't shift downstream columns;
//   2. RFC-4180 quoting   — a cell with a `"` is doubled; a cell with a newline is quoted (no row break);
//   3. fixed header        — the header row is code-derived, never injectable from a data cell;
//   4. formula injection   — DECIDED-AND-PINNED below: the route does NOT prefix `= + - @`, so we assert
//                            the CURRENT behavior so the (risky) decision is explicit, not accidental,
//                            while still proving the column-shift defense holds even for a formula cell.
// --------------------------------------------------------------------------------------------------

/** RFC-4180 line splitter: split a CSV document into logical rows, honoring quoted fields so a quoted
 *  embedded newline does NOT start a new row (the whole point of invariant #2). */
function splitCsvRows(csv: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      // A doubled quote ("") is an escaped quote, still inside the field.
      if (inQuotes && csv[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "\n" && !inQuotes) {
      rows.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur !== "") rows.push(cur);
  return rows;
}

/** RFC-4180 field splitter for a single logical row: split on TOP-LEVEL commas only (commas inside a
 *  quoted field don't count), so we can count columns and recover values. Returns RAW fields (still
 *  quoted/escaped) so a caller can both count columns and unescape. */
function splitCsvFields(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Unwrap an RFC-4180 field: strip surrounding quotes (if any) and collapse doubled quotes. */
function unquote(field: string): string {
  if (field.startsWith('"') && field.endsWith('"') && field.length >= 2) {
    return field.slice(1, -1).replace(/""/g, '"');
  }
  return field;
}

// A scan whose cells carry every hostile shape at once. `as unknown` because we deliberately push
// values the type doesn't normally hold (the route's csvField is total over `unknown`).
const hostileHistory = (cells: {
  scannedAt?: unknown;
  overallScore?: unknown;
  level?: unknown;
  levelName?: unknown;
  engineProvider?: unknown;
}) =>
  ({
    repo: { owner: "acme", name: "repo", fullName: "acme/repo" },
    scans: [
      {
        id: "s1",
        scannedAt: "2026-01-01T00:00:00.000Z",
        overallScore: 80,
        level: "L4",
        levelName: "Integrated",
        engineProvider: "openai",
        dimensions: [],
        ...cells,
      },
    ],
  }) as unknown as Awaited<ReturnType<typeof getRepositoryHistory>>;

async function csvBody(history: Awaited<ReturnType<typeof getRepositoryHistory>>): Promise<string> {
  mockReadableOrg.mockResolvedValue("acme");
  mockGetHistory.mockResolvedValue(history);
  const res = await get("?repo=acme/repo&format=csv");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/csv");
  return res.text();
}

describe("GET /api/history — CSV export escaping (cell-shift / injection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue({} as Awaited<ReturnType<typeof getSession>>);
    mockReadableOrg.mockResolvedValue("acme");
  });

  it("quotes a cell containing a comma so it cannot shift downstream columns (alignment invariant)", async () => {
    // A comma'd value in `levelName` must stay ONE field, keeping every data row's column count equal
    // to the header's — the exact regression the route.ts:36-38 comment says was fixed.
    const csv = await csvBody(hostileHistory({ levelName: "Integrated, mostly" }));
    const rows = splitCsvRows(csv);
    const headerCols = splitCsvFields(rows[0]).length;
    const dataCols = splitCsvFields(rows[1]).length;

    expect(dataCols).toBe(headerCols); // no column shift
    const fields = splitCsvFields(rows[1]);
    // levelName is the 4th column (scannedAt, overall, level, levelName, engine, ...dims).
    expect(fields[3]).toBe('"Integrated, mostly"'); // quoted as a single field
    expect(unquote(fields[3])).toBe("Integrated, mostly");
  });

  it("doubles an embedded double-quote per RFC-4180", async () => {
    const csv = await csvBody(hostileHistory({ levelName: 'he"llo' }));
    const fields = splitCsvFields(splitCsvRows(csv)[1]);
    // The whole field is quoted and the inner " is doubled: "he""llo".
    expect(fields[3]).toBe('"he""llo"');
    expect(unquote(fields[3])).toBe('he"llo');
  });

  it("quotes a cell containing a newline so it cannot break the row into two", async () => {
    const csv = await csvBody(hostileHistory({ levelName: "line1\nline2" }));
    const rows = splitCsvRows(csv);
    // Exactly header + 1 data row (+ trailing empty from the final "\n"): the embedded newline did
    // NOT create a third logical row.
    expect(rows.length).toBe(2);
    const fields = splitCsvFields(rows[1]);
    expect(fields.length).toBe(splitCsvFields(rows[0]).length); // still aligned
    expect(unquote(fields[3])).toBe("line1\nline2");
  });

  it("keeps the header row fixed — it is code-derived, never injectable from a data cell", async () => {
    // Even a data cell that mimics a header string lands in the DATA row, never as a second header.
    const csv = await csvBody(hostileHistory({ engineProvider: "scannedAt,overall,level" }));
    const rows = splitCsvRows(csv);
    // Header is the code-derived fixed prefix + the dimension columns (D1, D2, …); it never absorbs a
    // data value. The hostile cell did NOT replace or augment the header.
    expect(rows[0].startsWith("scannedAt,overall,level,levelName,engine,")).toBe(true);
    expect(splitCsvFields(rows[0])[0]).toBe("scannedAt"); // first header field is exactly the literal
    // The header-looking value is confined to ONE quoted data field, not a new structural row.
    const fields = splitCsvFields(rows[1]);
    expect(fields.length).toBe(splitCsvFields(rows[0]).length);
    // The header-mimicking value is quoted (it has commas) and confined to the engine data column.
    expect(fields[4]).toBe('"scannedAt,overall,level"');
    expect(unquote(fields[4])).toBe("scannedAt,overall,level"); // engine column, not a new header row
  });

  it("PINS the formula-injection policy: a leading = + - @ is NOT prefixed today (decision made explicit)", async () => {
    // DECIDED-AND-PINNED: the route's csvField only quotes on [",\n] and does NOT neutralize spreadsheet
    // formula prefixes (= + - @). This test documents the CURRENT (risky) behavior so a future change to
    // ADD neutralization is a deliberate, reviewed flip — not a silent regression either way. See
    // trends-comparison.md finding #3: "if intentionally not, document it and assert the current behavior."
    const csv = await csvBody(hostileHistory({ levelName: "=1+1", engineProvider: "@SUM(A1:A9)" }));
    const fields = splitCsvFields(splitCsvRows(csv)[1]);
    // A bare formula with no comma/quote/newline is emitted RAW (un-prefixed, un-quoted) — the value
    // would evaluate if opened in Excel. Pin it so the gap is visible, not accidental.
    expect(fields[3]).toBe("=1+1");
    expect(fields[4]).toBe("@SUM(A1:A9)");
  });

  it("still protects column alignment for a formula cell that ALSO carries a comma", async () => {
    // The formula prefix isn't neutralized, but the comma-quoting defense MUST still hold so a formula
    // cell can't additionally shift columns.
    const csv = await csvBody(hostileHistory({ levelName: "=cmd(),evil" }));
    const rows = splitCsvRows(csv);
    const fields = splitCsvFields(rows[1]);
    expect(fields.length).toBe(splitCsvFields(rows[0]).length); // aligned despite the comma
    expect(fields[3]).toBe('"=cmd(),evil"'); // quoted as a single field
    expect(unquote(fields[3])).toBe("=cmd(),evil");
  });
});
