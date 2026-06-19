import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
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
import { buildOnboardingSkill } from "@/lib/onboarding/skill";
import type { GeneratedFile } from "./types";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

// The onboarding skill imports `buildFoundation` from this same barrel (`@/lib/standard`). To pin the
// code-fence escaping invariant we need to feed `embedFile` (private to skill.ts) a hostile file body,
// so we mock the barrel BUT default every export to the real implementation — the 30+ tests above that
// import from "./index" (the same resolved module) keep their real behaviour; only the fence test
// below swaps `buildFoundation` for ONE call via `mockImplementationOnce`.
vi.mock("@/lib/standard", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, buildFoundation: vi.fn(actual.buildFoundation) };
});

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

  it("a command containing a double-quote round-trips EXACTLY (serializer JSON-escapes; doctor JSON-unescapes)", () => {
    // The serializer writes the command via JSON.stringify -> `"echo \"hi\""`. The doctor's capability
    // regex now matches the FULL JSON-escaped string (`"(?:[^"\\]|\\.)*"`) and JSON-parses the capture,
    // so a backslash-escaped quote reads back as a real `"`. The command round-trips byte-for-byte.
    const data = buildManifestData(makeReport());
    data.capabilities.test = { command: 'echo "hi"', verified: false };
    const yaml = serializeManifestYaml(data);
    const caps = parsers.capabilities(yaml);
    // Faithful round-trip: the inner quotes survive intact, not truncated at the first escaped quote.
    expect(caps.test).toBe('echo "hi"');
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

// ---------------------------------------------------------------------------------------------------
// The conformance SCORE and EXIT CODE are the CI merge gate every adopting repo runs. The round-trip
// block above proves the doctor's PARSERS read the serializer's manifest; this block proves the whole
// SCRIPT — findings collection, the `weight={pass:1,warn:0.5,fail:0}` score, the `exit(fails>0?1:0)`
// verdict, and the `--json` payload shape POSTed to /api/report/conformance. The round-trip tests run
// only the four parser functions in `new Function`; they can't see the top-level `await`/`fetch`/
// `process.exit` logic. So here we materialize `buildDoctor().body` to a real `doctor.mjs` and EXECUTE
// it with the project's own Node against crafted fixture repos in a temp dir.
//
// INVARIANT pinned: a CONFORMANT fixture (valid manifest + memory + context-index + a local hook the
// prePush controls are wired into) makes the gate PASS (exit 0, JSON fails===0); each NON-conformant
// fixture (missing manifest; a bad `schema:` field) makes it FAIL (non-zero exit, a `fail` finding
// naming the reason). The --json summary shape is exactly what conformance/route.ts ingests.
// ---------------------------------------------------------------------------------------------------

describe("doctor execution gate (score + exit code against fixture repos)", () => {
  /** Write the shipped doctor body to <dir>/.ai/doctor.mjs and run it with --json. Returns the parsed
   *  summary plus the raw exit code so tests can assert BOTH the gate verdict and the payload. */
  function runDoctor(dir: string): {
    status: number;
    stdout: string;
    json: { score: number; fails: number; warns: number; findings: { level: string; msg: string }[] };
  } {
    const doctorPath = join(dir, ".ai", "doctor.mjs");
    mkdirSync(dirname(doctorPath), { recursive: true });
    writeFileSync(doctorPath, buildDoctor().body, "utf8");
    // Run from the fixture root so the doctor's `process.cwd()`-relative existsSync checks resolve
    // against the fixture, not Ascent. Strip the conformance env so it never tries to POST.
    const res = spawnSync(process.execPath, [doctorPath, "--json"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ASCENT_CONFORMANCE_URL: "", ASCENT_CONFORMANCE_TOKEN: "", GITHUB_REPOSITORY: "" },
    });
    expect(res.error, res.error?.message).toBeUndefined();
    const stdout = res.stdout ?? "";
    // The --json line is the LAST JSON object on stdout (after the human-readable report).
    const jsonLine = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
    expect(jsonLine, "doctor did not emit a --json summary line. stdout=\n" + stdout).toBeTruthy();
    return { status: res.status ?? -1, stdout, json: JSON.parse(jsonLine!) };
  }

  /** Lay down a genuinely conformant `.ai/` foundation for `report` plus a local hook that wires the
   *  backed prePush controls (lint, typecheck) — so the doctor finds ZERO fails. */
  function writeConformantRepo(dir: string, report = makeReport()) {
    for (const f of buildFoundation(report)) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.body, "utf8");
    }
    // A pre-commit/pre-push hook the prePush controls are wired into (manifest declares
    // prePush:[lint,typecheck,scan-secrets]; lint+typecheck are backed capabilities the doctor checks
    // are present in the hook text). Without this the doctor emits a FAIL ("NO local hook").
    writeFileSync(join(dir, "lefthook.yml"), "pre-push:\n  commands:\n    lint: { run: npm run lint }\n    typecheck: { run: npx tsc --noEmit }\n", "utf8");
    // At least one CI workflow so ciHardPass doesn't even warn about missing CI.
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: CI\non: [pull_request]\n", "utf8");
  }

  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ascent-doctor-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("CONFORMANT fixture → gate PASSES: exit 0 and JSON fails===0", () => {
    writeConformantRepo(tmp);
    const { status, json } = runDoctor(tmp);

    // The gate passes: no fail-level findings, process exits 0.
    expect(json.fails).toBe(0);
    expect(status).toBe(0);
    // The verdict score follows the documented weight={pass:1,warn:0.5,fail:0} contract: with no
    // fails it cannot be below the mean of pass(1)/warn(0.5) findings, i.e. it is comfortably high.
    expect(json.score).toBeGreaterThanOrEqual(50);
    expect(json.score).toBeLessThanOrEqual(100);
    // It still positively confirmed the spine (schema + capabilities) rather than vacuously passing.
    expect(json.findings.some((f) => f.level === "pass" && /schema ok/.test(f.msg))).toBe(true);
    expect(json.findings.some((f) => f.level === "pass" && /declares \d+ capabilities/.test(f.msg))).toBe(true);
  });

  it("NON-conformant (missing .ai/manifest.yaml) → gate FAILS: exit 1 with a fail naming the missing manifest", () => {
    // Empty repo: doctor body present, but no manifest beside it. The doctor's very first check fails.
    const { status, json } = runDoctor(tmp);

    expect(status).toBe(1); // exit(fails>0?1:0)
    expect(json.fails).toBeGreaterThanOrEqual(1);
    const fail = json.findings.find((f) => f.level === "fail");
    expect(fail, "expected a fail finding").toBeTruthy();
    expect(fail!.msg).toMatch(/missing .ai\/manifest\.yaml/);
    // A missing-spine repo must NOT score 100 — the gate is not toothless.
    expect(json.score).toBeLessThan(100);
  });

  it("NON-conformant (bad manifest field: schema id not 'ai-manifest') → gate FAILS: exit 1 with the schema fail", () => {
    // Take the otherwise-conformant repo, then corrupt only the `schema:` line of the manifest. The
    // structure is intact (capabilities still parse) so the ONLY new fail is the schema-id check —
    // proving the gate keys on the specific field, not just on presence.
    writeConformantRepo(tmp);
    const manifestPath = join(tmp, ".ai", "manifest.yaml");
    const good = serializeManifestYaml(buildManifestData(makeReport()));
    const broken = good.replace(/^schema: ai-manifest$/m, "schema: ai-manifest-BROKEN");
    expect(broken).not.toBe(good); // the corruption actually landed
    writeFileSync(manifestPath, broken, "utf8");

    const { status, json } = runDoctor(tmp);
    expect(status).toBe(1);
    expect(json.fails).toBeGreaterThanOrEqual(1);
    expect(json.findings.some((f) => f.level === "fail" && /schema id is not/.test(f.msg))).toBe(true);
  });

  it("the --json payload has exactly the {score,fails,warns,findings} shape conformance/route.ts ingests", () => {
    // The doctor auto-POSTs { repo, headSha, score, fails, warns } and prints { score, fails, warns,
    // findings }. The route reads score/fails/warns as numbers — pin those keys + types so a payload
    // rename can't silently break ingestion (the route would then 400 on missing numerics).
    writeConformantRepo(tmp);
    const { json } = runDoctor(tmp);
    expect(Object.keys(json).sort()).toEqual(["fails", "findings", "score", "warns"]);
    expect(typeof json.score).toBe("number");
    expect(typeof json.fails).toBe("number");
    expect(typeof json.warns).toBe("number");
    expect(Array.isArray(json.findings)).toBe(true);
    // Every finding is a {level,msg} with a level the score's weight map knows.
    for (const f of json.findings) {
      expect(["pass", "warn", "fail"]).toContain(f.level);
      expect(typeof f.msg).toBe("string");
    }
    // The reported counts agree with the findings array (the numbers the route trusts are derived,
    // not free-floating).
    expect(json.fails).toBe(json.findings.filter((f) => f.level === "fail").length);
    expect(json.warns).toBe(json.findings.filter((f) => f.level === "warn").length);
  });
});

// ---------------------------------------------------------------------------------------------------
// The onboarding SKILL.md is downloaded and executed by the adopting repo's Claude Code CLI, so the
// two structural sanitizers in src/lib/onboarding/skill.ts are SECURITY-shaped, not cosmetic:
//   (a) `safeDesc` collapses `[\r\n]+`→space and `"`→`'` so a repo-derived value (owner/name/level,
//       interpolated into the YAML `description:` scalar) can't break out of the quoted scalar and
//       inject extra frontmatter keys or a premature `---` that splits the block.
//   (b) `embedFile` fences each embedded file with `Math.max(4, longestBacktickRun + 1)` backticks so
//       a file body containing its own fence (even a 4-backtick run) can't close the outer fence early
//       and leak/garble the doctor source the agent is told to write verbatim.
// The tests above check happy-path PRESENCE only. This block feeds ADVERSARIAL inputs (a name carrying
// `---`, newlines, `"`, YAML special chars; a file body carrying a 4-backtick fence) and pins the
// containment invariant: the hostile bytes stay INSIDE the value/block they came in on.
// ---------------------------------------------------------------------------------------------------

describe("onboarding skill — frontmatter-injection + code-fence escaping invariants", () => {
  /** Split a SKILL.md body into [frontmatterText, rest] using the FIRST two `---` delimiter lines —
   *  exactly the YAML-frontmatter contract (a leading `---`, a body, a closing `---`). */
  function frontmatterBlock(body: string): string {
    expect(body.startsWith("---\n")).toBe(true); // the doc MUST open on the delimiter
    const after = body.slice(4); // drop the opening "---\n"
    const close = after.indexOf("\n---"); // the SECOND delimiter line closes the block
    expect(close, "frontmatter block has no closing ---").toBeGreaterThanOrEqual(0);
    return after.slice(0, close);
  }

  it("(a) a hostile repo name/owner with --- , newlines and quotes cannot inject or split the frontmatter", () => {
    // Owner+name are interpolated straight into the `description:` scalar. Pack every frontmatter-
    // breaking primitive into them: a YAML delimiter, raw newlines, a closing quote, and a forged key.
    const evilOwner = 'ev"il';
    const evilName = 'api\n---\nname: pwned\ninjected: true\n"x: y';
    const report = makeReport();
    report.repo.owner = evilOwner;
    report.repo.name = evilName;

    const skill = buildOnboardingSkill(report);
    const fm = frontmatterBlock(skill.body);

    // INVARIANT 1 — the block is still ONE frontmatter block: between the first two delimiters there is
    // no stray `---` line that would have closed it early and let `name: pwned` escape into YAML.
    expect(fm.split("\n").some((l) => l.trim() === "---")).toBe(false);

    // INVARIANT 2 — exactly the two intended keys, and NOTHING the attacker forged. The frontmatter is
    // exactly two physical lines (the sanitizer guarantees the description scalar is single-line), so a
    // YAML-ish `key: value` parse of every line yields precisely {name, description}. The forged
    // `injected:` / `name: pwned` are NOT top-level keys — they only survive as prose inside the one
    // description scalar (asserted in INVARIANT 4), where YAML treats them as part of the quoted value.
    const lines = fm.split("\n").filter(Boolean);
    expect(lines.length).toBe(2); // no extra key lines were injected
    const keys = lines.map((l) => l.slice(0, l.indexOf(":")));
    expect(keys).toEqual(["name", "description"]);
    // The forged tokens never appear at the START of a line (i.e. never as their own YAML key).
    expect(lines.some((l) => /^injected:/.test(l))).toBe(false);
    expect(lines.some((l) => /^name: pwned/.test(l))).toBe(false);

    // INVARIANT 3 — the name line is exactly the real skill name, untouched by the hostile value.
    expect(fm.split("\n")[0]).toBe("name: ascent-onboard");

    // INVARIANT 4 — the description is a SINGLE physical line wrapped in double quotes with no inner
    // raw newline and no inner double-quote (both would break the scalar). The hostile `"` and `\n`
    // were neutralised to `'` and a space.
    const descLine = fm.split("\n").find((l) => l.startsWith("description: "))!;
    const scalar = descLine.slice("description: ".length);
    expect(scalar.startsWith('"') && scalar.endsWith('"')).toBe(true);
    const inner = scalar.slice(1, -1);
    expect(inner).not.toContain("\n");
    expect(inner).not.toContain("\r");
    expect(inner).not.toContain('"'); // every quote collapsed to '
    // The hostile fragments survive only as INERT text inside the one description scalar.
    expect(inner).toContain("ev'il"); // " -> '
    expect(inner).toContain("name: pwned"); // present, but as quoted prose, not a YAML key
  });

  it("(b) a generated file body containing a 4-backtick fence cannot break out of its markdown code block", async () => {
    // Inject a hostile GeneratedFile via the mocked buildFoundation for ONE buildOnboardingSkill call.
    // Its body carries a four-backtick run AND a fake closing fence + leak marker on its own line — the
    // exact shape that would terminate a naive 3/4-backtick wrapper and spill the rest as live markdown.
    const FENCE4 = "`".repeat(4);
    const LEAK = "LEAKED_OUTSIDE_THE_FENCE_MARKER";
    const hostile: GeneratedFile = {
      path: ".ai/evil.mjs",
      lang: "javascript",
      purpose: "adversarial body with an inner code fence",
      body: `const a = 1;\n${FENCE4}\n${LEAK}\nmore body after the inner fence`,
    };
    const { buildFoundation: mockedBuildFoundation } = await import("@/lib/standard");
    (mockedBuildFoundation as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => [hostile]);

    const skill = buildOnboardingSkill(makeReport());

    // Locate the embed wrapper for our hostile file by its path heading.
    const heading = "#### `.ai/evil.mjs`";
    const at = skill.body.indexOf(heading);
    expect(at, "hostile embed block not found — mock did not apply").toBeGreaterThanOrEqual(0);

    // Isolate this embed: from its heading up to the next blank-line-separated section (the embed is
    // the LAST section of the skill body, so the remainder is the whole block).
    const embed = skill.body.slice(at);

    // INVARIANT 1 — the chosen opening fence is LONGER than the longest backtick run in the body, so it
    // cannot be closed by anything the body contains. The body's longest run is 4 → fence must be >=5.
    const openFence = embed.match(/\n(`{5,})javascript\n/);
    expect(openFence, "embed did not open a >=5-backtick fence around a 4-backtick body").toBeTruthy();
    const fence = openFence![1];
    expect(fence.length).toBeGreaterThanOrEqual(5);
    expect(fence.length).toBeGreaterThan(4); // strictly longer than the body's longest (4) run
    expect(FENCE4).not.toBe(fence); // the inner 4-backtick run can never equal/close the wrapper

    // INVARIANT 2 — the leak marker stays INSIDE the fenced block. The embed is
    // `<heading>\n_<purpose>_\n\n<fence><lang>\n<body><fence>`: the body sits between the open-fence
    // line and the FINAL occurrence of the same fence (which closes it, appended directly to the body).
    const openIdx = embed.indexOf(fence + "javascript\n");
    const afterOpen = openIdx + (fence + "javascript\n").length;
    const closeIdx = embed.indexOf(fence, afterOpen); // the very next bare fence is the legitimate close
    expect(closeIdx).toBeGreaterThan(afterOpen);
    const fenced = embed.slice(afterOpen, closeIdx);
    expect(fenced).toContain(LEAK); // the marker is contained, not leaked below the block
    expect(fenced).toContain(FENCE4); // the inner 4-backtick run lives harmlessly inside

    // INVARIANT 3 — the wrapper fence appears EXACTLY twice in the embed (open + close): the hostile
    // body did not introduce a third standalone boundary that would desync the surrounding markdown.
    const occurrences = embed.split(fence).length - 1;
    expect(occurrences).toBe(2);
  });

  it("(b') the normal (un-mocked) foundation embeds use balanced fences that never desync", () => {
    // Sanity backstop on the real generator: every embedded file opens and closes with a fence whose
    // length exceeds any backtick run in its own body (the .mjs scripts are backtick-free, so >=4).
    const skill = buildOnboardingSkill(makeReport());
    // Each embed heading is followed, two lines down, by an opening fence of >=4 backticks.
    const embeds = [...skill.body.matchAll(/#### `[^`]+`\n_[^\n]*_\n\n(`{4,})/g)];
    expect(embeds.length).toBeGreaterThan(0);
    for (const m of embeds) {
      const fence = m[1];
      expect(fence.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// maintain.mjs `note` subcommand is the WRITE path of the "append-only memory" ledger the whole
// standard sells: it parses the existing `NNNN-*.md` filenames, takes `max(...)+1`, zero-pads to 4,
// and slugifies the text. A regression in the id math (off-by-one; a non-`NNNN` file like README.md
// leaking into the id set; a NaN slipping past the filter) yields a DUPLICATE or `NaN` id that
// silently overwrites a prior memory entry — exactly the knowledge the store exists to preserve. The
// slug edge (all-punctuation text -> empty -> must fall back to 'note') is equally unguarded.
//
// The existing maintain test ("emits a zero-dep script ...") only checks SUBSTRING PRESENCE of the
// emitted source. The id/slug logic is pure and trivially testable but never EXERCISED. So — mirroring
// the doctor round-trip block above — we extract the SHIPPED expressions verbatim from
// `buildMaintain().body` (not a hand copy) and run them, pinning the monotonic-id + slug invariants.
//
// `note` derives, in order (maintain.ts:56-58):
//   ids  = readdirSync(MEM).map(f => parseInt((f.match(/^(\d{4})-/) || [])[1], 10)).filter(n => !isNaN(n))
//   next = String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0')
//   slug = text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'note'
// We rebuild `nextId(files)` and `slugOf(text)` from those exact fragments so a tweak to either the
// `^(\d{4})-` filename regex, the `max+1` math, the pad width, or the slug pipeline breaks LOUDLY.
// ---------------------------------------------------------------------------------------------------

/**
 * Pull the two pure derivations out of the EMITTED maintain source and compile them with `new
 * Function`, so the test exercises the regexes/math that actually ship — identical strategy to
 * `loadDoctorParsers` above. `buildMaintain().body` is the already-unescaped runtime string, so the
 * source's `\\d{4}` literal is the real `\d{4}` here. We assert each fragment is present (a refactor
 * that moves the logic out of these expressions would null this extraction, failing loudly) and then
 * wrap them: `nextId(files)` over an array of filenames, `slugOf(text)` over a title.
 */
function loadMaintainNoteLogic(): {
  nextId: (files: string[]) => string;
  slugOf: (text: string) => string;
} {
  const body = buildMaintain().body;

  // The id derivation: the `.map(...).filter(...)` over a filename list, then the `max+1`/pad string.
  const idMapFilter = "files.map((f) => parseInt((f.match(/^(\\d{4})-/) || [])[1], 10)).filter((n) => !isNaN(n))";
  const idNext = "String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0')";
  // The slug pipeline, verbatim from the source (the only difference from maintain.ts is `text` is our
  // parameter rather than the CLI-derived local — the transform chain is byte-identical).
  const slugExpr = "text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note'";

  // Sanity: the SHIPPED source still contains these exact fragments. If a refactor renames/reshapes
  // them, this extraction is stale and the test must fail rather than silently testing a stand-in.
  expect(body).toContain(".map((f) => parseInt((f.match(/^(\\d{4})-/) || [])[1], 10)).filter((n) => !isNaN(n))");
  expect(body).toContain("String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0')");
  expect(body).toContain("text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note'");

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "return {\n" +
      "  nextId: (files) => { const ids = " + idMapFilter + "; return " + idNext + "; },\n" +
      "  slugOf: (text) => " + slugExpr + ",\n" +
      "};",
  );
  return factory();
}

describe("maintain — memory-entry numbering + slug invariants (append-only ledger)", () => {
  const { nextId, slugOf } = loadMaintainNoteLogic();

  // --- numbering: monotonic, zero-padded, collision-free against the existing ledger ---------------

  it("ignores non-NNNN files (README.md) and takes max+1, not count+1", () => {
    // README.md must NOT enter the id set (it has no NNNN- prefix); max(1,7)+1 = 8, NOT count(3).
    expect(nextId(["0001-a.md", "0007-b.md", "README.md"])).toBe("0008");
  });

  it("an empty memory dir starts the ledger at 0001", () => {
    expect(nextId([])).toBe("0001");
    // A dir with ONLY non-NNNN files is equivalent to empty for id purposes.
    expect(nextId(["README.md", "notes.txt", "CONTEXT.md"])).toBe("0001");
  });

  it("the next id is strictly the running MAX + 1 (order-independent, not last-seen)", () => {
    // Out-of-order and with a gap: max is 0042, so next is 0043 regardless of array order.
    expect(nextId(["0042-z.md", "0003-a.md", "0011-m.md"])).toBe("0043");
    expect(nextId(["0011-m.md", "0042-z.md", "0003-a.md"])).toBe("0043");
  });

  it("the derived id NEVER collides with an existing id (monotonic strictly above the max)", () => {
    // The core append-only invariant: across a batch of growing ledgers, each next id is numerically
    // greater than every id already present, so it can never overwrite a prior entry's file.
    const files: string[] = [];
    let maxSoFar = 0;
    for (let i = 0; i < 25; i++) {
      const id = nextId(files);
      const n = parseInt(id, 10);
      expect(id).toMatch(/^\d{4}$/); // always 4-digit, zero-padded
      expect(n).toBe(maxSoFar + 1); // strictly one above the prior max — no duplicate, no NaN, no skip
      // Append the freshly-numbered entry and re-derive: the ledger grows monotonically.
      files.push(id + "-entry-" + i + ".md");
      maxSoFar = n;
    }
    // The id set is collision-free: 25 derived ids, all distinct.
    const ids = files.map((f) => f.slice(0, 4));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a malformed 3-digit or 5-digit prefix does not match ^(\\d{4})- and is ignored", () => {
    // Only EXACTLY-4-digit prefixes count; `999-` (3) and `00001-` (5) must not pollute the max.
    expect(nextId(["0005-real.md", "999-short.md", "00001-long.md"])).toBe("0006");
    // If NONE are valid 4-digit, fall back to 0001 (no NaN id from an unparsable prefix).
    expect(nextId(["999-short.md", "abc-nope.md"])).toBe("0001");
  });

  it("zero-pads past four digits without truncating large ledgers", () => {
    // padStart(4) only pads; a 4+ digit number is emitted in full (never silently clipped to 4 chars).
    expect(nextId(["9999-x.md"])).toBe("10000");
  });

  // --- slug: deterministic, kebab, bounded, with a guaranteed non-empty fallback -------------------

  it("derives a deterministic kebab slug from the title (lowercased, [^a-z0-9]+ -> single -)", () => {
    expect(slugOf("Adopt the AI Standard")).toBe("adopt-the-ai-standard");
    // Runs of punctuation/space collapse to a SINGLE hyphen; same input -> same output (deterministic).
    expect(slugOf("Use   pg_bouncer!! (prod)")).toBe("use-pg-bouncer-prod");
    expect(slugOf("Use   pg_bouncer!! (prod)")).toBe(slugOf("Use   pg_bouncer!! (prod)"));
  });

  it("an all-punctuation title collapses to empty and falls back to 'note' (never an empty slug)", () => {
    expect(slugOf("!!! @@@")).toBe("note");
    expect(slugOf("   ")).toBe("note");
    expect(slugOf("")).toBe("note");
    // The fallback guarantees the filename is always `NNNN-<non-empty>.md`, never `NNNN-.md`.
    expect(slugOf("---")).toBe("note");
  });

  it("a long title is bounded to <=40 chars with no LEADING hyphen", () => {
    // The shipped pipeline trims `^-|-$` BEFORE `.slice(0, 40)`, so the cap is the binding bound: a
    // 40-char-plus title is clamped to exactly 40 chars and never starts with a hyphen (the title is
    // lowercased word-content here). We pin the real, deterministic output of trim-then-slice.
    const slug = slugOf("Adopt the new standard and then write a much longer tail beyond the cap");
    expect(slug.length).toBe(40);
    expect(slug.startsWith("-")).toBe(false);
    expect(slug).toBe("adopt-the-new-standard-and-then-write-a-"); // exact, deterministic clamp
  });

  it("documents the trim-then-slice ordering: the 40-char slice CAN re-expose a boundary hyphen", () => {
    // Faithful-behavior pin (NOT an idealization): because `.replace(/^-|-$/g,'')` runs BEFORE
    // `.slice(0,40)`, a title whose char at index 40 is a separator leaves a trailing '-' after the
    // cut. This is a real (benign) property of the SHIPPED slug logic; if a refactor reorders the
    // pipeline to slice-then-trim, this assertion flips and flags the behavior change loudly.
    // 39 'a' then a separator: trimmed slug is "aaa...(39)-tail"; the separator lands at index 39, so
    // `.slice(0,40)` keeps the first 39 'a' PLUS that hyphen — a trailing '-' the pre-slice trim can't
    // remove (it already ran). The 41st+ chars ("tail") are dropped.
    const slug = slugOf("a".repeat(39) + " tail");
    expect(slug.length).toBe(40);
    expect(slug).toBe("a".repeat(39) + "-");
    expect(slug.endsWith("-")).toBe(true); // documented, not desired — guards against silent reorder
  });

  it("a slug is collision-free with the id: distinct titles map to distinct filenames under one id", () => {
    // Two entries appended at the SAME ledger size get DIFFERENT ids (numbering is monotonic), so even
    // identical slugs can't collide on the full `NNNN-slug.md` filename. Pin the joint invariant.
    const files: string[] = [];
    const id1 = nextId(files);
    files.push(id1 + "-" + slugOf("same title") + ".md");
    const id2 = nextId(files);
    files.push(id2 + "-" + slugOf("same title") + ".md"); // identical slug, different id
    expect(id1).not.toBe(id2);
    expect(files[0]).not.toBe(files[1]); // the full filenames differ -> no overwrite
    expect(new Set(files).size).toBe(files.length);
  });
});
