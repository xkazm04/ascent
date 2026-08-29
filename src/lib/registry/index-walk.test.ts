// Tree selection for the indexer. The lane predicates are one-liners, which is exactly why they are
// worth pinning: each one decides what an index pass will and will not fetch, and a predicate that
// quietly widened (matching a nested stray, or a README) would put a file into a parser that was
// never written for it.

import { describe, expect, it } from "vitest";
import { isArtifact, isBundleIndex, isMemoryNote, isSignalsFile, isUsageFile, selectArtifacts } from "./index-walk";
import type { RegistryTree, RegistryTreeEntry } from "./read";

const blob = (path: string, size = 100): RegistryTreeEntry => ({ path, type: "blob", size, sha: `sha-${path}` });
const tree = (paths: string[]): RegistryTree => ({
  headSha: "head",
  entries: paths.map((p) => blob(p)),
  truncated: false,
});

describe("isSignalsFile", () => {
  it("takes signals/<contributor>.json and nothing else", () => {
    expect(isSignalsFile("signals/dev-box.json")).toBe(true);
    expect(isSignalsFile("signals/README.md")).toBe(false);
    expect(isSignalsFile("signals/nested/dev-box.json")).toBe(false);
    expect(isSignalsFile("signals")).toBe(false);
    expect(isSignalsFile("usage/dev-box.json")).toBe(false);
  });
});

describe("selectArtifacts", () => {
  it("partitions every lane, signals included", () => {
    // FAIL-BEFORE: `signals` did not exist on SelectedArtifacts, so this read `undefined`.
    const picked = selectArtifacts(
      tree([
        "skills/perfect/SKILL.md",
        "practices/ci-gate/PRACTICE.md",
        "memory/decision/why-postgres.md",
        "usage/dev-box.json",
        "knowledge/software-engineering/index.json",
        "signals/dev-box.json",
        "signals/team-a.json",
        "README.md",
      ]),
      [],
    );
    expect(picked.skills.map((e) => e.path)).toEqual(["skills/perfect/SKILL.md"]);
    expect(picked.practices.map((e) => e.path)).toEqual(["practices/ci-gate/PRACTICE.md"]);
    expect(picked.memory.map((e) => e.path)).toEqual(["memory/decision/why-postgres.md"]);
    expect(picked.usage.map((e) => e.path)).toEqual(["usage/dev-box.json"]);
    expect(picked.bundles.map((e) => e.path)).toEqual(["knowledge/software-engineering/index.json"]);
    expect(picked.signals.map((e) => e.path)).toEqual(["signals/dev-box.json", "signals/team-a.json"]);
  });

  it("returns an empty signals lane rather than omitting it, on a registry with none", () => {
    expect(selectArtifacts(tree(["skills/perfect/SKILL.md"]), []).signals).toEqual([]);
  });

  it("sorts each lane by path so an index pass is deterministic", () => {
    const picked = selectArtifacts(tree(["signals/z.json", "signals/a.json"]), []);
    expect(picked.signals.map((e) => e.path)).toEqual(["signals/a.json", "signals/z.json"]);
  });

  it("REPORTS a lane that exceeds the cap instead of silently truncating", () => {
    // A silently short index is indistinguishable from a registry that lost files.
    const warnings: string[] = [];
    const many = Array.from({ length: 501 }, (_, i) => `signals/c${String(i).padStart(4, "0")}.json`);
    const picked = selectArtifacts(tree(many), warnings);
    expect(picked.signals).toHaveLength(500);
    expect(warnings.some((w) => w.startsWith("signals: 501 files exceeds"))).toBe(true);
  });

  it("ignores tree entries — only blobs are artifacts", () => {
    const t: RegistryTree = {
      headSha: "h",
      entries: [{ path: "signals", type: "tree", size: 0, sha: "s" }, blob("signals/a.json")],
      truncated: false,
    };
    expect(selectArtifacts(t, []).signals.map((e) => e.path)).toEqual(["signals/a.json"]);
  });
});

describe("the other lane predicates (regression fence)", () => {
  it("keeps each lane exactly one directory deep", () => {
    expect(isArtifact("skills/perfect/SKILL.md", "skills", "SKILL.md")).toBe(true);
    expect(isArtifact("skills/a/b/SKILL.md", "skills", "SKILL.md")).toBe(false);
    expect(isMemoryNote("memory/decision/why.md")).toBe(true);
    expect(isMemoryNote("memory/decision/_index.md")).toBe(false);
    expect(isUsageFile("usage/dev-box.json")).toBe(true);
    expect(isBundleIndex("knowledge/software-engineering/index.json")).toBe(true);
    expect(isBundleIndex("knowledge/software-engineering/subjects/x.md")).toBe(false);
  });
});
