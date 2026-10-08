// The private-repo store rule (private-repo-scan lite r1, value-1). FAILS BEFORE: the module did not
// exist and persistScanReport wrote the report's quotes verbatim for every repo.

import { describe, expect, it } from "vitest";
import type { GuidanceGraph, ScanReport } from "@/lib/types";
import type { ManifestReadout } from "@/lib/standard/readout";
import { ELIDED_QUOTE, storableEvidenceLine, storableGuidanceGraph, storableManifest, storableScanReport } from "./private-scan-store";

const QUOTE = "Never commit secrets to the repository; read them from the vault";
const CMD = "pnpm vitest run --coverage";

// The three shapes engine.ts renderClaim produces, plus the confirmed line.
const CITED = `Model cited canonical_declared (+6) — AGENTS.md: "${QUOTE}"`;
const CITED_PAIR = `Model reported contradiction (evidence only, scores 0) — AGENTS.md: "${QUOTE}" · CLAUDE.md: "always commit secrets"`;
const CONFIRMED = `Model confirmed eval_harness — evals/run.ts: "${QUOTE}"`;
const SIGNAL = "Found CLAUDE.md (2.1 KB)";
const UNVERIFIED = "Unverified claim (quote-not-found) — eval_harness, evals/run.ts";

function guidanceGraph(): GuidanceGraph {
  return {
    version: "1",
    nodes: [
      { path: "AGENTS.md", agent: "agents", bytes: 900, contentSampled: true, commands: [{ key: "test", command: CMD }], rules: [{ subject: "commit secrets repository", polarity: "never", quote: QUOTE }], pointers: [], pointerOnly: false, lastCommitAt: null },
      { path: "CLAUDE.md", agent: "claude", bytes: 30, contentSampled: true, commands: [{ key: "test", command: "npm test" }], rules: [{ subject: "commit secrets repository", polarity: "always", quote: "always commit secrets" }], pointers: ["AGENTS.md"], pointerOnly: false, lastCommitAt: null },
    ],
    edges: [
      { from: "CLAUDE.md", to: "AGENTS.md", kind: "points-to", detail: "references" },
      { from: "AGENTS.md", to: "CLAUDE.md", kind: "diverges", detail: `test: "${CMD}" vs "npm test"` },
      { from: "AGENTS.md", to: "CLAUDE.md", kind: "diverges", detail: 'rule "commit secrets repository": never vs always' },
    ],
    canonical: "AGENTS.md",
    canonicalBasis: "pointer",
    contradictions: [
      { kind: "command", subject: "test", a: { path: "AGENTS.md", quote: CMD }, b: { path: "CLAUDE.md", quote: "npm test" }, confidence: "deterministic" },
      { kind: "rule", subject: "commit secrets repository", a: { path: "AGENTS.md", quote: QUOTE }, b: { path: "CLAUDE.md", quote: "always commit secrets" }, confidence: "deterministic" },
    ],
    coherence: 64,
    penalties: [{ reason: "Guidance files state different commands for: test", points: 20, paths: ["AGENTS.md", "CLAUDE.md"] }],
  };
}

function manifest(): ManifestReadout {
  return {
    status: "ok",
    readAt: "2026-10-08T00:00:00.000Z",
    generatedAt: "2026-09-01",
    schemaVersion: "1.2.0",
    schemaAhead: false,
    capabilities: [{ name: "test", command: CMD, verified: true, placeholder: false, wiredAt: ["prePush"] }],
    controls: { prePush: ["test"], ciHardPass: [] },
    paths: { memory: ".ai/memory" },
    agents: [{ id: "claude", kind: "claude-code", entrypoint: "CLAUDE.md" }],
    purpose: "Billing reconciliation service for the Northwind ledger",
    boundaries: { neverTouch: ["prisma/migrations"], secretsFrom: "AWS Secrets Manager /northwind/prod" },
    placeholders: ["<the northwind repo>"],
    unbacked: [],
    notes: ['schema id is "northwind-contract", not "ai-manifest"', "manifest major v2 differs from this reader (v1) — read leniently"],
  };
}

function report(isPrivate: boolean | undefined, forge?: "github" | "local"): ScanReport {
  return {
    repo: { owner: "acme", name: "ledger", url: "https://github.com/acme/ledger", stars: 0, isPrivate, headSha: "sha", ...(forge ? { forge } : {}) },
    dimensions: [{ id: "D1", name: "Guidance", weight: 1, score: 70, signalScore: 64, llmScore: 70, summary: "s", evidence: [SIGNAL, CITED, CITED_PAIR, CONFIRMED, UNVERIFIED], strengths: [], gaps: [] }],
    guidanceGraph: guidanceGraph(),
    manifest: manifest(),
  } as unknown as ScanReport;
}

const copied = [QUOTE, CMD, "always commit secrets", "commit secrets repository", "Northwind", "northwind", "npm test"];
function carriesCopiedText(value: unknown): string[] {
  const json = JSON.stringify(value);
  return copied.filter((c) => json.includes(c));
}

describe("storableEvidenceLine", () => {
  it("keeps facet, points and path, and drops the quote", () => {
    expect(storableEvidenceLine(CITED)).toBe("Model cited canonical_declared (+6) — AGENTS.md");
    expect(storableEvidenceLine(CONFIRMED)).toBe("Model confirmed eval_harness — evals/run.ts");
  });

  it("keeps both paths of a two-file claim", () => {
    expect(storableEvidenceLine(CITED_PAIR)).toBe("Model reported contradiction (evidence only, scores 0) — AGENTS.md · CLAUDE.md");
  });

  it("drops an ambiguous second path rather than guess (a quote may contain the separator)", () => {
    const tricky = `Model cited x (+1) — a.md: "one" · b.md: "two" · c.md: "three"`;
    expect(storableEvidenceLine(tricky)).toBe("Model cited x (+1) — a.md");
  });

  it("passes analyzer-generated lines through unchanged", () => {
    expect(storableEvidenceLine(SIGNAL)).toBe(SIGNAL);
    expect(storableEvidenceLine(UNVERIFIED)).toBe(UNVERIFIED);
  });
});

describe("storableGuidanceGraph", () => {
  it("keeps the structure the coherence card reads and no copied text", () => {
    const g = storableGuidanceGraph(guidanceGraph());
    expect(carriesCopiedText(g)).toEqual([]);
    expect(g.nodes.map((n) => [n.path, n.agent, n.bytes, n.pointers])).toEqual([
      ["AGENTS.md", "agents", 900, []],
      ["CLAUDE.md", "claude", 30, ["AGENTS.md"]],
    ]);
    expect(g.canonical).toBe("AGENTS.md");
    expect(g.coherence).toBe(64);
    expect(g.penalties).toEqual(guidanceGraph().penalties);
    expect(g.contradictions).toHaveLength(2);
    expect(g.contradictions[0]).toMatchObject({ kind: "command", subject: "test", a: { path: "AGENTS.md", quote: ELIDED_QUOTE } });
    expect(g.contradictions[1]).toMatchObject({ kind: "rule", subject: "rule 2", b: { path: "CLAUDE.md", quote: ELIDED_QUOTE } });
    expect(g.edges.map((e) => e.detail)).toEqual(["references", "test: commands differ", "rule: never vs always"]);
  });
});

describe("storableManifest", () => {
  it("drops prose and commands and keeps the capability structure", () => {
    const m = storableManifest(manifest());
    expect(carriesCopiedText(m)).toEqual([]);
    expect(m.capabilities).toEqual([{ name: "test", command: "", verified: true, placeholder: false, wiredAt: ["prePush"] }]);
    expect(m.purpose).toBeNull();
    expect(m.boundaries).toEqual({ neverTouch: ["prisma/migrations"], secretsFrom: null });
    expect(m.notes).toEqual(["manifest major v2 differs from this reader (v1) — read leniently"]);
  });
});

describe("storableScanReport", () => {
  it("a private report keeps no copied text in evidence, guidance graph or manifest", () => {
    const out = storableScanReport(report(true));
    expect(carriesCopiedText(out.dimensions)).toEqual([]);
    expect(carriesCopiedText(out.guidanceGraph)).toEqual([]);
    expect(carriesCopiedText(out.manifest)).toEqual([]);
    expect(out.dimensions[0]!.evidence).toHaveLength(5);
    expect(out.dimensions[0]!.score).toBe(70);
  });

  it("does not mutate the report the caller keeps", () => {
    const r = report(true);
    storableScanReport(r);
    expect(r.dimensions[0]!.evidence).toContain(CITED);
    expect(r.guidanceGraph?.nodes[0]?.rules[0]?.quote).toBe(QUOTE);
    expect(r.manifest?.purpose).toContain("Northwind");
  });

  it("a public (or unflagged) report passes through by identity", () => {
    const pub = report(false);
    expect(storableScanReport(pub)).toBe(pub);
    const legacy = report(undefined);
    expect(storableScanReport(legacy)).toBe(legacy);
  });
});

// Operator decision 2026-10-08, "Exempt local scans". FAILS BEFORE: the rule read isPrivate alone, and
// LocalFsSource stamps every working copy private, so a local scan lost its quotes.
describe("storableScanReport — a local working copy is exempt", () => {
  it("keeps its evidence quotes, guidance graph and manifest", () => {
    const local = report(true, "local");
    const out = storableScanReport(local);
    expect(out).toBe(local);
    expect(out.dimensions[0]!.evidence).toContain(CITED);
    expect(out.guidanceGraph?.nodes[0]?.rules[0]?.quote).toBe(QUOTE);
    expect(out.manifest?.purpose).toContain("Northwind");
  });

  it("a private GitHub report is still scrubbed, with or without an explicit forge", () => {
    for (const r of [report(true, "github"), report(true)]) {
      const out = storableScanReport(r);
      expect(out).not.toBe(r);
      expect(carriesCopiedText(out.dimensions)).toEqual([]);
      expect(carriesCopiedText(out.guidanceGraph)).toEqual([]);
      expect(carriesCopiedText(out.manifest)).toEqual([]);
    }
  });
});

// The backfill scrub (src/lib/db/private-scan-scrub.ts) re-applies these transforms to rows that may
// already be clean. FAILS BEFORE: a scrubbed rule divergence edge ("rule: never vs always") was read as
// a command key "rule" and rewritten to "rule: commands differ" on the second pass.
describe("the store transforms are idempotent", () => {
  it("a second pass changes nothing", () => {
    const g = storableGuidanceGraph(guidanceGraph());
    expect(storableGuidanceGraph(g)).toEqual(g);
    const m = storableManifest(manifest());
    expect(storableManifest(m)).toEqual(m);
    for (const line of [SIGNAL, CITED, CITED_PAIR, CONFIRMED, UNVERIFIED]) {
      const once = storableEvidenceLine(line);
      expect(storableEvidenceLine(once)).toBe(once);
    }
  });
});
