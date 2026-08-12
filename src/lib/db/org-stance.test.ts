// org-stance persistence contracts (W3), pinned the way org-gate.test.ts pins gatePolicy:
// stanceJson is written as a SERIALIZED JSON STRING (no-jsonb DSQL contract) and re-sanitized on
// read; publishing bumps the version and supersedes the prior published row IN ONE TRANSACTION;
// drafts upsert in place at maxVersion+1; acks upsert per (org, artifact, repo); and the repo-facts
// read degrades per-blob (malformed prStats → "no PR data", corrupt rows → skipped, never a throw).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma, mockGetOrgBySlug, mockGetOrgId } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockGetOrgBySlug: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: mockGetOrgBySlug }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import {
  ackOrgStance,
  getActiveOrgStance,
  getOrgStanceAcks,
  getStanceRepoFacts,
  publishOrgStance,
  saveOrgStanceDraft,
} from "./org-stance";

const stance = { permittedTools: ["Claude Code"], provenance: { requireTrailer: true } };

/** A minimal prisma fake; pass overrides per model method. */
function fakePrisma(over: Record<string, Record<string, unknown>> = {}) {
  const p: Record<string, unknown> = {
    orgAiStance: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "row_1", orgId: "org_1", version: 1, status: "draft", publishedBy: null, publishedAt: null, createdAt: new Date(), ...data })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "row_new", publishedBy: null, publishedAt: null, createdAt: new Date(), ...data })),
      ...(over.orgAiStance ?? {}),
    },
    orgArtifactAck: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({ ...create })),
      findMany: vi.fn(async () => []),
      ...(over.orgArtifactAck ?? {}),
    },
    repository: { findMany: vi.fn(async () => []), ...(over.repository ?? {}) },
    aiChange: { groupBy: vi.fn(async () => []), ...(over.aiChange ?? {}) },
  };
  p.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p));
  return p as Record<string, ReturnType<typeof vi.fn>> & {
    orgAiStance: Record<string, ReturnType<typeof vi.fn>>;
    orgArtifactAck: Record<string, ReturnType<typeof vi.fn>>;
    repository: Record<string, ReturnType<typeof vi.fn>>;
    aiChange: Record<string, ReturnType<typeof vi.fn>>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgBySlug.mockResolvedValue({ id: "org_1" });
  mockGetOrgId.mockResolvedValue("org_1");
});

describe("saveOrgStanceDraft", () => {
  it("stores the sanitized stance as a JSON STRING at maxPublishedVersion+1", async () => {
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ version: 4 }) // latest non-draft
          .mockResolvedValueOnce(null), // no existing draft
      },
    });
    mockGetPrisma.mockReturnValue(p);

    const row = await saveOrgStanceDraft("acme", stance);
    const created = p.orgAiStance.create.mock.calls[0]![0].data;
    expect(created.version).toBe(5);
    expect(created.status).toBe("draft");
    expect(typeof created.stanceJson).toBe("string"); // serialized, never a jsonb object
    expect(JSON.parse(created.stanceJson)).toMatchObject({ permittedTools: ["Claude Code"] });
    expect(row?.status).toBe("draft");
  });

  it("REPLACES an existing draft in place instead of appending a second one", async () => {
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ version: 2 })
          .mockResolvedValueOnce({ id: "draft_1" }),
      },
    });
    mockGetPrisma.mockReturnValue(p);

    await saveOrgStanceDraft("acme", stance);
    expect(p.orgAiStance.create).not.toHaveBeenCalled();
    expect(p.orgAiStance.update.mock.calls[0]![0]).toMatchObject({ where: { id: "draft_1" } });
    expect(p.orgAiStance.update.mock.calls[0]![0].data.version).toBe(3);
  });

  it("returns null for an all-invalid stance (nothing stored) and undefined for an unknown org", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p);
    expect(await saveOrgStanceDraft("acme", { permittedTools: [] })).toBeNull();
    expect(p.$transaction).not.toHaveBeenCalled();

    mockGetOrgId.mockResolvedValue(null);
    expect(await saveOrgStanceDraft("ghost", stance)).toBeUndefined();
  });
});

describe("publishOrgStance", () => {
  it("supersedes the prior published row and publishes at its version+1, in one transaction", async () => {
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "pub_2", version: 2 }) // current published
          .mockResolvedValueOnce(null), // no draft to promote
      },
    });
    mockGetPrisma.mockReturnValue(p);

    const row = await publishOrgStance("acme", stance, "alice");
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    // Prior published row demoted…
    expect(p.orgAiStance.update.mock.calls[0]![0]).toMatchObject({ where: { id: "pub_2" }, data: { status: "superseded" } });
    // …new row created at v3, stamped with the publisher.
    const created = p.orgAiStance.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ version: 3, status: "published", publishedBy: "alice" });
    expect(created.publishedAt).toBeInstanceOf(Date);
    expect(row?.version).toBe(3);
    expect(row?.status).toBe("published");
  });

  it("promotes an existing draft row instead of appending when one exists", async () => {
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // nothing published yet
          .mockResolvedValueOnce({ id: "draft_1" }),
      },
    });
    mockGetPrisma.mockReturnValue(p);

    await publishOrgStance("acme", stance, null);
    expect(p.orgAiStance.create).not.toHaveBeenCalled();
    expect(p.orgAiStance.update.mock.calls[0]![0]).toMatchObject({
      where: { id: "draft_1" },
      data: { version: 1, status: "published" },
    });
  });
});

describe("getActiveOrgStance", () => {
  it("parses the stored TEXT string and re-sanitizes on read", async () => {
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi.fn(async () => ({
          id: "pub", orgId: "org_1", version: 2, status: "published",
          stanceJson: JSON.stringify({ permittedTools: [" Claude Code "], junk: "dropped" }),
          publishedBy: "alice", publishedAt: new Date("2026-08-01"), createdAt: new Date(),
        })),
      },
    });
    mockGetPrisma.mockReturnValue(p);

    const row = await getActiveOrgStance("acme");
    expect(row?.version).toBe(2);
    expect(row?.stance.permittedTools).toEqual(["Claude Code"]);
    expect((row?.stance as unknown as Record<string, unknown>).junk).toBeUndefined();
  });

  it("returns null (fail visibly, fall back safely) for corrupt stored JSON", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = fakePrisma({
      orgAiStance: {
        findFirst: vi.fn(async () => ({ id: "x", orgId: "org_1", version: 1, status: "published", stanceJson: "not json{", publishedBy: null, publishedAt: null, createdAt: new Date() })),
      },
    });
    mockGetPrisma.mockReturnValue(p);
    expect(await getActiveOrgStance("acme")).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("acks", () => {
  it("ackOrgStance upserts on (org, artifact, repo) with a lowercased repo key", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p);
    const ack = await ackOrgStance("acme", "Acme/API", 3, "bob");
    const call = p.orgArtifactAck.upsert.mock.calls[0]![0];
    expect(call.where).toEqual({
      orgId_artifact_repoFullName: { orgId: "org_1", artifact: "ai-stance", repoFullName: "acme/api" },
    });
    expect(call.update).toMatchObject({ version: 3, ackedBy: "bob" });
    expect(ack?.version).toBe(3);
  });

  it("getOrgStanceAcks keys by lowercased fullName", async () => {
    const p = fakePrisma({
      orgArtifactAck: {
        findMany: vi.fn(async () => [
          { repoFullName: "acme/api", version: 2, ackedBy: "bob", ackedAt: new Date() },
        ]),
      },
    });
    mockGetPrisma.mockReturnValue(p);
    const acks = await getOrgStanceAcks("acme");
    expect(acks.get("acme/api")?.version).toBe(2);
  });
});

describe("getStanceRepoFacts", () => {
  it("joins latest scan, passport autonomy tier, unapproved MERGED AiChanges and acks per repo", async () => {
    const passport = JSON.stringify({
      passport: "app-passport",
      passportVersion: "0.3.0",
      identity: { archetype: "team" },
      automationReadiness: { artifacts: {}, selfVerify: {} },
      productionReadiness: {},
      autonomy: { tier: "T2", unlocks: [], inputs: {} },
    });
    const p = fakePrisma({
      repository: {
        findMany: vi.fn(async () => [
          {
            id: "r1", name: "api", fullName: "acme/api", passportJson: passport,
            scans: [{ overallScore: 62, level: "L3", prStats: JSON.stringify({ analyzed: 20, tools: [{ name: "Claude", count: 4 }, { name: "Devin", count: 0 }], aiInvolvedRate: 30, aiTrailerRate: 15 }) }],
          },
          { id: "r2", name: "web", fullName: "acme/web", passportJson: null, scans: [{ overallScore: 40, level: "L2", prStats: "corrupt{" }] },
          { id: "r3", name: "never-scanned", fullName: "acme/never", passportJson: null, scans: [] },
        ]),
      },
      aiChange: { groupBy: vi.fn(async () => [{ repoId: "r1", _count: { _all: 2 } }]) },
      orgArtifactAck: { findMany: vi.fn(async () => [{ repoFullName: "acme/api", version: 1, ackedBy: null, ackedAt: new Date() }]) },
    });
    mockGetPrisma.mockReturnValue(p);

    const facts = await getStanceRepoFacts("acme");
    expect(facts).toHaveLength(2); // never-scanned repo is skipped

    const api = facts.find((f) => f.fullName === "acme/api")!;
    expect(api).toMatchObject({
      autonomyTier: "T2",
      aiInvolvedRate: 30,
      aiTrailerRate: 15,
      unapprovedAiChanges: 2,
      ackedVersion: 1,
    });
    expect(api.observedTools).toEqual(["Claude"]); // zero-count tools are not "observed"

    const web = facts.find((f) => f.fullName === "acme/web")!;
    // Malformed prStats degrades to "no PR data"; missing passport = tier not assessed, never a default.
    expect(web).toMatchObject({ autonomyTier: null, aiInvolvedRate: null, aiTrailerRate: null, observedTools: [] });

    // The groupBy is pinned to the auditor's population: MERGED without approval.
    expect(p.aiChange.groupBy.mock.calls[0]![0].where).toMatchObject({ approved: false, state: "MERGED" });
  });
});
