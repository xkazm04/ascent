// listOrgSkillsPage: the user-facing, paged skills read. Pins the limit clamp, the limit + 1 fetch that
// detects truncation, that the page shares listOrgSkills's where/orderBy, and that listOrgSkills's own
// query is still unbounded (its internal callers need the whole non-archived set).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import {
  SKILLS_PAGE_DEFAULT,
  SKILLS_PAGE_MAX,
  clampSkillsLimit,
  listOrgSkills,
  listOrgSkillsPage,
} from "@/lib/db/org-skills";

type FindManyArgs = { where: unknown; orderBy: unknown; take?: number };
const calls: FindManyArgs[] = [];

function row(i: number) {
  return {
    id: `s${i}`,
    name: `skill-${i}`,
    description: "",
    content: "body",
    category: "workflow",
    tags: "[]",
    version: 1,
    contentHash: "h",
    downloadCount: 0,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    _count: { adoptions: 0 },
  };
}

function setup(available: number, known = true) {
  calls.length = 0;
  mockGetPrisma.mockReturnValue({
    organization: { findUnique: vi.fn(async () => (known ? { id: "org_acme" } : null)) },
    orgSkill: {
      findMany: vi.fn(async (args: FindManyArgs) => {
        calls.push(args);
        return Array.from({ length: Math.min(available, args.take ?? available) }, (_, i) => row(i));
      }),
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("clampSkillsLimit", () => {
  it("clamps 0, -1, 10_000 and undefined", () => {
    expect(clampSkillsLimit(0)).toBe(1);
    expect(clampSkillsLimit(-1)).toBe(1);
    expect(clampSkillsLimit(10_000)).toBe(SKILLS_PAGE_MAX);
    expect(clampSkillsLimit(undefined)).toBe(SKILLS_PAGE_DEFAULT);
    expect(clampSkillsLimit(Number.NaN)).toBe(SKILLS_PAGE_DEFAULT);
    expect(clampSkillsLimit(7.9)).toBe(7);
  });

  it("declares 200 / 500 like listOrgMemories", () => {
    expect([SKILLS_PAGE_DEFAULT, SKILLS_PAGE_MAX]).toEqual([200, 500]);
  });
});

describe("listOrgSkillsPage", () => {
  it("takes limit + 1 rows, returns at most limit, and reports truncated", async () => {
    setup(50);
    const page = await listOrgSkillsPage("acme", { limit: 10 });
    expect(calls[0].take).toBe(11);
    expect(page?.skills).toHaveLength(10);
    expect(page).toMatchObject({ truncated: true, limit: 10 });
  });

  it("is not truncated when the library fits the page", async () => {
    setup(10);
    const page = await listOrgSkillsPage("acme", { limit: 10 });
    expect(page?.skills).toHaveLength(10);
    expect(page?.truncated).toBe(false);
  });

  it("applies the default and the clamp to the query", async () => {
    setup(0);
    await listOrgSkillsPage("acme");
    await listOrgSkillsPage("acme", { limit: 10_000 });
    await listOrgSkillsPage("acme", { limit: -1 });
    expect(calls.map((c) => c.take)).toEqual([201, 501, 2]);
  });

  it("returns an empty page for an unknown org", async () => {
    setup(5, false);
    expect(await listOrgSkillsPage("nope")).toEqual({ skills: [], truncated: false, limit: SKILLS_PAGE_DEFAULT });
    expect(calls).toHaveLength(0);
  });

  it("builds the same where and orderBy as listOrgSkills", async () => {
    setup(1);
    const opts = { category: "workflow", search: " deploy ", sort: "name" as const };
    await listOrgSkillsPage("acme", opts);
    await listOrgSkills("acme", opts);
    expect(calls[0].where).toEqual(calls[1].where);
    expect(calls[0].orderBy).toEqual(calls[1].orderBy);
  });
});

describe("listOrgSkills — unchanged", () => {
  it("still reads without a take", async () => {
    setup(3);
    const rows = await listOrgSkills("acme");
    expect(rows).toHaveLength(3);
    expect(calls[0]).not.toHaveProperty("take");
  });
});
