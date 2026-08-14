import { describe, expect, it } from "vitest";
import { extractPracticeShape, outlineOf, parsePracticeShape } from "./practice-shape";
import type { FetchedFile, RepoFile } from "@/lib/types";

const blob = (path: string): RepoFile => ({ path, type: "blob" }) as RepoFile;
const file = (path: string, content: string): FetchedFile => ({ path, content }) as FetchedFile;

describe("outlineOf", () => {
  it("extracts H1–H3 in document order with their levels", () => {
    expect(outlineOf("# Title\n\ntext\n\n## Build\n\n### Tests\n")).toEqual(["# Title", "## Build", "### Tests"]);
  });

  it("ignores H4 and deeper — a skeleton, not a table of contents", () => {
    expect(outlineOf("### Kept\n#### Dropped\n")).toEqual(["### Kept"]);
  });

  // THE leak guard. A `#` inside a fence is a shell comment or a CSS id, not a heading — following
  // it would pull a line of someone's actual script into the "shape".
  it("never reads a # from inside a fenced code block", () => {
    const md = ["# Real", "", "```bash", "# secret deploy step", "curl https://internal.acme/prod", "```", "", "## Also real"].join("\n");
    expect(outlineOf(md)).toEqual(["# Real", "## Also real"]);
  });

  it("handles tilde fences too", () => {
    expect(outlineOf("# A\n~~~\n# not-a-heading\n~~~\n## B")).toEqual(["# A", "## B"]);
  });

  it("strips closing hashes and collapses whitespace", () => {
    expect(outlineOf("##   Build   and   test   ##")).toEqual(["## Build and test"]);
  });

  it("caps a very long heading rather than carrying a paragraph into the shape", () => {
    const long = `# ${"x".repeat(400)}`;
    expect(outlineOf(long)[0]!.length).toBeLessThan(120);
  });

  it("caps the number of headings", () => {
    const md = Array.from({ length: 100 }, (_, i) => `## H${i}`).join("\n");
    expect(outlineOf(md).length).toBeLessThanOrEqual(24);
  });

  it("is empty for markdown with no headings", () => {
    expect(outlineOf("just prose\nand more prose")).toEqual([]);
  });
});

describe("extractPracticeShape", () => {
  it("extracts an agent-guidance outline from CLAUDE.md", () => {
    const tree = [blob("CLAUDE.md")];
    const files = [file("CLAUDE.md", "# Project\n## Commands\n## Architecture\n")];
    const shape = extractPracticeShape(tree, files);
    const e = shape.entries.find((x) => x.practiceId === "agent-guidance");
    expect(e?.outline).toEqual(["# Project", "## Commands", "## Architecture"]);
  });

  // The body is never extracted at all — not extracted-and-filtered. Nothing under a heading, and
  // no code, can reach the shape.
  it("carries no artifact body into the shape", () => {
    const files = [file("AGENTS.md", "# Guide\n\nconst APIKEY='sk-live-secret';\n\n## Rules\n")];
    const json = JSON.stringify(extractPracticeShape([blob("AGENTS.md")], files));
    expect(json).not.toContain("sk-live-secret");
    expect(json).not.toContain("APIKEY");
  });

  // Content is only available for files the ingest sample pulled. Guessing an outline for a file we
  // never read would put a fabricated structure in front of an engineer as "your own pattern".
  it("yields no outline for a matched file whose content was not sampled", () => {
    const shape = extractPracticeShape([blob("CLAUDE.md")], []);
    expect(shape.entries.find((x) => x.practiceId === "agent-guidance")).toBeUndefined();
  });

  it("skips a headingless guidance file — a stub teaches no structure", () => {
    const shape = extractPracticeShape([blob("CLAUDE.md")], [file("CLAUDE.md", "see the wiki")]);
    expect(shape.entries.find((x) => x.practiceId === "agent-guidance")).toBeUndefined();
  });

  it("extracts a layout for the harness from paths alone, with no content", () => {
    const tree = [blob("evals/golden/a.yaml"), blob("evals/golden/b.yaml")];
    const e = extractPracticeShape(tree, []).entries.find((x) => x.practiceId === "ai-harness");
    expect(e?.layout).toEqual(["evals/golden/a.yaml", "evals/golden/b.yaml"]);
    expect(e?.outline).toEqual([]);
  });

  it("extracts CI workflow layout", () => {
    const e = extractPracticeShape([blob(".github/workflows/ci.yml")], []).entries.find((x) => x.practiceId === "ci-gates");
    expect(e?.layout).toEqual([".github/workflows/ci.yml"]);
  });

  it("extracts a PR-template outline", () => {
    const tree = [blob(".github/PULL_REQUEST_TEMPLATE.md")];
    const files = [file(".github/PULL_REQUEST_TEMPLATE.md", "## What\n## Why\n## Testing\n")];
    const e = extractPracticeShape(tree, files).entries.find((x) => x.practiceId === "legible-history");
    expect(e?.outline).toEqual(["## What", "## Why", "## Testing"]);
  });

  it("bounds how many files one practice contributes", () => {
    const tree = Array.from({ length: 10 }, (_, i) => blob(`docs/adr/${i}-x.md`));
    const files = tree.map((t) => file(t.path, "## Context\n## Decision\n"));
    const outlines = extractPracticeShape(tree, files).entries.filter((x) => x.practiceId === "docs-adrs" && x.outline.length);
    expect(outlines.length).toBeLessThanOrEqual(2);
  });

  it("is empty-safe", () => {
    expect(extractPracticeShape([], [])).toEqual({ version: "1", entries: [] });
  });
});

describe("parsePracticeShape", () => {
  it("round-trips an extracted shape", () => {
    const shape = extractPracticeShape([blob("CLAUDE.md")], [file("CLAUDE.md", "# A\n## B")]);
    expect(parsePracticeShape(JSON.stringify(shape))).toEqual(shape);
  });

  // Parsed inside a dashboard render — a malformed blob must degrade, never throw.
  it("degrades to null on absent or malformed json", () => {
    expect(parsePracticeShape(null)).toBeNull();
    expect(parsePracticeShape("not json")).toBeNull();
    expect(parsePracticeShape('{"entries":"nope"}')).toBeNull();
  });

  it("drops malformed entries rather than trusting them", () => {
    const parsed = parsePracticeShape('{"version":"1","entries":[{"practiceId":"a"},{"nope":1}]}');
    expect(parsed?.entries).toEqual([{ practiceId: "a", path: "", outline: [], layout: [] }]);
  });
});
