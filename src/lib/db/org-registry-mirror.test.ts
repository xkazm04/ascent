// The mirror row's `contentHash` and the catalog entry for the same path must be THE SAME DIGEST.
//
// This column is what `listOrgSkillManifest` publishes as the sync manifest's change key, so it is one
// of the two values a consumer compares. It used to be a sha over the frontmatter-stripped, 50KB-capped
// body while the catalog hashed the whole file — two spans, so equality across the two surfaces meant
// nothing and inequality explained nothing. That is the regression this file pins.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { upsertRegistryPractice, upsertRegistrySkill } from "@/lib/db/org-registry-mirror";
import { parseRegistryPractice, parseRegistrySkill, contentDigest } from "@/lib/registry/parse";
import { shortDigest } from "@/lib/registry/catalog";

function mirrorPrisma() {
  const created: Record<string, unknown>[] = [];
  const table = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      created.push(a.data);
      return { id: "row-1" };
    }),
    update: vi.fn(async () => ({ id: "row-1" })),
  };
  mockGetPrisma.mockReturnValue({ orgSkill: table, orgPracticeShape: table, orgMemory: table });
  return created;
}

beforeEach(() => mockGetPrisma.mockReset());

const SKILL = "---\nname: pr-review\ncategory: workflow\n---\n\n# PR review\n\nBody.\n";
const PRACTICE = "---\nid: supply-chain\ndimension: D9\n---\n\n# Supply chain\n";

describe("mirror rows carry the catalog's digest", () => {
  it("writes the file's canonical digest as a skill row's contentHash, not a body hash", async () => {
    const created = mirrorPrisma();
    const parsed = parseRegistrySkill("skills/pr-review/SKILL.md", SKILL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await upsertRegistrySkill("org-1", "reg-1", parsed.value);
    expect(created[0]!.contentHash).toBe(contentDigest(SKILL));
    // The manifest key and the catalog entry are now the same digest, one short of the other.
    expect(shortDigest(String(created[0]!.contentHash))).toBe(shortDigest(parsed.value.hash));
    // …and NOT the old span: the stored (stripped, capped) body.
    expect(created[0]!.contentHash).not.toBe(contentDigest(String(created[0]!.content)));
  });

  it("does the same for a practice row", async () => {
    const created = mirrorPrisma();
    const parsed = parseRegistryPractice("practices/supply-chain/PRACTICE.md", PRACTICE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    await upsertRegistryPractice("org-1", "reg-1", parsed.value);
    expect(created[0]!.contentHash).toBe(contentDigest(PRACTICE));
    expect(created[0]!.registryHash).toBe(created[0]!.contentHash);
  });
});
