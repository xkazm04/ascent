// The private-scan backfill scrub (operator decision 2026-10-08, "Scrub all of it"). FAILS BEFORE: the
// module did not exist, so rows of a private repo written before 5aed22ae kept their copied text.
//
// A small in-memory Prisma stands in for the database: enough of findMany / findUnique / update /
// count / deleteMany to run the real module, with Repository's @updatedAt emulated the way Prisma does
// it (bumped on every update unless the write passes a value), so "no clock moves" is a real check.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockSelfHosted } = vi.hoisted(() => ({ mockGetPrisma: vi.fn(), mockSelfHosted: vi.fn(() => false) }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { getPrisma: mockGetPrisma, isDbConfigured: () => true, withRetry: actual.withRetry };
});
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));
vi.mock("@/lib/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return { ...actual, selfHosted: mockSelfHosted };
});

import { recordAudit } from "@/lib/db/scans";
import { formatScrubOutcome, scrubPrivateScanContent, SCRUB_ACTION } from "@/lib/db/private-scan-scrub";

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown };
      if (c.in) return c.in.includes(v);
      if ("not" in c) return v !== c.not;
    }
    return v === cond;
  });
}

function table(rows: Row[], autoUpdatedAt = false) {
  return {
    rows,
    findMany: async (a: { where?: Row; take?: number; cursor?: { id: string }; skip?: number } = {}) => {
      let out = rows.filter((r) => matches(r, a.where)).sort((x, y) => String(x.id).localeCompare(String(y.id)));
      if (a.cursor) out = out.slice(out.findIndex((r) => r.id === a.cursor!.id) + (a.skip ?? 0));
      return (a.take ? out.slice(0, a.take) : out).map((r) => ({ ...r }));
    },
    findUnique: async (a: { where: Row }) => {
      const r = rows.find((x) => matches(x, a.where));
      return r ? { ...r } : null;
    },
    update: async (a: { where: { id: string }; data: Row }) => {
      const r = rows.find((x) => x.id === a.where.id)!;
      Object.assign(r, a.data);
      if (autoUpdatedAt && !("updatedAt" in a.data)) r.updatedAt = new Date();
      return { ...r };
    },
    count: async (a: { where?: Row } = {}) => rows.filter((r) => matches(r, a.where)).length,
    deleteMany: async (a: { where?: Row } = {}) => {
      const gone = rows.filter((r) => matches(r, a.where));
      for (const g of gone) rows.splice(rows.indexOf(g), 1);
      return { count: gone.length };
    },
  };
}

const QUOTE = "Never commit secrets; read them from the vault";
const CITED = `Model cited canonical_declared (+6) — AGENTS.md: "${QUOTE}"`;
const SIGNAL = "Found CLAUDE.md (2.1 KB)";
const GRAPH = JSON.stringify({
  version: "1",
  nodes: [{ path: "AGENTS.md", agent: "agents", bytes: 9, contentSampled: true, commands: [{ key: "test", command: "pnpm vitest" }], rules: [{ subject: "commit secrets", polarity: "never", quote: QUOTE }], pointers: [], pointerOnly: false, lastCommitAt: null }],
  edges: [{ from: "AGENTS.md", to: "CLAUDE.md", kind: "diverges", detail: 'rule "commit secrets": never vs always' }],
  canonical: "AGENTS.md",
  canonicalBasis: "pointer",
  contradictions: [],
  coherence: 90,
  penalties: [],
});
const MANIFEST = JSON.stringify({
  status: "ok", readAt: "2026-09-01T00:00:00.000Z", generatedAt: null, schemaVersion: "1.2.0", schemaAhead: false,
  capabilities: [{ name: "test", command: "pnpm vitest", verified: true, placeholder: false, wiredAt: [] }],
  controls: { prePush: [], ciHardPass: [] }, paths: {}, agents: [], purpose: "Northwind ledger service",
  boundaries: { neverTouch: [], secretsFrom: "the vault" }, placeholders: [], unbacked: [], notes: [],
});
const REPO_CLOCK = new Date("2026-09-01T00:00:00.000Z");
const SCANNED = new Date("2026-09-02T00:00:00.000Z");

let db: Record<string, ReturnType<typeof table>>;
beforeEach(() => {
  vi.mocked(recordAudit).mockClear();
  mockSelfHosted.mockReturnValue(false);
  const repo = (id: string, fullName: string, isPrivate: boolean) => ({ id, orgId: "o1", fullName, isPrivate, updatedAt: new Date(REPO_CLOCK), lastScanAt: SCANNED, guidanceGraphJson: GRAPH, manifestJson: MANIFEST });
  db = {
    organization: table([{ id: "o1", slug: "acme" }, { id: "o2", slug: "other" }]),
    repository: table([repo("r1", "acme/ledger", true), repo("r2", "acme/site", false)], true),
    scan: table([
      { id: "s1", repoId: "r1", scannedAt: SCANNED, guidanceGraphJson: GRAPH, manifestJson: MANIFEST },
      { id: "s2", repoId: "r2", scannedAt: SCANNED, guidanceGraphJson: GRAPH, manifestJson: MANIFEST },
      { id: "s3", repoId: "r1", scannedAt: SCANNED, guidanceGraphJson: "{not json", manifestJson: null },
    ]),
    scanDimension: table([
      { id: "d1", scanId: "s1", evidence: JSON.stringify([SIGNAL, CITED]) },
      { id: "d2", scanId: "s2", evidence: JSON.stringify([SIGNAL, CITED]) },
    ]),
    repoMemoryMirror: table([{ id: "m1", orgId: "o1", repoFullName: "acme/ledger" }, { id: "m2", orgId: "o1", repoFullName: "acme/site" }], true),
    orgMemory: table([
      { id: "om1", orgId: "o1", source: "repo-memory", namespace: "acme/ledger", supersededBy: "om3" },
      { id: "om2", orgId: "o1", source: "repo-memory", namespace: "acme/site", supersededBy: null },
      { id: "om3", orgId: "o1", source: "consolidation", namespace: null, supersededBy: null },
      { id: "om4", orgId: "o1", source: null, namespace: null, supersededBy: "om1" },
    ], true),
    orgMemoryCitation: table([{ id: "c1", orgId: "o1", memoryId: "om1" }, { id: "c2", orgId: "o1", memoryId: "om2" }]),
  };
  mockGetPrisma.mockReturnValue(db);
});

const snapshot = () => JSON.stringify(Object.fromEntries(Object.entries(db).map(([k, t]) => [k, t.rows])));
const byId = (t: string, id: string) => db[t]!.rows.find((r) => r.id === id)!;

describe("scrubPrivateScanContent", () => {
  it("a dry run writes nothing and counts what would change", async () => {
    const before = snapshot();
    const out = await scrubPrivateScanContent({ apply: false });
    expect(snapshot()).toBe(before);
    expect(recordAudit).not.toHaveBeenCalled();
    if (!out.ok) throw new Error(out.reason);
    expect(out.columns["ScanDimension.evidence"]).toEqual({ examined: 1, changed: 1, unchanged: 0, unparseable: [] });
    expect(out.columns["Scan.guidanceGraphJson"]).toEqual({ examined: 2, changed: 1, unchanged: 0, unparseable: ["s3"] });
    expect(out.columns["Repository.manifestJson"]).toMatchObject({ examined: 1, changed: 1 });
    expect(out.orgs).toEqual([
      expect.objectContaining({ orgSlug: "acme", privateRepos: 1, mirrorRows: 1, repoMemories: 1, citations: 1, valuesChanged: 5 }),
    ]);
  });

  it("--apply scrubs a private repo's evidence, guidance graph and manifest on Scan and Repository", async () => {
    await scrubPrivateScanContent({ apply: true });
    for (const value of [byId("scanDimension", "d1").evidence, byId("scan", "s1").guidanceGraphJson, byId("scan", "s1").manifestJson, byId("repository", "r1").guidanceGraphJson, byId("repository", "r1").manifestJson]) {
      expect(value).not.toContain(QUOTE);
      expect(value).not.toContain("pnpm vitest");
      expect(value).not.toContain("Northwind");
    }
    expect(JSON.parse(byId("scanDimension", "d1").evidence as string)).toEqual([SIGNAL, "Model cited canonical_declared (+6) — AGENTS.md"]);
    expect(byId("scan", "s3").guidanceGraphJson).toBe("{not json"); // unparseable: listed, never written
  });

  it("leaves a public repo's rows untouched", async () => {
    await scrubPrivateScanContent({ apply: true });
    expect(byId("scanDimension", "d2").evidence).toBe(JSON.stringify([SIGNAL, CITED]));
    expect(byId("scan", "s2")).toMatchObject({ guidanceGraphJson: GRAPH, manifestJson: MANIFEST });
    expect(byId("repository", "r2")).toMatchObject({ guidanceGraphJson: GRAPH, manifestJson: MANIFEST });
  });

  it("deletes a private repo's mirror rows, repo-memory rows and their citations; a public repo's stay", async () => {
    await scrubPrivateScanContent({ apply: true });
    expect(db.repoMemoryMirror!.rows.map((r) => r.id)).toEqual(["m2"]);
    expect(db.orgMemory!.rows.map((r) => r.id)).toEqual(["om2", "om3", "om4"]);
    expect(db.orgMemoryCitation!.rows.map((r) => r.id)).toEqual(["c2"]);
  });

  it("lists linked OrgMemory rows and does not touch them", async () => {
    const out = await scrubPrivateScanContent({ apply: true });
    if (!out.ok) throw new Error(out.reason);
    expect(out.orgs[0]!.linked).toEqual([
      { id: "om3", link: "successor", via: "om1" },
      { id: "om4", link: "predecessor", via: "om1" },
    ]);
    expect(byId("orgMemory", "om3")).toMatchObject({ source: "consolidation" });
  });

  it("a second --apply changes nothing and writes no audit row", async () => {
    await scrubPrivateScanContent({ apply: true });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAudit).mock.calls[0]![0]).toBe(SCRUB_ACTION);
    expect(vi.mocked(recordAudit).mock.calls[0]![2]).toEqual({ orgId: "o1" });
    const after = snapshot();
    const second = await scrubPrivateScanContent({ apply: true });
    expect(snapshot()).toBe(after);
    if (!second.ok) throw new Error(second.reason);
    for (const t of Object.values(second.columns)) expect(t.changed).toBe(0);
    expect(second.orgs[0]).toMatchObject({ mirrorRows: 0, repoMemories: 0, citations: 0, valuesChanged: 0 });
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("moves no clock: Repository.updatedAt, lastScanAt and Scan.scannedAt keep their values", async () => {
    await scrubPrivateScanContent({ apply: true });
    expect((byId("repository", "r1").updatedAt as Date).getTime()).toBe(REPO_CLOCK.getTime());
    expect(byId("repository", "r1").lastScanAt).toBe(SCANNED);
    expect(byId("scan", "s1").scannedAt).toBe(SCANNED);
  });

  it("--org limits the run to one org", async () => {
    const out = await scrubPrivateScanContent({ apply: false, orgSlug: "other" });
    if (!out.ok) throw new Error(out.reason);
    expect(out.orgs).toEqual([]);
    expect(await scrubPrivateScanContent({ apply: false, orgSlug: "nope" })).toEqual({ ok: false, reason: "unknown-org" });
  });

  it("refuses --apply on a self-hosted deployment, where local and GitHub rows cannot be told apart", async () => {
    mockSelfHosted.mockReturnValue(true);
    const before = snapshot();
    const out = await scrubPrivateScanContent({ apply: true });
    expect(out).toEqual({ ok: false, reason: "self-hosted" });
    expect(snapshot()).toBe(before);
    expect(formatScrubOutcome(out, "db.internal:5432")).toContain("REFUSED: --apply on a self-hosted deployment");
    expect((await scrubPrivateScanContent({ apply: false })).ok).toBe(true); // a dry run still works
  });

  it("prints the host first, then per-column counts", async () => {
    const text = formatScrubOutcome(await scrubPrivateScanContent({ apply: false }), "db.internal:5432");
    const lines = text.split("\n");
    expect(lines[0]).toBe("Target database host: db.internal:5432");
    expect(text).toContain("ScanDimension.evidence: examined 1, would change 1, unchanged 0, unparseable 0");
    expect(text).toContain("Scan.guidanceGraphJson: examined 2, would change 1, unchanged 0, unparseable 1");
    expect(text).toContain("  unparseable ids (not written): s3");
  });
});
