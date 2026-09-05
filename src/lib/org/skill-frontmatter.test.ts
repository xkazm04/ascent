// Unit tests for the Skills Library frontmatter contract. This module is the gate every skill write
// passes through, so the tests pin the contract itself: what parses, what is REJECTED (with an
// actionable message), what repair/injection produces, and the read-time backfill for legacy rows.

import { describe, it, expect } from "vitest";
import {
  effectiveSkillFrontmatter,
  ensureFrontmatter,
  normalizeFrontmatterCategory,
  parseSkillFrontmatter,
  reconcileSkillWrite,
  serializeFrontmatter,
  slugifySkillName,
} from "@/lib/org/skill-frontmatter";

const doc = (fm: string, body = "# Body\n\nDo the thing.") => `---\n${fm}\n---\n\n${body}`;

describe("parseSkillFrontmatter — happy path", () => {
  it("reads name/description/category/tags and returns the body", () => {
    const res = parseSkillFrontmatter(
      doc('name: pr-review\ndescription: "Review a PR: correctness, tests, security."\ncategory: workflow\ntags: review, pull-request'),
    );
    expect(res.ok).toBe(true);
    expect(res.present).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.data).toEqual({
      name: "pr-review",
      description: "Review a PR: correctness, tests, security.",
      category: "workflow",
      tags: ["review", "pull-request"],
    });
    expect(res.body).toBe("# Body\n\nDo the thing.");
  });

  it("category is optional (null when undeclared)", () => {
    const res = parseSkillFrontmatter(doc("name: a-skill\ndescription: Does a thing."));
    expect(res.ok).toBe(true);
    expect(res.data?.category).toBeNull();
    expect(res.data?.tags).toEqual([]);
  });

  it("normalizes category case/format into the closed set", () => {
    for (const raw of ["AI-Native", "ai_native", " AI NATIVE ", "CI-CD"]) {
      expect(normalizeFrontmatterCategory(raw)).toBe(raw.toLowerCase().includes("ci") ? "ci-cd" : "ai-native");
    }
    const res = parseSkillFrontmatter(doc("name: a-skill\ndescription: X.\ncategory: SECURITY"));
    expect(res.ok).toBe(true);
    expect(res.data?.category).toBe("security");
  });

  it("accepts an inline list and a block list for tags", () => {
    expect(parseSkillFrontmatter(doc("name: a\ndescription: X.\ntags: [ci, 'github-actions']")).data?.tags).toEqual([
      "ci",
      "github-actions",
    ]);
    expect(parseSkillFrontmatter(doc("name: a\ndescription: X.\ntags:\n  - ci\n  - docs")).data?.tags).toEqual([
      "ci",
      "docs",
    ]);
  });

  it("tolerates CRLF, a leading BOM, blank lines and comments", () => {
    const crlf = "﻿\r\n---\r\n# a comment\r\nname: crlf-skill\r\n\r\ndescription: Windows-authored.\r\n---\r\n\r\nBody line.\r\n";
    const res = parseSkillFrontmatter(crlf);
    expect(res.ok).toBe(true);
    expect(res.data?.name).toBe("crlf-skill");
    expect(res.data?.description).toBe("Windows-authored.");
    expect(res.body).toBe("Body line.\n");
  });
});

describe("parseSkillFrontmatter — rejections", () => {
  it("flags a missing block as not present (distinct from broken)", () => {
    const res = parseSkillFrontmatter("# Just markdown\n\nno block here");
    expect(res.ok).toBe(false);
    expect(res.present).toBe(false);
    expect(res.data).toBeNull();
    expect(res.errors[0]).toMatch(/no YAML frontmatter block/);
    expect(res.body).toBe("# Just markdown\n\nno block here");
  });

  it("a partial block reports EVERY missing required field", () => {
    const res = parseSkillFrontmatter(doc("category: testing"));
    expect(res.ok).toBe(false);
    expect(res.present).toBe(true);
    expect(res.errors.some((e) => /missing required field `name`/.test(e))).toBe(true);
    expect(res.errors.some((e) => /missing required field `description`/.test(e))).toBe(true);
  });

  it("rejects a non-kebab-case name and suggests the slug", () => {
    const res = parseSkillFrontmatter(doc("name: PR Review Checklist\ndescription: X."));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/kebab-case slug/);
    expect(res.errors[0]).toContain("pr-review-checklist");
  });

  it("rejects an unknown category and lists the valid values", () => {
    const res = parseSkillFrontmatter(doc("name: a\ndescription: X.\ncategory: devops"));
    expect(res.ok).toBe(false);
    const err = res.errors.find((e) => /`category`/.test(e)) ?? "";
    expect(err).toContain("ci-cd");
    expect(err).toContain("ai-native");
    expect(err).toContain("other");
    expect(err).toContain('Got "devops"');
  });

  it("rejects an empty description", () => {
    const res = parseSkillFrontmatter(doc('name: a\ndescription: ""'));
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /missing required field `description`/.test(e))).toBe(true);
  });

  it("rejects an unterminated block", () => {
    const res = parseSkillFrontmatter("---\nname: a\ndescription: X.\n\n# body with no close");
    expect(res.ok).toBe(false);
    expect(res.present).toBe(true);
    expect(res.errors[0]).toMatch(/never closed/);
  });

  it("rejects a garbage line inside the block", () => {
    const res = parseSkillFrontmatter(doc("name: a\ndescription: X.\nthis is not a field"));
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /expected `key: value`/.test(e))).toBe(true);
  });
});

describe("slugifySkillName / serializeFrontmatter", () => {
  it("slugifies human names", () => {
    expect(slugifySkillName("PR Review Checklist")).toBe("pr-review-checklist");
    expect(slugifySkillName("  Generate Tests (v2)!  ")).toBe("generate-tests-v2");
    expect(slugifySkillName("已")).toBe("");
  });

  it("round-trips through the serializer", () => {
    const fm = { name: "a-skill", description: 'Line one "quoted"', category: "docs" as const, tags: ["x"] };
    const out = serializeFrontmatter(fm);
    const parsed = parseSkillFrontmatter(`${out}\n\nbody`);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ ...fm, description: "Line one 'quoted'" });
  });
});

describe("ensureFrontmatter", () => {
  it("injects a block when the document has none", () => {
    const out = ensureFrontmatter("# Title\n\nbody", {
      name: "PR Review Checklist",
      description: "Review a PR.",
      category: "workflow",
      tags: ["review"],
    });
    expect(out.startsWith("---\nname: pr-review-checklist\n")).toBe(true);
    expect(out).toContain('description: "Review a PR."');
    expect(out).toContain("category: workflow");
    expect(out).toContain("tags: review");
    expect(out.endsWith("# Title\n\nbody")).toBe(true);
    expect(parseSkillFrontmatter(out).ok).toBe(true);
  });

  it("repairs only the invalid fields — a valid declaration wins over the defaults", () => {
    const out = ensureFrontmatter(doc("name: Bad Name\ndescription: The real description.\ncategory: nope"), {
      name: "fallback-name",
      description: "fallback description",
      category: "ai-native",
    });
    const parsed = parseSkillFrontmatter(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.name).toBe("fallback-name"); // "Bad Name" wasn't a slug -> default
    expect(parsed.data?.description).toBe("The real description."); // valid -> kept
    expect(parsed.data?.category).toBe("ai-native"); // "nope" wasn't in the set -> default
    expect(parsed.body).toBe("# Body\n\nDo the thing.");
  });

  it("is idempotent on an already-valid document", () => {
    const src = ensureFrontmatter("body", { name: "a-skill", description: "X.", category: "docs" });
    expect(ensureFrontmatter(src, { name: "other", description: "Y.", category: "testing" })).toBe(src);
  });
});

describe("effectiveSkillFrontmatter — read-time backfill", () => {
  it("derives the contract from the DB columns for a legacy body with no block", () => {
    const fm = effectiveSkillFrontmatter("legacy body", {
      name: "Legacy Skill",
      description: "Stored in the description column.",
      category: "security",
      tags: ["owasp"],
    });
    expect(fm).toEqual({
      name: "legacy-skill",
      description: "Stored in the description column.",
      category: "security",
      tags: ["owasp"],
    });
  });

  it("prefers the document's own declaration when it has one", () => {
    const fm = effectiveSkillFrontmatter(doc("name: declared-name\ndescription: Declared.\ncategory: testing"), {
      name: "Column Name",
      description: "Column description.",
      category: "other",
    });
    expect(fm.name).toBe("declared-name");
    expect(fm.description).toBe("Declared.");
    expect(fm.category).toBe("testing");
  });
});

describe("reconcileSkillWrite — the write contract", () => {
  it("rejects a DECLARED but invalid block with the specific errors (no silent fix)", () => {
    const res = reconcileSkillWrite(doc("name: Bad\ndescription: X.\ncategory: devops"), {
      name: "whatever",
      description: "whatever",
      category: "docs",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.length).toBe(2);
    expect(res.errors.join(" ")).toMatch(/kebab-case/);
    expect(res.errors.join(" ")).toMatch(/category/);
  });

  it("frontmatter WINS over the request fields and syncs the DB columns", () => {
    const content = doc("name: from-file\ndescription: From the file.\ncategory: security\ntags: a, b");
    const res = reconcileSkillWrite(content, {
      name: "From The Request",
      description: "From the request.",
      category: "docs",
      tags: ["z"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fields).toEqual({
      name: "from-file",
      description: "From the file.",
      category: "security",
      tags: ["a", "b"],
    });
    expect(res.content).toBe(content); // a conformant document is stored verbatim
    expect(res.injected).toBe(false);
  });

  it("falls back to the request fields for anything the block leaves undeclared", () => {
    const res = reconcileSkillWrite(doc("name: from-file\ndescription: From the file."), {
      name: "ignored",
      description: "ignored",
      category: "ci-cd",
      tags: ["ci"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fields.category).toBe("ci-cd");
    expect(res.fields.tags).toEqual(["ci"]);
  });

  it("injects a block when there is none, from the request fields", () => {
    const res = reconcileSkillWrite("plain body", {
      name: "My New Skill",
      description: "What it does.",
      category: "testing",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.injected).toBe(true);
    expect(res.fields.name).toBe("my-new-skill");
    expect(parseSkillFrontmatter(res.content).ok).toBe(true);
    expect(parseSkillFrontmatter(res.content).body).toBe("plain body");
  });

  it("defaults an undeclared/absent category to `other`", () => {
    const res = reconcileSkillWrite("plain body", { name: "x-skill", description: "D." });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fields.category).toBe("other");
  });

  it("requires a name and a description when it has to inject", () => {
    const res = reconcileSkillWrite("plain body", { name: "", description: "" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.length).toBe(2);
    expect(res.errors.join(" ")).toMatch(/`name`/);
    expect(res.errors.join(" ")).toMatch(/`description`/);
  });
});
