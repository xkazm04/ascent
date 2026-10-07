// The four best-effort reads/writes in skill-history each keep their degraded value AND reach a door.
//
// Every one of these sites used to swallow its failure: a corrupt trackIds row read as "no tracks", a
// failed upsert lost a history record, a failed scan-history read left every verifiedDelta "—", and a
// failed outcome lookup read as "no last run". Those degraded values are still right (an absence, never
// a fabricated 0) — what is pinned here is that each failure now also leaves a trace: a console.warn
// naming the read, plus telemetry (reportHandledError) for the three that call reportDegraded.
// parseTrackIds is log-only (row damage, not an outage), so it must NOT reach telemetry.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(() => true),
  upsert: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  listRepoProgressNotes: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => h.isDbConfigured(),
  getPrisma: () => ({
    skillGeneration: { upsert: h.upsert, findMany: h.findMany },
    organization: { findUnique: h.findUnique },
  }),
}));
vi.mock("@/lib/db/repo-memory", () => ({ listRepoProgressNotes: h.listRepoProgressNotes }));
vi.mock("@/lib/db/scans-read", () => ({ getRepositoryHistory: h.getRepositoryHistory }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { reportHandledError } from "@/lib/api/respond";
import {
  getLatestSkillGenerationOutcome,
  getSkillGenerationOutcomes,
  getSkillHistory,
  recordSkillGeneration,
} from "./skill-history";

const REPO = "acme/api";

const row = (trackIds: string, id = "sg_1", generatedAt = "2026-06-01T00:00:00.000Z") => ({
  id,
  repoFullName: REPO,
  headSha: null,
  trackIds,
  generatedAt: new Date(generatedAt),
});

const note = (path: string, body: string, firstSeenAt: string) => ({
  id: path,
  repoFullName: REPO,
  path,
  entryDate: null,
  body,
  firstSeenAt,
  lastSeenAt: firstSeenAt,
});

/** Every console.warn message (first argument) so far, as strings. */
const warned = (spy: MockInstance) => spy.mock.calls.map((c) => String(c[0]));

let warn: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.upsert.mockResolvedValue({});
  h.findMany.mockResolvedValue([]);
  h.listRepoProgressNotes.mockResolvedValue([]);
  h.getRepositoryHistory.mockResolvedValue({ repo: { owner: "acme", name: "api", fullName: REPO }, scans: [] });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("parseTrackIds (skill-history.ts:20-30) — via getSkillHistory", () => {
  it("a corrupt trackIds blob reads as [] AND logs that the column is unreadable", async () => {
    h.findMany.mockResolvedValue([row("{not json")]);
    const [r] = await getSkillHistory(REPO);
    expect(r!.trackIds).toEqual([]);
    expect(warned(warn).some((m) => m.includes("SkillGeneration.trackIds unreadable"))).toBe(true);
  });

  it("is a LOG door only — row damage is not reported to telemetry", async () => {
    h.findMany.mockResolvedValue([row("[\"D2\"")]);
    await getSkillHistory(REPO);
    expect(warn).toHaveBeenCalled();
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("valid JSON of the wrong shape is tolerated as [] WITHOUT a warning (not damage)", async () => {
    h.findMany.mockResolvedValue([row('{"a":1}'), row('["D2",3,"D9"]', "sg_2")]);
    const rows = await getSkillHistory(REPO);
    expect(rows.map((r) => r.trackIds)).toEqual([[], ["D2", "D9"]]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("recordSkillGeneration's catch (skill-history.ts:69-72)", () => {
  it("a rejected upsert resolves undefined (the download is never broken) and reaches both doors", async () => {
    const boom = new Error("db down");
    h.upsert.mockRejectedValue(boom);
    await expect(recordSkillGeneration(REPO, "abc123", ["D2"])).resolves.toBeUndefined();
    expect(warned(warn).some((m) => m.includes("recordSkillGeneration"))).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ message: expect.stringContaining("recordSkillGeneration") }),
    );
  });

  it("a successful write reaches no door", async () => {
    await recordSkillGeneration(REPO, "abc123", ["D2"]);
    expect(warn).not.toHaveBeenCalled();
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});

describe("getSkillGenerationOutcomes' getRepositoryHistory rejection (skill-history.ts:152-158)", () => {
  function wireMatchedGeneration() {
    h.findMany.mockResolvedValue([row(JSON.stringify(["ci-hardening"]))]);
    h.listRepoProgressNotes.mockResolvedValue([
      note("a.md", "closed out ci-hardening", "2026-06-05T00:00:00.000Z"),
    ]);
  }

  it("a failed history read leaves verifiedDelta null (unmeasured, never 0) and reaches both doors", async () => {
    wireMatchedGeneration();
    const boom = new Error("history read failed");
    h.getRepositoryHistory.mockRejectedValue(boom);

    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    // The rest of the join survives: the generation and its matched note are still there.
    expect(out!.progressNotes.map((n) => n.path)).toEqual(["a.md"]);
    expect(out!.verifiedDelta).toBeNull();
    expect(out!.baselineScanAt).toBeNull();

    expect(warned(warn).some((m) => m.includes("getRepositoryHistory (verified delta)"))).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ message: expect.stringContaining("getRepositoryHistory (verified delta)") }),
    );
  });

  it("control: with the history read healthy the same join measures a delta and reaches no door", async () => {
    wireMatchedGeneration();
    h.getRepositoryHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: REPO },
      scans: [
        { scannedAt: "2026-05-30T00:00:00.000Z", overallScore: 60 },
        { scannedAt: "2026-06-10T00:00:00.000Z", overallScore: 72 },
      ],
    });
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.verifiedDelta).toBe(12);
    expect(reportHandledError).not.toHaveBeenCalled();
  });
});

describe("getLatestSkillGenerationOutcome's catch (skill-history.ts:231-235)", () => {
  it("a failed org lookup reads as null ('no last run') and reaches both doors", async () => {
    const boom = new Error("org lookup failed");
    h.findUnique.mockRejectedValue(boom);
    await expect(getLatestSkillGenerationOutcome(REPO, "Acme")).resolves.toBeNull();
    expect(warned(warn).some((m) => m.includes("getLatestSkillGenerationOutcome"))).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ message: expect.stringContaining("getLatestSkillGenerationOutcome") }),
    );
  });

  it("a failure INSIDE the outcome join (generation read) also lands on this door, still null", async () => {
    h.findUnique.mockResolvedValue({ id: "org_1" });
    h.findMany.mockRejectedValue(new Error("generation read failed"));
    await expect(getLatestSkillGenerationOutcome(REPO, "acme")).resolves.toBeNull();
    expect(reportHandledError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ message: expect.stringContaining("getLatestSkillGenerationOutcome") }),
    );
  });
});
