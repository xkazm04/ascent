// The `.ai/memory` READER (moonshot #14). FAILS BEFORE: the module did not exist — the standard could
// only be written, never read back.

import { describe, expect, it } from "vitest";
import {
  MAX_MEMORY_BODY,
  mapMemoryKind,
  memoryContentHash,
  parseRepoMemoryEntries,
  parseRepoMemoryEntry,
  supersededIds,
} from "@/lib/standard/memory-read";
import { buildMemorySeed } from "@/lib/standard/memory";
import type { ScanReport } from "@/lib/types";

const entry = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`;

const FULL = entry(
  [
    "id: 0007",
    "kind: failed-approach   # decision | gotcha | failed-approach | convention | reference | <open>",
    "scope: module:engine",
    "date: 2026-06-10",
    "supersedes: 0003",
    "refs: [0001, 0002]",
  ].join("\n"),
  "We tried a PGlite-backed cache and the drift never self-repaired on boot.",
);

describe("parseRepoMemoryEntry — the happy path", () => {
  const e = parseRepoMemoryEntry(".ai/memory/0007-pglite-drift.md", FULL);

  it("reads every declared field", () => {
    expect(e).not.toBeNull();
    expect(e!.entryId).toBe("0007");
    expect(e!.rawKind).toBe("failed-approach");
    expect(e!.mappedKind).toBe("procedural");
    expect(e!.scope).toBe("module:engine");
    expect(e!.supersedes).toBe("0003");
    expect(e!.refs).toEqual(["0001", "0002"]);
    expect(e!.body).toContain("PGlite-backed cache");
    expect(e!.truncated).toBe(false);
  });

  it("keeps `date` as verbatim text, never a Date", () => {
    expect(e!.entryDate).toBe("2026-06-10");
    expect(e!.entryDate).not.toBeInstanceOf(Date);
  });

  it("reads a block-sequence `refs:` as well as an inline list", () => {
    const block = entry("id: 0002\nkind: decision\nrefs:\n  - 0001\n  - 0009", "body");
    expect(parseRepoMemoryEntry("p.md", block)!.refs).toEqual(["0001", "0009"]);
  });

  it("reads `supersedes: null` as absent, not as the string \"null\"", () => {
    const e2 = parseRepoMemoryEntry("p.md", entry("id: 0001\nsupersedes: null\nrefs: []", "body"))!;
    expect(e2.supersedes).toBeNull();
    expect(e2.refs).toEqual([]);
  });

  it("parses the entry the standard's own seed writes (writer/reader round trip)", () => {
    const report = { scannedAt: "2026-06-10T00:00:00.000Z" } as ScanReport;
    const seed = buildMemorySeed(report).find((f) => f.path.endsWith("0001-adopt-ai-standard.md"))!;
    const parsed = parseRepoMemoryEntry(seed.path, seed.body)!;
    expect(parsed.entryId).toBe("0001");
    expect(parsed.rawKind).toBe("decision");
    expect(parsed.mappedKind).toBe("semantic");
    expect(parsed.entryDate).toBe("2026-06-10");
  });
});

describe("mapMemoryKind — an open vocabulary onto a curated enum", () => {
  it.each([
    ["decision", "semantic"],
    ["reference", "semantic"],
    ["failed-approach", "procedural"],
    ["failed_approach", "procedural"],
    ["Convention", "procedural"],
    ["gotcha", "procedural"],
    ["progress", "episodic"],
  ])("maps %s -> %s", (raw, mapped) => {
    expect(mapMemoryKind(raw)).toBe(mapped);
  });

  it("falls to semantic for an unrecognized or absent value, matching normalizeMemoryKind", () => {
    expect(mapMemoryKind("architecture-note")).toBe("semantic");
    expect(mapMemoryKind(null)).toBe("semantic");
  });

  it("passes a value that IS already a curated kind straight through", () => {
    expect(mapMemoryKind("procedural")).toBe("procedural");
    expect(mapMemoryKind("summary")).toBe("summary");
  });

  it("never loses the raw value it mapped away from", () => {
    const e = parseRepoMemoryEntry("p.md", entry("kind: architecture-note", "body"))!;
    expect(e.rawKind).toBe("architecture-note");
    expect(e.mappedKind).toBe("semantic");
  });
});

describe("parseRepoMemoryEntry — what it refuses to guess", () => {
  it("returns null with no frontmatter block", () => {
    expect(parseRepoMemoryEntry("p.md", "Just a paragraph, no block.")).toBeNull();
  });

  it("returns null when the block is never closed", () => {
    expect(parseRepoMemoryEntry("p.md", "---\nid: 0001\nkind: decision\n\nbody text")).toBeNull();
  });

  it("returns null on a whitespace-only body", () => {
    expect(parseRepoMemoryEntry("p.md", entry("id: 0001", "   "))).toBeNull();
  });

  it("tolerates CRLF and a leading BOM", () => {
    const crlf = `﻿---\r\nid: 0004\r\nkind: gotcha\r\n---\r\n\r\nWindows-authored.\r\n`;
    const e = parseRepoMemoryEntry("p.md", crlf)!;
    expect(e.entryId).toBe("0004");
    expect(e.body).toBe("Windows-authored.");
  });
});

describe("parseRepoMemoryEntries — skips are counted, never dropped", () => {
  const parsed = parseRepoMemoryEntries([
    { path: "a.md", content: FULL },
    { path: "b.md", content: "no block here" },
    { path: "c.md", content: "   " },
  ]);

  it("keeps the readable entry and records both skips with a reason", () => {
    expect(parsed.entries.map((e) => e.path)).toEqual(["a.md"]);
    expect(parsed.skipped).toEqual([
      { path: "b.md", reason: "malformed" },
      { path: "c.md", reason: "empty" },
    ]);
  });
});

describe("the 6000-char body cap", () => {
  it("truncates and says so", () => {
    const e = parseRepoMemoryEntry("p.md", entry("id: 0001", "x".repeat(MAX_MEMORY_BODY + 500)))!;
    expect(e.body).toHaveLength(MAX_MEMORY_BODY);
    expect(e.truncated).toBe(true);
  });

  it("leaves a body at exactly the cap untruncated", () => {
    const e = parseRepoMemoryEntry("p.md", entry("id: 0001", "x".repeat(MAX_MEMORY_BODY)))!;
    expect(e.truncated).toBe(false);
  });
});

describe("contentHash — the idempotency key", () => {
  it("is stable across two parses of identical input", () => {
    const a = parseRepoMemoryEntry("p.md", FULL)!;
    const b = parseRepoMemoryEntry("p.md", FULL)!;
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("diverges on a one-byte body change", () => {
    const a = parseRepoMemoryEntry("p.md", FULL)!;
    const b = parseRepoMemoryEntry("p.md", `${FULL}.`)!;
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("diverges on the same body at a different path", () => {
    expect(memoryContentHash("a.md", "same")).not.toBe(memoryContentHash("b.md", "same"));
  });

  it("does not collide across a path/body boundary shift", () => {
    // The NUL separator is what makes ("ab","c") and ("a","bc") different inputs.
    expect(memoryContentHash("ab", "c")).not.toBe(memoryContentHash("a", "bc"));
  });
});

describe("supersededIds", () => {
  it("collects the ids a batch claims to replace, ignoring entries that claim none", () => {
    const { entries } = parseRepoMemoryEntries([
      { path: "a.md", content: entry("id: 0004\nsupersedes: 0001", "body") },
      { path: "b.md", content: entry("id: 0005\nsupersedes: null", "body") },
      { path: "c.md", content: entry("id: 0006\nsupersedes: 0002", "body") },
    ]);
    expect([...supersededIds(entries)].sort()).toEqual(["0001", "0002"]);
  });
});
