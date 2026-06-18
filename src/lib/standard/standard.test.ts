import { describe, it, expect } from "vitest";
import {
  buildManifestData,
  serializeManifestYaml,
  buildMemorySeed,
  buildContextScaffold,
  buildDoctor,
  buildConformanceWiring,
  buildMaintain,
  buildFoundation,
} from "./index";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

function makeReport(lang = "TypeScript"): ScanReport {
  return {
    repo: {
      owner: "acme", name: "api", url: "https://github.com/acme/api", description: "Billing API",
      stars: 12, forks: 1, primaryLanguage: lang, defaultBranch: "main", headSha: "abc1234",
    },
    overallScore: 58, level: levelForScore(58), archetype: "team",
    adoptionScore: 55, rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "x" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [], dimensions: [],
    headline: "h", strengths: [], risks: [], roadmap: [], discrepancies: [],
    confidence: 0.8, scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

describe("ai-manifest", () => {
  it("declares capabilities as tool-neutral commands, never frameworks", () => {
    const d = buildManifestData(makeReport("TypeScript"));
    expect(d.schema).toBe("ai-manifest");
    expect(d.capabilities.test!.command).toBe("npm test");
    expect(d.capabilities.typecheck!.command).toContain("tsc");
    // The serialized form must not name the underlying tool as identity.
    const yaml = serializeManifestYaml(d);
    expect(yaml).not.toMatch(/vitest|jest|framework:/i);
    expect(yaml).toContain("schema: ai-manifest");
    expect(yaml).toContain("capabilities:");
  });

  it("is language-aware (commands follow the stack)", () => {
    expect(buildManifestData(makeReport("Python")).capabilities.test!.command).toBe("pytest");
    expect(buildManifestData(makeReport("Python")).capabilities.typecheck!.command).toBe("mypy .");
    expect(buildManifestData(makeReport("Go")).capabilities.test!.command).toBe("go test ./...");
  });

  it("encodes the shift-left control placement and pointer-based subsystems", () => {
    const d = buildManifestData(makeReport());
    // Fast checks pre-push; slow suites (full tests) + clean-room SAST in CI — tunable per repo.
    expect(d.controls.prePush).toEqual(["lint", "typecheck", "scan-secrets"]);
    expect(d.controls.ciHardPass).toEqual(["test", "sast", "merge-gate"]);
    expect(d.paths.memory).toBe(".ai/memory/");
    expect(d.paths.contextIndex).toBe(".ai/context-index.json");
  });

  it("records provenance for drift detection and carries a semver", () => {
    const d = buildManifestData(makeReport());
    expect(d.generatedFrom).toContain("package.json");
    expect(d.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(d.generatedAt).toBe("2026-06-10");
  });
});

describe("memory + context scaffolds", () => {
  it("seeds an append-only memory store with a worked example entry", () => {
    const files = buildMemorySeed(makeReport());
    const readme = files.find((f) => f.path === ".ai/memory/README.md")!;
    const seed = files.find((f) => f.path.endsWith("0001-adopt-ai-standard.md"))!;
    expect(readme.body).toContain("append-only");
    expect(readme.body).toContain("failed-approach"); // the tried-and-failed ledger
    expect(seed.body).toMatch(/^---\nid: 0001\n/);
    expect(seed.body).toContain("kind: decision");
  });

  it("scaffolds a CONTEXT template and a valid, freshness-aware index", () => {
    const files = buildContextScaffold(makeReport());
    const index = files.find((f) => f.path === ".ai/context-index.json")!;
    const parsed = JSON.parse(index.body);
    expect(parsed.modules[0].id).toBe("root");
    expect(parsed.modules[0].reconciledToSha).toBe("abc1234"); // freshness anchor from headSha
    expect(files.some((f) => f.path === "CONTEXT.md" && f.body.includes("Invariants"))).toBe(true);
  });
});

describe("doctor", () => {
  it("emits a zero-dependency Node script with no template-literal hazards", () => {
    const doc = buildDoctor();
    expect(doc.path).toBe(".ai/doctor.mjs");
    expect(doc.body.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(doc.body).toContain("node:fs");
    expect(doc.body).toContain("Conformance:");
    // It must embed cleanly in a template literal: no backticks, no ${ } in the emitted source.
    expect(doc.body).not.toContain("`");
    expect(doc.body).not.toContain("${");
  });

  it("scopes path resolution to the paths: block so a like-named capability can't shadow it", () => {
    // Regression: a capability named `evals` once shadowed paths.evals via a naive first-match.
    expect(buildDoctor().body).toContain("scope to the paths: block");
  });
});

describe("conformance wiring (one script, two layers)", () => {
  it("emits a CI hard-pass that runs the same doctor command", () => {
    const w = buildConformanceWiring();
    expect(w.path).toBe(".github/workflows/ai-conformance.yml");
    expect(w.body).toContain("node .ai/doctor.mjs"); // the SAME command as pre-push
    expect(w.body).toContain("pull_request");
  });

  it("is branch-agnostic (no hard-coded default branch to get wrong)", () => {
    const w = buildConformanceWiring();
    expect(w.body).not.toMatch(/branches:\s*\[(main|master|trunk)\]/);
  });
});

describe("maintain (self-maintaining upkeep)", () => {
  it("emits a zero-dep script with check/note/touch and no embed hazards", () => {
    const m = buildMaintain();
    expect(m.path).toBe(".ai/maintain.mjs");
    expect(m.body.startsWith("#!/usr/bin/env node")).toBe(true);
    for (const sub of ["'check'", "'note'", "'touch'"]) expect(m.body).toContain(sub);
    expect(m.body).toContain("diff --name-only");
    expect(m.body).not.toContain("`");
    expect(m.body).not.toContain("${");
  });
});

describe("foundation", () => {
  it("bundles manifest, doctor, CI gate, maintain, memory and context in scaffold order", () => {
    const files = buildFoundation(makeReport());
    const paths = files.map((f) => f.path);
    expect(paths[0]).toBe(".ai/manifest.yaml"); // spine first
    expect(paths[1]).toBe(".ai/doctor.mjs"); // then the baseline check
    expect(paths).toContain(".github/workflows/ai-conformance.yml"); // its CI backstop
    expect(paths).toContain(".ai/maintain.mjs"); // self-maintaining upkeep
    expect(paths).toContain(".ai/memory/README.md");
    expect(paths).toContain(".ai/context-index.json");
  });
});

// ---------------------------------------------------------------------------------------------------
// The serializer (manifest.ts) and the doctor's YAML parsers (doctor.ts) are an IMPLICIT, executable
// contract: the doctor must read back exactly what the serializer wrote. The two halves above test
// each in isolation (serializer output as strings; doctor *source text* contains markers) — nothing
// feeds one to the other. A drift (quote style, indent, flow-list shape) ships green but hard-fails
// every adopting repo's CI conformance gate on a manifest Ascent itself produced.
//
// This block closes that gap by extracting the doctor's ACTUAL pure parsers from `buildDoctor().body`
// (so we exercise the shipped regexes verbatim, not a hand-copy) and running them on real
// `serializeManifestYaml(...)` output. If anyone "simplifies" either side, these break loudly.
// ---------------------------------------------------------------------------------------------------

/**
 * Slice a single `function NAME(...) { ... }` out of the doctor source. Brace-counting is unsafe here
 * because the parser bodies contain regex literals with `{`/`}` (quantifiers + escaped braces), so we
 * instead cut from each function's declaration to the next top-level declaration. The functions are
 * emitted contiguously (kv, sub, flow, capabilities) ahead of `const path = '.ai/manifest.yaml';`.
 */
const FN_ORDER = ["kv", "sub", "flow", "capabilities"] as const;
function extractFn(source: string, name: string): string {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("doctor parser not found: " + name);
  const next = FN_ORDER[FN_ORDER.indexOf(name as (typeof FN_ORDER)[number]) + 1];
  // The terminator is the next parser's declaration, or (for the last one) the first statement after
  // the parser block.
  const endMarker = next ? "function " + next + "(" : "\nconst path = ";
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error("could not bound doctor parser: " + name);
  return source.slice(start, end).trimEnd();
}

/** Build callable copies of the doctor's parsers from its emitted (zero-dep, eval-safe) source. */
function loadDoctorParsers(): {
  kv: (text: string, key: string) => string | null;
  sub: (text: string, key: string) => string | null;
  flow: (text: string, key: string) => string[];
  capabilities: (text: string) => Record<string, string>;
} {
  const body = buildDoctor().body;
  const src = FN_ORDER.map((n) => extractFn(body, n)).join("\n\n");
  // The four parsers reference only each other / built-ins, so they are self-contained.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(src + "\nreturn { kv, sub, flow, capabilities };");
  return factory();
}

describe("manifest <-> doctor round-trip", () => {
  const parsers = loadDoctorParsers();

  /** A representative report: multiple capabilities, commands, and flow lists exercised end-to-end. */
  function roundTrip(lang = "TypeScript") {
    const data = buildManifestData(makeReport(lang));
    const yaml = serializeManifestYaml(data);
    return { data, yaml };
  }

  it("the doctor reads back EVERY capability + command the serializer wrote (field by field)", () => {
    const { data, yaml } = roundTrip("TypeScript");
    const caps = parsers.capabilities(yaml);

    // The serializer wrote build/test/lint/typecheck — the doctor must see all of them, not {}.
    expect(Object.keys(caps).sort()).toEqual(Object.keys(data.capabilities).sort());
    for (const [name, cap] of Object.entries(data.capabilities)) {
      expect(caps[name]).toBe(cap.command); // exact command, not a regex near-miss
    }
    // Concretely (guards against a silent rename/drop of the standard four):
    expect(caps.build).toBe("npm run build");
    expect(caps.test).toBe("npm test");
    expect(caps.lint).toBe("npm run lint");
    expect(caps.typecheck).toBe("npx tsc --noEmit");
  });

  it("a non-TS language's commands round-trip identically (Python: quote-free but distinct)", () => {
    const { data, yaml } = roundTrip("Python");
    const caps = parsers.capabilities(yaml);
    expect(Object.keys(caps).sort()).toEqual(Object.keys(data.capabilities).sort());
    expect(caps.test).toBe("pytest");
    expect(caps.typecheck).toBe("mypy .");
    for (const [name, cap] of Object.entries(data.capabilities)) {
      expect(caps[name]).toBe(cap.command);
    }
  });

  it("a 'generic' manifest (placeholder <...> commands, no typecheck) still parses cleanly", () => {
    // generic has a null TYPECHECK so the capability is omitted — the parser must not choke and must
    // surface the remaining capabilities, including the <placeholder> ones the doctor later WARNs on.
    const { data, yaml } = roundTrip("Brainfuck"); // unknown language -> commandsFor falls back to generic
    const caps = parsers.capabilities(yaml);
    expect(Object.keys(caps).sort()).toEqual(Object.keys(data.capabilities).sort());
    for (const [name, cap] of Object.entries(data.capabilities)) {
      expect(caps[name]).toBe(cap.command);
    }
    expect(data.capabilities.typecheck).toBeUndefined(); // generic -> no typecheck capability
  });

  it("top-level key/values (schema, schemaVersion, generatedAt) round-trip via kv()", () => {
    const { data, yaml } = roundTrip();
    expect(parsers.kv(yaml, "schema")).toBe("ai-manifest");
    expect(parsers.kv(yaml, "schemaVersion")).toBe(data.schemaVersion);
    // generatedAt is JSON.stringify'd (quoted); kv strips the surrounding quotes.
    expect(parsers.kv(yaml, "generatedAt")).toBe(data.generatedAt);
  });

  it("the paths: sub-object round-trips via sub() — scoped to the paths block like the doctor does", () => {
    const { data, yaml } = roundTrip();
    // Mirror the doctor's own scoping so a like-named capability can't shadow paths.*.
    const pathsBlock = (yaml.split(/\npaths:\n/)[1] || "").split(/\n[a-z]/i)[0];
    expect(parsers.sub(pathsBlock, "contextIndex")).toBe(data.paths.contextIndex);
    expect(parsers.sub(pathsBlock, "memory")).toBe(data.paths.memory);
    expect(parsers.sub(pathsBlock, "evals")).toBe(data.paths.evals);
    expect(parsers.sub(pathsBlock, "guardrails")).toBe(data.paths.guardrails);
  });

  it("flow lists (controls.prePush / ciHardPass / generatedFrom) round-trip via flow()", () => {
    const { data, yaml } = roundTrip();
    expect(parsers.flow(yaml, "prePush")).toEqual(data.controls.prePush);
    expect(parsers.flow(yaml, "ciHardPass")).toEqual(data.controls.ciHardPass);
    expect(parsers.flow(yaml, "generatedFrom")).toEqual(data.generatedFrom);
    // Sanity: these are the exact business-meaningful lists the gate keys on.
    expect(parsers.flow(yaml, "prePush")).toEqual(["lint", "typecheck", "scan-secrets"]);
    expect(parsers.flow(yaml, "ciHardPass")).toEqual(["test", "sast", "merge-gate"]);
  });

  it("an EMPTY flow list (boundaries.neverTouch = []) round-trips to []", () => {
    const { data, yaml } = roundTrip();
    expect(data.boundaries.neverTouch).toEqual([]); // serializer emits `[]`
    // flow() filters Boolean, so `[]` (or `[ ]`) parses to an empty array, not `['']`.
    expect(parsers.flow(yaml, "neverTouch")).toEqual([]);
  });

  it("the WHOLE flow-list <-> serializer contract holds for an arbitrary multi-item list", () => {
    // Directly exercise the serializer's flowList shape against the doctor's flow() parser with a
    // representative list, including a token the `scalar()` quoter leaves bare and one it must quote.
    const data = buildManifestData(makeReport());
    data.controls.prePush = ["lint", "type-check", "scan-secrets"]; // hyphen token stays bare
    const yaml = serializeManifestYaml(data);
    expect(parsers.flow(yaml, "prePush")).toEqual(["lint", "type-check", "scan-secrets"]);
  });

  // --- Edge content the serializer CAN emit, pinned against the doctor that must parse it ----------

  it("KNOWN drift: a command containing a double-quote does NOT round-trip (serializer JSON-escapes; doctor regex stops at the escaped quote)", () => {
    // The serializer writes the command via JSON.stringify -> `"echo \"hi\""`. The doctor's
    // capability regex is `command:\s*"([^"]*)"` which captures up to the FIRST `"`, i.e. it stops
    // at the backslash-escaped quote and yields the truncated `echo \` instead of `echo "hi"`.
    // No real command has quotes today, so this is latent — but it IS a serializer/parser drift.
    // Pinned as CURRENT behavior so any future change to either side is a deliberate, visible one.
    const data = buildManifestData(makeReport());
    data.capabilities.test = { command: 'echo "hi"', verified: false };
    const yaml = serializeManifestYaml(data);
    const caps = parsers.capabilities(yaml);
    // Faithful round-trip WOULD be 'echo "hi"'. It is not — document the truncation.
    expect(caps.test).not.toBe('echo "hi"');
    expect(caps.test).toBe('echo \\'); // truncated at the first escaped quote (\" -> \)
  });

  it("a command with shell special chars (no quotes needed by JSON) round-trips faithfully", () => {
    // JSON.stringify only needs to escape `"` and `\`; pipes/flags/&& are emitted verbatim inside the
    // double quotes and the doctor's `[^"]*` capture reads them back exactly.
    const data = buildManifestData(makeReport());
    data.capabilities.lint = { command: "ruff check . && mypy --strict", verified: false };
    const yaml = serializeManifestYaml(data);
    expect(parsers.capabilities(yaml).lint).toBe("ruff check . && mypy --strict");
  });

  it("a quote-needing scalar field (purpose with special chars) round-trips through kv/sub", () => {
    // purpose is always JSON.stringify'd by the serializer; sub() strips the wrapping quotes. As long
    // as the value has no inner `"`, the round-trip is exact.
    const data = buildManifestData(makeReport());
    data.repo.purpose = "Billing: API, v2 (prod)";
    const yaml = serializeManifestYaml(data);
    const repoBlock = (yaml.split(/\nrepo:\n/)[1] || "").split(/\n[a-z]/i)[0];
    expect(parsers.sub(repoBlock, "purpose")).toBe("Billing: API, v2 (prod)");
  });
});
