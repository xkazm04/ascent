// The generated doctor's HUMAN readout - asserted on EXECUTED stdout, never on the generator.
//
// `.ai/doctor.mjs` is the one artefact of this product that runs in an ADOPTER's terminal, pre-push
// hook and merge gate. Its stdout is what a maintainer (and that repo's own agent) acts on, so the
// readout is a product surface and is pinned here the only way it can honestly be pinned: by writing
// `buildDoctor().body` into a fixture repo, running it with the project's own Node, and reading what
// it printed. A test that asserted on the template string would stay green while the emitted script
// printed garbage.
//
// Three things are pinned as GUARDS rather than as new behaviour, because they are an adopter's CI
// contract and this change must not move them: the `--json` payload (keys AND values), the score
// arithmetic, and the exit code (`fails > 0 ? 1 : 0`).
//
// The remediation-coverage case enumerates the vocabulary from `./check-ids.ts` - this repo's own
// declaration of every id the doctor can emit - so a NEW check id that ships without a `fix:` hint
// fails this file. A hand-written list here would be coverage theater.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildDoctor } from "./doctor";
import { STATIC_CHECK_IDS, TEMPLATED_CHECK_PREFIXES } from "./check-ids";

// Each case spawns real Node subprocesses (one per fixture); green in isolation but past the 5s
// default when the full suite saturates the CPU.
vi.setConfig({ testTimeout: 60_000 });

type Run = { status: number; stdout: string; json: Record<string, unknown> | null };

function write(dir: string, rel: string, body: string) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, "utf8");
}

/** Materialize the shipped doctor into `dir` and run it with `args`. Returns the exit code, the raw
 *  stdout, and the `--json` summary when one was asked for. */
function runDoctor(dir: string, args: string[] = []): Run {
  const doctorPath = join(dir, ".ai", "doctor.mjs");
  mkdirSync(dirname(doctorPath), { recursive: true });
  writeFileSync(doctorPath, buildDoctor().body, "utf8");
  const res = spawnSync(process.execPath, [doctorPath, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ASCENT_CONFORMANCE_URL: "", ASCENT_CONFORMANCE_TOKEN: "", GITHUB_REPOSITORY: "" },
  });
  expect(res.error, res.error?.message).toBeUndefined();
  const stdout = res.stdout ?? "";
  const jsonLine = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
  return { status: res.status ?? -1, stdout, json: jsonLine ? JSON.parse(jsonLine) : null };
}

// ── the fixtures ────────────────────────────────────────────────────────────────────────────────
// Hand-written manifests rather than `buildManifestData`, so one fixture can trigger a named set of
// clauses deliberately instead of whatever the generator happens to emit this month.

/** A repo whose spine is fine but which has adopted none of the optional surfaces: no hook, no CI,
 *  no guidance block, no git. Triggers the "not yet adapted" half of the vocabulary. */
function fixtureUnadapted(dir: string) {
  write(dir, "package.json", '{"name":"x"}\n');
  write(
    dir,
    ".ai/manifest.yaml",
    [
      "schema: ai-manifest",
      "schemaVersion: 0.3.0",
      "paths:",
      "  contextIndex: .ai/context-index.json",
      "  memory: .ai/memory/",
      "capabilities:",
      '  lint: { command: "npm run lint", verified: false }',
      'generatedAt: "2026-06-10"',
      "generatedFrom: [package.json]",
      "controls:",
      "  prePush: [lint, scan-secrets]",
      "  ciHardPass: [test]",
      "# TODO: fill repo.purpose",
      "",
    ].join("\n"),
  );
}

/** A manifest that is wrong in the structural ways: bad schema id, a major the runner does not know,
 *  no capabilities, a pointer it declares but does not have, unfilled provenance, dangling guidance. */
function fixtureStructurallyBroken(dir: string) {
  write(
    dir,
    ".ai/manifest.yaml",
    [
      "schema: ai-manifest-BROKEN",
      "schemaVersion: 1.0.0",
      "paths:",
      "  contextIndex: .ai/context-index.json",
      "  memory: .ai/memory/",
      "  evals: evals/",
      "capabilities:",
      'generatedAt: "2026-06-10"',
      'generatedFrom: ["<your build manifest>"]',
      "controls:",
      "  prePush: [lint]",
      "  ciHardPass: [test]",
      "guidance:",
      "  canonical: NOPE.md",
      "  projections:",
      '    - { agent: claude, path: CLAUDE.md, generatedFrom: NOPE.md, hash: "aaaaaaaaaaaa" }',
      "",
    ].join("\n"),
  );
}

/** A repo that adopted every optional surface and got each one slightly wrong: a placeholder command,
 *  a hook that does not run the control, a tracked secret, a dangling CONTEXT.md, a missing
 *  projection. `git init` is real here - the never-commit guardrail needs an index to compare to. */
function fixtureAdoptedButBroken(dir: string) {
  write(
    dir,
    ".ai/manifest.yaml",
    [
      "schema: ai-manifest",
      "schemaVersion: 0.3.0",
      "paths:",
      "  contextIndex: .ai/context-index.json",
      "  memory: .ai/memory/",
      "  guardrails: .ai/guardrails.yaml",
      "capabilities:",
      '  lint: { command: "<run your linter>", verified: false }',
      'generatedAt: "2026-06-10"',
      "generatedFrom: []",
      "controls:",
      "  prePush: [lint]",
      "  ciHardPass: []",
      "guidance:",
      "  canonical: AGENTS.md",
      "  projections:",
      '    - { agent: claude, path: CLAUDE.md, generatedFrom: AGENTS.md, hash: "aaaaaaaaaaaa" }',
      "",
    ].join("\n"),
  );
  write(dir, ".ai/guardrails.yaml", 'schema: ai-guardrails\nneverCommit: [".env"]\n');
  write(dir, ".ai/memory/README.md", "notes\n");
  write(dir, ".ai/context-index.json", '{"modules":[{"id":"core","path":"src","context":"src/CONTEXT.md"}]}\n');
  write(dir, "AGENTS.md", "# guidance\n");
  write(dir, "lefthook.yml", "pre-push:\n  commands:\n    hello: { run: echo hi }\n");
  write(dir, ".env", "SECRET=1\n");
  const git = (...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-f", ".env");
}

// ── the readout parser ──────────────────────────────────────────────────────────────────────────
// `  FAIL  <check-id>  <message>` / `        fix: <hint>`. Parsing the emitted text (rather than
// trusting a substring) is what lets the coverage case key a hint to the id it belongs to.

const ROW_RE = /^ {2}(FAIL|WARN|SKIP|PASS) {2}(\S+) {2}(.+)$/;

type Row = { level: string; check: string; msg: string; fix: string };

function parseRows(stdout: string): Row[] {
  const lines = stdout.split("\n");
  const rows: Row[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ROW_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const next = /^ {4,}fix: (.+)$/.exec(lines[i + 1] ?? "");
    rows.push({ level: m[1]!, check: m[2]!, msg: m[3]!, fix: next ? next[1]! : "" });
  }
  return rows;
}

describe("doctor readout (executed stdout: triage, ids, remediation)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ascent-readout-"));
  });
  afterEach(() => {
    try {
      chmodSync(join(tmp, ".ai", "manifest.yaml"), 0o644);
    } catch {
      /* fixture had no manifest, or it was already writable */
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prints fails before warns and before any pass output, whatever order the checks were added in", () => {
    // 1 fail (no local hook), several warns, 2 unchecked, many passes - and the fail is emitted LAST
    // by the script (control placement is check 4, after the structure passes), so emission order and
    // severity order genuinely disagree here.
    fixtureAdoptedButBroken(tmp);
    const { stdout } = runDoctor(tmp);
    const rows = parseRows(stdout);

    const order = rows.map((r) => r.level);
    expect(order.length).toBeGreaterThan(3);
    expect(order).toContain("FAIL");
    expect(order).toContain("WARN");
    // Every FAIL index is below every WARN index, and below the collapsed pass line.
    const lastFail = order.lastIndexOf("FAIL");
    const firstWarn = order.indexOf("WARN");
    expect(firstWarn).toBeGreaterThan(lastFail);
    const passLineAt = stdout.split("\n").findIndex((l) => /^ {2}\d+ checks passed$/.test(l));
    expect(passLineAt).toBeGreaterThan(-1);
    const firstFailLineAt = stdout.split("\n").findIndex((l) => /^ {2}FAIL {2}/.test(l));
    expect(firstFailLineAt).toBeLessThan(passLineAt);
  });

  it("every finding line carries its stable check id", () => {
    const { stdout } = runDoctor(tmp); // empty repo: the one fail is the missing manifest
    expect(stdout).toMatch(/^\s*FAIL\s+manifest\.missing\b/m);
    fixtureAdoptedButBroken(tmp);
    for (const r of parseRows(runDoctor(tmp).stdout)) {
      expect(r.check, `a ${r.level} row printed no check id: ${r.msg}`).toMatch(/^[a-z][a-z0-9]*(\.[a-z0-9._/-]+)*$/);
    }
  });

  it("collapses passes to one line by default and expands them under --verbose", () => {
    fixtureAdoptedButBroken(tmp);
    const plain = runDoctor(tmp).stdout;
    const collapsed = plain.split("\n").filter((l) => /^ {2}\d+ checks passed$/.test(l));
    expect(collapsed.length).toBe(1);
    const n = Number(/(\d+) checks passed/.exec(collapsed[0]!)![1]);
    expect(n).toBeGreaterThan(0);
    expect(parseRows(plain).some((r) => r.level === "PASS")).toBe(false);

    const verbose = runDoctor(tmp, ["--verbose"]).stdout;
    expect(verbose).not.toMatch(/\d+ checks passed/);
    expect(parseRows(verbose).filter((r) => r.level === "PASS").length).toBe(n);
  });

  it("names at most three next actions, fails before warns, each quoting its check id", () => {
    fixtureAdoptedButBroken(tmp);
    const stdout = runDoctor(tmp).stdout;
    const block = /\nNext[^\n]*\n((?: {2}\d+\. [^\n]*\n)+)/.exec(stdout);
    expect(block, `no next-actions block in:\n${stdout}`).toBeTruthy();
    const items = block![1]!.trimEnd().split("\n");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
    const rows = parseRows(stdout);
    const quoted = items.map((l) => /\[([^\]]+)\]/.exec(l)![1]!);
    for (const id of quoted) expect(rows.some((r) => r.check === id && (r.level === "FAIL" || r.level === "WARN"))).toBe(true);
    // Severity order: once a warn has been named, no fail may follow it.
    const levels = quoted.map((id) => rows.find((r) => r.check === id)!.level);
    expect(levels.indexOf("FAIL") === -1 || levels.lastIndexOf("FAIL") < (levels.indexOf("WARN") === -1 ? levels.length : levels.indexOf("WARN"))).toBe(true);
    // The Next block sits ABOVE the Conformance summary line (the reader's eye lands on it last).
    expect(stdout.indexOf("\nNext")).toBeLessThan(stdout.indexOf("\nConformance:"));
  });

  it("prints NO next-actions block when there is nothing to act on", () => {
    // A spine that is clean and declares nothing optional: zero fails, zero warns.
    write(
      tmp,
      ".ai/manifest.yaml",
      [
        "schema: ai-manifest",
        "schemaVersion: 0.3.0",
        "paths:",
        "  contextIndex: .ai/context-index.json",
        "  memory: .ai/memory/",
        "capabilities:",
        '  lint: { command: "npm run lint", verified: false }',
        "controls:",
        "  prePush: []",
        "  ciHardPass: []",
        "",
      ].join("\n"),
    );
    write(tmp, ".ai/context-index.json", '{"modules":[]}\n');
    write(tmp, ".ai/memory/README.md", "notes\n");
    const { stdout, json, status } = runDoctor(tmp, ["--json"]);
    expect(json!.fails).toBe(0);
    expect(json!.warns).toBe(0);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/\nNext/);
  });

  it("prints unchecked findings under their own heading, with the reason intact and the summary shape unchanged", () => {
    fixtureUnadapted(tmp);
    const { stdout } = runDoctor(tmp);
    // GUARD (pre-existing contract): the summary line's shape and the skip marker.
    expect(stdout).toMatch(/\d+ unchecked over \d+ scored/);
    expect(stdout).toContain("[SKIP]");
    const skips = parseRows(stdout).filter((r) => r.level === "SKIP");
    expect(skips.length).toBeGreaterThanOrEqual(2);
    // The reason text survives verbatim - an unchecked finding whose reason is dropped is a silence.
    expect(skips.some((r) => /no guidance block in the manifest/.test(r.msg))).toBe(true);
    expect(skips.some((r) => /freshness NOT checked for \d+ generatedFrom file/.test(r.msg))).toBe(true);
    // The heading is above the rows it introduces.
    const headingAt = stdout.indexOf("[SKIP]");
    expect(headingAt).toBeGreaterThan(-1);
    expect(stdout.indexOf("  SKIP  ")).toBeGreaterThan(headingAt);
  });

  it("gives every id in the DECLARED vocabulary a non-empty fix hint (enumerated from check-ids.ts)", () => {
    // Coverage is enumerated from this repo's own declaration, so a new check id that ships without a
    // remediation hint fails here rather than reaching an adopter's terminal as a dead end.
    const seen = new Map<string, string>();
    const collect = (r: Run) => {
      for (const row of parseRows(r.stdout)) if (row.level !== "PASS") seen.set(row.check, row.fix);
    };

    collect(runDoctor(tmp)); // empty repo -> manifest.missing
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    fixtureUnadapted(tmp);
    collect(runDoctor(tmp));
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    fixtureStructurallyBroken(tmp);
    collect(runDoctor(tmp));
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    fixtureAdoptedButBroken(tmp);
    collect(runDoctor(tmp));
    // ...the same repo with an unparseable context index -> context.index
    write(tmp, ".ai/context-index.json", "{not json\n");
    collect(runDoctor(tmp));
    // ...and a --run against a read-only manifest -> capability.<n>.run + manifest.write-back
    write(
      tmp,
      ".ai/manifest.yaml",
      [
        "schema: ai-manifest",
        "schemaVersion: 0.3.0",
        "capabilities:",
        '  test: { command: "node -e \\"process.exit(1)\\"", verified: true }',
        "controls:",
        "  prePush: []",
        "  ciHardPass: []",
        "",
      ].join("\n"),
    );
    chmodSync(join(tmp, ".ai", "manifest.yaml"), 0o444);
    collect(runDoctor(tmp, ["--run"]));
    chmodSync(join(tmp, ".ai", "manifest.yaml"), 0o644);

    const missing: string[] = [];
    for (const id of STATIC_CHECK_IDS) {
      if (!seen.has(id)) missing.push(`${id} (never triggered by any fixture)`);
      else if (!seen.get(id)) missing.push(`${id} (triggered, NO fix hint)`);
    }
    for (const prefix of TEMPLATED_CHECK_PREFIXES) {
      const hits = [...seen.keys()].filter((k) => k.startsWith(prefix) && k.length > prefix.length);
      if (!hits.length) missing.push(`${prefix}<subject> (never triggered by any fixture)`);
      else if (!hits.some((k) => seen.get(k))) missing.push(`${prefix}<subject> (triggered, NO fix hint)`);
    }
    expect(missing, `vocabulary entries without a proven fix hint:\n${missing.join("\n")}`).toEqual([]);
  });

  // ── GUARDS: the machine contract. Green BEFORE this change by design. ──────────────────────────

  it("GUARD: the --json payload keys and values are unchanged, and no fix hint leaks into findings[]", () => {
    fixtureUnadapted(tmp);
    const { json } = runDoctor(tmp, ["--json"]);
    expect(Object.keys(json!).sort()).toEqual([
      "fails", "findings", "reportSkipped", "runShape", "score", "scored", "specVersion", "unchecked", "warns",
    ]);
    // The whole payload, byte-for-byte, for a deterministic fixture. Captured from the build BEFORE
    // the readout change: the remediation hints are a READOUT concern and must not reach the wire,
    // and no message may be reworded, because `findings[].msg` is published (spec v0.3.0).
    expect(JSON.stringify(json)).toBe(BASELINE_UNADAPTED_JSON);
    // Stated separately so the failure message is readable when a field is added.
    for (const f of json!.findings as Record<string, unknown>[]) {
      expect(Object.keys(f).sort()).toEqual(["check", "level", "msg"]);
    }
  });

  it("GUARD: the score is still the documented weighted ratio over the scorable findings", () => {
    fixtureUnadapted(tmp);
    const { json } = runDoctor(tmp, ["--json"]);
    const weight: Record<string, number> = { pass: 1, warn: 0.5, fail: 0 };
    const findings = json!.findings as { level: string }[];
    const scorable = findings.filter((f) => f.level !== "unchecked");
    expect(json!.score).toBe(Math.round((100 * scorable.reduce((a, f) => a + weight[f.level]!, 0)) / scorable.length));
    expect(json!.scored).toBe(scorable.length);
  });

  it("GUARD: the exit code is still fails > 0 ? 1 : 0, with and without --verbose", () => {
    // Failing fixture.
    fixtureStructurallyBroken(tmp);
    for (const args of [[], ["--verbose"], ["--json"], ["--json", "--verbose"]]) {
      const r = runDoctor(tmp, args);
      expect(r.status, `args=${args.join(" ")}`).toBe(1);
    }
    expect((runDoctor(tmp, ["--json"]).json!.fails as number)).toBeGreaterThan(0);
    // Passing fixture: warns alone never gate.
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    fixtureUnadapted(tmp);
    write(tmp, "lefthook.yml", "pre-push:\n  commands:\n    lint: { run: npm run lint }\n");
    for (const args of [[], ["--verbose"], ["--json"]]) {
      expect(runDoctor(tmp, args).status, `args=${args.join(" ")}`).toBe(0);
    }
  });
});

/** The `--json` line for `fixtureUnadapted`, captured from the build that preceded the readout
 *  change. Re-record it ONLY when the machine contract is deliberately versioned (and then say so in
 *  the spec's versioning policy); a diff here is otherwise a silent break of every adopter's CI. */
const BASELINE_UNADAPTED_JSON = "{\"score\":56,\"fails\":1,\"warns\":5,\"unchecked\":2,\"scored\":8,\"specVersion\":\"0.3.0\",\"runShape\":\"plain\",\"findings\":[{\"check\":\"structure\",\"level\":\"pass\",\"msg\":\"manifest schema ok (ai-manifest v0.3.0)\"},{\"check\":\"pointer.contextindex\",\"level\":\"warn\",\"msg\":\"missing context index .ai/context-index.json\"},{\"check\":\"pointer.memory\",\"level\":\"warn\",\"msg\":\"missing memory store\"},{\"check\":\"capability.declared\",\"level\":\"pass\",\"msg\":\"declares 1 capabilities: lint\"},{\"check\":\"control.prepush\",\"level\":\"fail\",\"msg\":\"prePush controls declared but NO local hook (lefthook/husky/pre-commit) - they only fire after push\"},{\"check\":\"control.prepush.scan-secrets.backing\",\"level\":\"warn\",\"msg\":\"pre-push control \\\"scan-secrets\\\" has no backing capability yet - an onboarding track should add it\"},{\"check\":\"control.ci\",\"level\":\"warn\",\"msg\":\"ciHardPass controls declared but no CI workflows found\"},{\"check\":\"freshness.unchecked\",\"level\":\"unchecked\",\"msg\":\"freshness NOT checked for 1 generatedFrom file(s) (no commit date available - shallow clone or no git history): package.json\"},{\"check\":\"guidance.unchecked\",\"level\":\"unchecked\",\"msg\":\"no guidance block in the manifest - projection drift NOT checked (declare guidance.canonical + projections to enable it)\"},{\"check\":\"manifest.todo\",\"level\":\"warn\",\"msg\":\"manifest still has TODO placeholders (purpose / secretsFrom / boundaries / agents)\"}],\"reportSkipped\":\"not reported to Ascent - set ASCENT_CONFORMANCE_URL + ASCENT_CONFORMANCE_TOKEN + GITHUB_REPOSITORY (e.g. in CI)\"}";
