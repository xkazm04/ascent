// The content digest — the ONE thing a consumer uses to answer "am I in sync, stale, or diverged?".
//
// What is defended here is not the hashing, it is the digest's CONTRACT: one function, one pinned
// span, one normalization, and a version tag that keeps a pre-change digest identifiable instead of
// silently reading as a divergence.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { contentDigest, legacyRawDigest, normalizeForDigest, parseRegistryMemory, parseRegistryPractice, parseRegistrySkill } from "./parse";
import { DIGEST_PREFIX, digestVerdict, isLegacyDigest, shortDigest } from "./catalog";

const SKILL = ["---", "name: pr-review", "category: workflow", "---", "", "# PR review", "", "Body line.", ""].join("\n");

describe("contentDigest — line-ending normalization", () => {
  it("hashes a CRLF checkout and an LF checkout of the same file identically", () => {
    // THE BUG: raw-byte hashing made a Windows `core.autocrlf` clone report every artifact as
    // permanently diverged, for content nobody edited.
    expect(contentDigest(SKILL.replace(/\n/g, "\r\n"))).toBe(contentDigest(SKILL));
    expect(contentDigest(SKILL.replace(/\n/g, "\r"))).toBe(contentDigest(SKILL));
    expect(legacyRawDigest(SKILL.replace(/\n/g, "\r\n"))).not.toBe(legacyRawDigest(SKILL));
  });

  it("normalizes line endings and NOTHING else — a real difference still diverges", () => {
    // The over-correction the fix must not make: folding trailing whitespace, blank runs or unicode
    // would hide a genuine divergence, which is silent and therefore strictly worse than the bug.
    expect(contentDigest("a\n")).not.toBe(contentDigest("a \n")); // trailing space is content
    expect(contentDigest("a\n\nb")).not.toBe(contentDigest("a\n\n\nb")); // blank runs are content
    expect(contentDigest("café")).not.toBe(contentDigest("café")); // NFC vs NFD: no unicode folding
    expect(contentDigest("a\n")).not.toBe(contentDigest("a")); // a final newline is content
    expect(normalizeForDigest("x\r\ny\rz\n")).toBe("x\ny\nz\n");
  });
});

describe("contentDigest — the version tag", () => {
  it("tags the digest so a stored pre-change value is identifiable, not a false divergence", () => {
    const d = contentDigest(SKILL);
    expect(d.startsWith(`${DIGEST_PREFIX}:`)).toBe(true);
    expect(d).toMatch(/^sha256-n1:[0-9a-f]{64}$/);
    expect(isLegacyDigest(d)).toBe(false);
    expect(isLegacyDigest(legacyRawDigest(SKILL))).toBe(true);
    expect(shortDigest(d)).toMatch(/^sha256-n1:[0-9a-f]{16}$/);
  });

  it("reads a tagged-vs-untagged difference as `reformatted`, never as `changed`", () => {
    // The migration decision: versioning every digest at once must NOT present as a fleet-wide
    // "everything diverged" event. A consumer recomputes; it does not report an edit.
    expect(digestVerdict(legacyRawDigest(SKILL), contentDigest(SKILL))).toBe("reformatted");
    expect(digestVerdict(contentDigest(SKILL), contentDigest(SKILL))).toBe("same");
    expect(digestVerdict(contentDigest(SKILL), contentDigest(`${SKILL}more`))).toBe("changed");
    expect(digestVerdict(null, contentDigest(SKILL))).toBe("unknown");
  });

  it("is sha256 over the LF-normalized full text — the recipe the tag advertises", () => {
    const hex = createHash("sha256").update(SKILL).digest("hex");
    expect(contentDigest(SKILL.replace(/\n/g, "\r\n"))).toBe(`sha256-n1:${hex}`);
  });
});

describe("contentDigest — one pinned span across every parser", () => {
  it("hashes the WHOLE file, frontmatter included, for skills, practices and memory alike", () => {
    const skill = parseRegistrySkill("skills/pr-review/SKILL.md", SKILL);
    expect(skill.ok && skill.value.hash).toBe(contentDigest(SKILL));
    // The stripped body is NOT the span: a frontmatter-only edit must be visible to the sync verdict.
    expect(skill.ok && skill.value.hash).not.toBe(contentDigest(skill.ok ? skill.value.content : ""));

    const practiceText = "---\nid: supply-chain\ndimension: D9\n---\n\n# Supply chain\n";
    const practice = parseRegistryPractice("practices/supply-chain/PRACTICE.md", practiceText);
    expect(practice.ok && practice.value.hash).toBe(contentDigest(practiceText));

    const memoryText = "---\nkind: decision\n---\n\nWe chose Postgres.\n";
    const memory = parseRegistryMemory("memory/decision/db.md", memoryText);
    expect(memory.ok && memory.value.hash).toBe(contentDigest(memoryText));
  });

  it("gives a tag-only frontmatter edit a different digest (loud re-pull, not a silent miss)", () => {
    const edited = SKILL.replace("category: workflow", "category: workflow\ntags: a,b");
    const a = parseRegistrySkill("skills/pr-review/SKILL.md", SKILL);
    const b = parseRegistrySkill("skills/pr-review/SKILL.md", edited);
    expect(a.ok && b.ok && a.value.hash).not.toBe(b.ok ? b.value.hash : "");
  });
});
