// MOONSHOT #33 — the body-free artifact census on RepoPracticeShape v2.
//
// Three properties are load-bearing and each has a fail-before:
//   1. the LEAK PIN, re-asserted for `outlineHash`: a `#` inside a fenced block never reaches an
//      outline, therefore never reaches the hash taken over one;
//   2. a tree-present / body-unfetched path yields `bodyHash: null` — UNKNOWN, which the reconciler
//      must never read as "changed";
//   3. the census caps at 40, so a pathological repo cannot inflate the persisted blob.

import { describe, expect, it } from "vitest";
import { censusArtifacts, extractPracticeShape, parsePracticeShape } from "./practice-shape";
import { contentDigest } from "@/lib/registry/parse";
import { buildArtifact } from "@/lib/practice-artifact";
import { PRACTICES } from "@/lib/practices";
import type { FetchedFile, RepoFile } from "@/lib/types";

const blob = (path: string): RepoFile => ({ path, type: "blob" }) as RepoFile;
const file = (path: string, content: string): FetchedFile => ({ path, content }) as FetchedFile;

describe("censusArtifacts", () => {
  it("hashes body and outline for a fetched practice artifact", () => {
    const body = "# Guidance\n\nprose\n\n## Commands\n";
    const [row] = censusArtifacts([blob("AGENTS.md")], [file("AGENTS.md", body)]);
    expect(row).toMatchObject({ path: "AGENTS.md" });
    expect(row!.bodyHash).toBe(contentDigest(body));
    expect(row!.outlineHash).toBe(contentDigest("# Guidance\n## Commands"));
  });

  // THE honest null. The path is in the tree, the body was outside the fetch budget: nothing is known
  // about its content, and a reconciler that read `null` as "changed" would report drift on every
  // large repo whose budget didn't reach the file.
  it("yields bodyHash: null for a tree-present, body-unfetched path", () => {
    const [row] = censusArtifacts([blob("SECURITY.md")], []);
    expect(row).toEqual({ path: "SECURITY.md", bodyHash: null, outlineHash: null });
  });

  // The leak pin, re-asserted one layer down: outlineOf skips fences, so a hash taken over its output
  // provably cannot carry a line of someone's deploy script.
  it("never lets a # inside a fenced block reach the outline hash", () => {
    const withFence = ["# Real", "", "```bash", "# curl https://internal.acme/prod", "```"].join("\n");
    const withoutFence = "# Real\n";
    const a = censusArtifacts([blob("AGENTS.md")], [file("AGENTS.md", withFence)])[0]!;
    const b = censusArtifacts([blob("AGENTS.md")], [file("AGENTS.md", withoutFence)])[0]!;
    expect(a.outlineHash).toBe(b.outlineHash);
    // …and the two files are still distinguishable by BODY, so a real edit is not hidden.
    expect(a.bodyHash).not.toBe(b.bodyHash);
  });

  it("gives a heading-free file a null outlineHash rather than a hash of nothing", () => {
    const [row] = censusArtifacts(
      [blob(".github/workflows/ci.yml")],
      [file(".github/workflows/ci.yml", "name: CI\non: [push]\n")],
    );
    expect(row!.outlineHash).toBeNull();
    expect(row!.bodyHash).not.toBeNull();
  });

  it("caps at 40 rows", () => {
    const tree = Array.from({ length: 60 }, (_, i) => blob(`docs/practices/p${i}.md`));
    expect(censusArtifacts(tree, []).length).toBe(40);
  });

  it("ignores paths that are not practice artifacts", () => {
    expect(censusArtifacts([blob("src/index.ts"), blob("README.md")], [])).toEqual([]);
  });

  it("counts registry and playbook landing paths, not only the catalog's own", () => {
    const paths = censusArtifacts(
      [blob("docs/practices/pr-review.md"), blob("docs/playbooks/abc-our-ci.md")],
      [],
    ).map((r) => r.path);
    expect(paths).toEqual(["docs/practices/pr-review.md", "docs/playbooks/abc-our-ci.md"]);
  });

  // The census is a LOCAL path list on purpose (it is the leak boundary and must not import the
  // artifact generator). This is the guard that keeps the two in step: a new practice whose starter
  // lands somewhere the census does not look would silently never be reconcilable.
  it("covers every path buildArtifact actually writes", () => {
    const ctx = { fullName: "acme/api", name: "api", primaryLanguage: "typescript" };
    for (const p of PRACTICES) {
      const spec = buildArtifact(p.id, ctx);
      if (!spec) continue;
      const seen = censusArtifacts([blob(spec.path)], []);
      expect(seen.map((r) => r.path), `practice ${p.id} writes ${spec.path}`).toEqual([spec.path]);
    }
  });

  // The constraint #33 asks of #15's "consolidate-guidance" starter, asserted for EVERY catalog entry
  // rather than named one: the adoption ledger's identity is (org, repo, practice, artifactPath), so a
  // practice whose path varies with the repo would key a new row per repo and could never be
  // reconciled. This fails the moment a new practice makes its path repo-dependent.
  it("gives every practice ONE artifact path, independent of the repo", () => {
    const a = { fullName: "acme/api", name: "api", primaryLanguage: "typescript" };
    const b = { fullName: "other/svc", name: "svc", primaryLanguage: "go", description: "x" };
    for (const p of PRACTICES) {
      const first = buildArtifact(p.id, a);
      if (!first) continue;
      expect(buildArtifact(p.id, b)!.path, `practice ${p.id}`).toBe(first.path);
      expect(buildArtifact(p.id, a)!.path, `practice ${p.id}`).toBe(first.path);
    }
  });
});

describe("extractPracticeShape — v2", () => {
  it("stamps version 2 with a census and an explicit truncated flag", () => {
    const shape = extractPracticeShape([blob("AGENTS.md")], [file("AGENTS.md", "# A")], { truncated: true });
    expect(shape.version).toBe("2");
    expect(shape.truncated).toBe(true);
    expect(shape.artifacts?.map((a) => a.path)).toEqual(["AGENTS.md"]);
  });

  it("defaults truncated to false for an ordinary-sized tree", () => {
    expect(extractPracticeShape([blob("AGENTS.md")], []).truncated).toBe(false);
  });
});

describe("parsePracticeShape — v1/v2", () => {
  // The distinction the reconciler's honesty rests on: a v1 blob has NO census, which is not the same
  // claim as "the census is empty". An absent census must reconcile to nothing at all.
  it("leaves a v1 blob's census ABSENT rather than empty", () => {
    const parsed = parsePracticeShape('{"version":"1","entries":[]}');
    expect(parsed?.version).toBe("1");
    expect(parsed?.artifacts).toBeUndefined();
    expect(parsed?.truncated).toBeUndefined();
  });

  it("round-trips a v2 census", () => {
    const shape = extractPracticeShape([blob("AGENTS.md")], [file("AGENTS.md", "# A\n## B")]);
    expect(parsePracticeShape(JSON.stringify(shape))).toEqual(shape);
  });

  it("drops malformed census rows and coerces bad hashes to null", () => {
    const parsed = parsePracticeShape(
      '{"version":"2","entries":[],"artifacts":[{"path":"AGENTS.md","bodyHash":7},{"nope":1}],"truncated":"yes"}',
    );
    expect(parsed?.artifacts).toEqual([{ path: "AGENTS.md", bodyHash: null, outlineHash: null }]);
    // Anything but a literal `true` is not a truncation claim.
    expect(parsed?.truncated).toBe(false);
  });
});
