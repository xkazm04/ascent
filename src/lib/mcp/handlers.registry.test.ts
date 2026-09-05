// The registry tools' handlers — the absence answers, and the honest null.
//
// These handlers are thin, so what is worth testing is not their arithmetic (that lives in
// skill-match.ts and is tested there) but WHAT THEY SAY WHEN THERE IS NOTHING TO SAY. An agent handed
// an empty list reads "nothing to worry about" and proceeds; an agent handed `dimensionBasis: []`
// reads "this repo is healthy". Both are wrong for an unscanned repo, and both are one careless
// default away.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  getOrgRollup: vi.fn(async () => ({ repos: [] })),
  listOrgSkills: vi.fn(async () => []),
  recordSkillEvents: vi.fn(async () => ({ recorded: 1 })),
}));
vi.mock("@/lib/db/org-registry-subjects", () => ({ listOrgKnowledgeSubjects: vi.fn(async () => []) }));
vi.mock("@/lib/db/org-skill-lessons", () => ({ listSkillLessons: vi.fn(async () => []) }));
vi.mock("@/lib/db/org-memory-citations", () => ({
  recordMemoryCitation: vi.fn(async () => ({ outcome: "created", counts: { citedCount: 1, notUsefulCount: 0 } })),
}));

import { getOrgRollup, listOrgSkills, recordSkillEvents } from "@/lib/db";
import { listOrgKnowledgeSubjects } from "@/lib/db/org-registry-subjects";
import { findSkills, getGoverningSubject, getSkill, getSkillLessons } from "./registry-reads";
import { citeMemory, invokeEventTs, reportSkillInvoke } from "./registry-writes";

const mockRollup = vi.mocked(getOrgRollup);
const mockSkills = vi.mocked(listOrgSkills);
const mockSubjects = vi.mocked(listOrgKnowledgeSubjects);
const mockEvents = vi.mocked(recordSkillEvents);

const aSkill = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "release-checklist",
  description: "How we cut a release here.",
  content: "# Release\n",
  category: "ci-cd",
  tags: [],
  adoptionCount: 0,
  downloadCount: 0,
  origin: "registry",
  registryPath: "skills/release-checklist/SKILL.md",
  registryVersion: "2.1",
  contentHash: "sha256-n1:abc",
  ...over,
});

const text = (r: { structuredContent: unknown }) => JSON.stringify(r.structuredContent);

beforeEach(() => {
  vi.clearAllMocks();
  mockRollup.mockResolvedValue({ repos: [] } as never);
  mockSkills.mockResolvedValue([aSkill()] as never);
  mockSubjects.mockResolvedValue([]);
  mockEvents.mockResolvedValue({ recorded: 1 });
});

describe("find_skills — the dimension basis", () => {
  it("is NULL, with a sentence, for a repo that has never been scanned", async () => {
    mockRollup.mockResolvedValue({ repos: [{ fullName: "acme/api", latest: null }] } as never);

    const res = await findSkills("acme", { task: "cut a release", repo: "acme/api" });
    const sc = res.structuredContent as { dimensionBasis: unknown; dimensionBasisNote: string };

    // FAIL-BEFORE: default the basis to `{ weakDims: [] }` for an unscanned repo and this flips —
    // the agent is then told the repo is weak nowhere, which is a claim nothing measured.
    expect(sc.dimensionBasis).toBeNull();
    expect(sc.dimensionBasis).not.toEqual([]);
    expect(sc.dimensionBasisNote).toMatch(/never been scanned/);
    expect(sc.dimensionBasisNote).toMatch(/not a clean bill of health/);
  });

  it("is null and says so for a repo that is not in the fleet", async () => {
    const res = await findSkills("acme", { task: "cut a release", repo: "other/repo" });
    const sc = res.structuredContent as { dimensionBasis: unknown; dimensionBasisNote: string };
    expect(sc.dimensionBasis).toBeNull();
    expect(sc.dimensionBasisNote).toMatch(/not in this organization's fleet/);
  });

  it("carries the measured weak dimensions when the repo HAS a scan", async () => {
    mockRollup.mockResolvedValue({
      repos: [{ fullName: "acme/api", latest: { overall: 70, scannedAt: "2026-08-01T00:00:00.000Z", dims: [{ dimId: "D3", score: 10 }] } }],
    } as never);

    const res = await findSkills("acme", { task: "cut a release", repo: "acme/api" });
    const sc = res.structuredContent as { dimensionBasis: { weakDims: string[]; repo: string } };
    expect(sc.dimensionBasis).toMatchObject({ repo: "acme/api", weakDims: ["D3"] });
  });

  it("answers an empty library in words, not with an empty list", async () => {
    mockSkills.mockResolvedValue([] as never);
    const res = await findSkills("acme", { task: "anything" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/absence, not permission/);
  });
});

describe("get_skill / get_skill_lessons", () => {
  it("names where a registry skill actually lives, so an edit is proposed in the right place", async () => {
    const res = await getSkill("acme", { name: "release-checklist" });
    expect(res.structuredContent).toMatchObject({
      origin: "registry",
      registryPath: "skills/release-checklist/SKILL.md",
      registryVersion: "2.1",
    });
  });

  it("refuses an unknown skill by pointing at find_skills", async () => {
    const res = await getSkill("acme", { name: "nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/find_skills/);
  });

  it("says no lessons are RECORDED rather than implying the skill always went well", async () => {
    const res = await getSkillLessons("acme", { name: "release-checklist" });
    expect(res.isError).toBeUndefined();
    expect(text(res)).toMatch(/not that the skill has always gone smoothly/);
  });
});

describe("get_governing_subject", () => {
  it("refuses explicitly when no registry is mapped — absence is not permission", async () => {
    const res = await getGoverningSubject("acme", { path: "src/lib/db/client.ts" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No AI registry is mapped/);
    expect(res.text).toMatch(/not permission to invent one/);
  });

  it("resolves through the MIRRORED file path, never one built from the slug", async () => {
    mockSubjects.mockResolvedValue([
      {
        bundle: "software-engineering",
        slug: "database-access",
        category: null,
        subcategory: null,
        status: "active",
        file: "knowledge/software-engineering/subjects/db-access.md",
        techniqueCount: 3,
        useWhen: ["changing a prisma client", "adding a query"],
        laws: [],
        indexedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const res = await getGoverningSubject("acme", { topic: "adding a query" });
    const sc = res.structuredContent as { subjects: { file: string; slug: string }[] };
    // The path is data the index published; a path built from the slug would be a guess that 404s
    // the day the registry reorganizes.
    expect(sc.subjects[0]!.file).toBe("knowledge/software-engineering/subjects/db-access.md");
    expect(sc.subjects[0]!.file).not.toContain("database-access");
  });

  it("says nothing governs it rather than returning an empty list unexplained", async () => {
    mockSubjects.mockResolvedValue([
      {
        bundle: "b",
        slug: "unrelated",
        category: null,
        subcategory: null,
        status: null,
        file: "f.md",
        techniqueCount: 0,
        useWhen: ["something else entirely"],
        laws: [],
        indexedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    const res = await getGoverningSubject("acme", { topic: "quantum kubernetes" });
    expect(text(res)).toMatch(/unguided here, not unconstrained/);
  });
});

describe("report_skill_invoke", () => {
  it("sets session AND a bucketed ts, so a retry produces the same dedupe identity", async () => {
    const t0 = Date.parse("2026-08-30T10:05:00.000Z");
    const t1 = Date.parse("2026-08-30T10:47:30.000Z"); // a retry 42 minutes later

    await reportSkillInvoke("acme", { skill: "release-checklist", session: "s1" }, t0);
    await reportSkillInvoke("acme", { skill: "release-checklist", session: "s1" }, t1);

    const first = mockEvents.mock.calls[0]![1][0]!;
    const second = mockEvents.mock.calls[1]![1][0]!;
    // `OrgSkillEvent`'s dedupe key hashes (session, skill, ts). A raw wall clock would give the retry
    // a different key and record it as a second invocation.
    expect(first.session).toBe("s1");
    expect(first.ts).toBe(second.ts);
    expect(first.ts).toBe(invokeEventTs(t0));
    expect(first.source).toBe("mcp");
    expect(first.type).toBe("invoke");
  });

  it("reports a duplicate as already-recorded rather than as a failure to retry", async () => {
    mockEvents.mockResolvedValue({ recorded: 0 });
    const res = await reportSkillInvoke("acme", { skill: "release-checklist", session: "s1" }, Date.now());
    expect(res.isError).toBeUndefined();
    expect(text(res)).toMatch(/Already recorded for this session/);
  });

  it("warns about a stale local copy instead of silently accepting the version", async () => {
    const res = await reportSkillInvoke("acme", { skill: "release-checklist", session: "s1", version: "1.0" }, Date.now());
    const sc = res.structuredContent as { staleLocalCopy: unknown; warning: string };
    expect(sc.staleLocalCopy).toEqual({ claimed: "1.0", current: "2.1" });
    expect(sc.warning).toMatch(/out of date/);
  });

  it("refuses an unknown skill rather than recording an event against nothing", async () => {
    const res = await reportSkillInvoke("acme", { skill: "ghost", session: "s1" }, Date.now());
    expect(res.isError).toBe(true);
    expect(mockEvents).not.toHaveBeenCalled();
  });
});

describe("cite_memory", () => {
  it("refuses a missing `used` rather than defaulting it to true", async () => {
    // The one direction this counter must never drift: a malformed call must not become positive
    // evidence that a memory helped.
    const res = await citeMemory("acme", { id: "m1", session: "s1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/boolean/);
  });

  it("states that the counts are self-reported, on every successful citation", async () => {
    const res = await citeMemory("acme", { id: "m1", session: "s1", used: true });
    expect(text(res)).toMatch(/self-reported/);
    expect(text(res)).toMatch(/not that it demonstrably was/);
  });
});
