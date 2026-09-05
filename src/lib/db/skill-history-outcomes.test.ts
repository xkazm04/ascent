// The skill-generation -> progress-note -> verified-delta join (moonshot #14).
// FAILS BEFORE: `getSkillGenerationOutcomes` did not exist — a SkillGeneration row had no outcome link.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  listRepoProgressNotes: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: h.getPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/repo-memory", () => ({ listRepoProgressNotes: h.listRepoProgressNotes }));
vi.mock("@/lib/db/scans-read", () => ({ getRepositoryHistory: h.getRepositoryHistory }));

import { getSkillGenerationOutcomes, noteMentionsTrack } from "@/lib/db/skill-history";

const REPO = "acme/api";

const generation = (id: string, generatedAt: string, trackIds: string[]) => ({
  id,
  repoFullName: REPO,
  headSha: null,
  trackIds: JSON.stringify(trackIds),
  generatedAt: new Date(generatedAt),
});

const note = (path: string, body: string, firstSeenAt: string, entryDate: string | null = null) => ({
  id: path,
  repoFullName: REPO,
  path,
  entryId: null,
  rawKind: "progress",
  mappedKind: "episodic",
  scope: null,
  entryDate,
  supersedes: null,
  refs: [],
  body,
  headSha: null,
  superseded: false,
  orgMemoryId: null,
  skipReason: null,
  firstSeenAt,
  lastSeenAt: firstSeenAt,
});

const scan = (scannedAt: string, overallScore: number) => ({ scannedAt, overallScore });

function wire(gens: ReturnType<typeof generation>[], notes: ReturnType<typeof note>[], scans: ReturnType<typeof scan>[]) {
  h.getPrisma.mockReturnValue({ skillGeneration: { findMany: vi.fn(async () => gens) } });
  h.listRepoProgressNotes.mockResolvedValue(notes);
  h.getRepositoryHistory.mockResolvedValue({ repo: { owner: "acme", name: "api", fullName: REPO }, scans });
}

beforeEach(() => vi.clearAllMocks());

describe("noteMentionsTrack — exact tokens, never fuzzy", () => {
  it("matches a whole token in any position", () => {
    expect(noteMentionsTrack("finished the ci-hardening track today", "ci-hardening")).toBe(true);
    expect(noteMentionsTrack("CI-HARDENING done", "ci-hardening")).toBe(true);
  });

  it("does NOT match a substring — a near-miss is not evidence of work", () => {
    expect(noteMentionsTrack("worked on ci-hardening-v2 instead", "ci-hardening")).toBe(false);
    expect(noteMentionsTrack("hardening", "ci-hardening")).toBe(false);
  });

  it("never matches an empty track id", () => {
    expect(noteMentionsTrack("anything", "")).toBe(false);
  });
});

describe("getSkillGenerationOutcomes", () => {
  it("pairs a generation with the notes that name its tracks", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening", "test-coverage"])],
      [
        note("a.md", "closed out ci-hardening this week", "2026-06-05T00:00:00.000Z", "2026-06-05"),
        note("b.md", "unrelated refactor note", "2026-06-06T00:00:00.000Z"),
      ],
      [scan("2026-05-30T00:00:00.000Z", 60), scan("2026-06-10T00:00:00.000Z", 72)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.progressNotes).toEqual([{ path: "a.md", entryDate: "2026-06-05", trackIds: ["ci-hardening"] }]);
    expect(out!.verifiedDelta).toBe(12);
    expect(out!.baselineScanAt).toBe("2026-06-10T00:00:00.000Z");
  });

  it("ignores a note written BEFORE the generation — it cannot be reporting on it", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening"])],
      [note("old.md", "ci-hardening notes from last quarter", "2026-04-01T00:00:00.000Z")],
      [scan("2026-05-01T00:00:00.000Z", 60), scan("2026-07-01T00:00:00.000Z", 80)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.progressNotes).toEqual([]);
    expect(out!.verifiedDelta).toBeNull();
  });

  it("G4: no post-note scan means verifiedDelta is NULL, never 0", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening"])],
      [note("a.md", "did ci-hardening", "2026-06-05T00:00:00.000Z")],
      [scan("2026-05-30T00:00:00.000Z", 60)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.progressNotes).toHaveLength(1);
    expect(out!.verifiedDelta).toBeNull();
    expect(out!.baselineScanAt).toBeNull();
  });

  it("G4: no pre-generation scan means NULL too — one scan is a score, not a delta", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening"])],
      [note("a.md", "did ci-hardening", "2026-06-05T00:00:00.000Z")],
      [scan("2026-06-10T00:00:00.000Z", 72)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.verifiedDelta).toBeNull();
  });

  it("reports a NEGATIVE delta as readily as a positive one", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening"])],
      [note("a.md", "did ci-hardening", "2026-06-05T00:00:00.000Z")],
      [scan("2026-05-30T00:00:00.000Z", 70), scan("2026-06-10T00:00:00.000Z", 64)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.verifiedDelta).toBe(-6);
  });

  it("measures from the first scan after the NEWEST matching note, not the first", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening", "test-coverage"])],
      [
        note("a.md", "started ci-hardening", "2026-06-05T00:00:00.000Z"),
        note("b.md", "finished test-coverage", "2026-06-20T00:00:00.000Z"),
      ],
      [scan("2026-05-30T00:00:00.000Z", 60), scan("2026-06-10T00:00:00.000Z", 63), scan("2026-06-25T00:00:00.000Z", 78)],
    );
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.baselineScanAt).toBe("2026-06-25T00:00:00.000Z");
    expect(out!.verifiedDelta).toBe(18);
  });

  it("degrades to an unmeasured outcome when the history read fails", async () => {
    wire(
      [generation("sg_1", "2026-06-01T00:00:00.000Z", ["ci-hardening"])],
      [note("a.md", "did ci-hardening", "2026-06-05T00:00:00.000Z")],
      [],
    );
    h.getRepositoryHistory.mockRejectedValue(new Error("db down"));
    const [out] = await getSkillGenerationOutcomes(REPO, "org_1");
    expect(out!.verifiedDelta).toBeNull();
    expect(out!.progressNotes).toHaveLength(1);
  });

  it("returns [] with no generations, and never reads memory for a blank org", async () => {
    wire([], [], []);
    expect(await getSkillGenerationOutcomes(REPO, "org_1")).toEqual([]);
    expect(await getSkillGenerationOutcomes(REPO, "")).toEqual([]);
    expect(h.listRepoProgressNotes).toHaveBeenCalledTimes(1);
  });
});
