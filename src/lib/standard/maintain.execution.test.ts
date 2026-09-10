import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildMaintain } from "./maintain";
import { buildDoctor } from "./doctor";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ascent-maintain-execution-"));
  roots.push(root);
  mkdirSync(join(root, ".ai"));
  writeFileSync(join(root, ".ai/maintain.mjs"), buildMaintain().body);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error("Unexpected fixture parent");
    rmSync(root, { recursive: true, force: true });
  }
});
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [".ai/maintain.mjs", ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  });
}
function manifest(eol: string, first = false) {
  const block = [
    "guidance:",
    "  canonical: AGENTS.md",
    "  projections:",
    '    - { agent: claude, path: CLAUDE.md, generatedFrom: AGENTS.md, hash: "old" }',
  ];
  return [...(first ? [] : ["schema: ai-manifest"]), ...block, ""].join(eol);
}

describe("emitted maintain script: guidance projection", () => {
  it.each([
    ["LF", "\n", false], ["CRLF", "\r\n", false],
    ["first key LF", "\n", true], ["first key CRLF", "\r\n", true],
  ])("projects a %s manifest and is idempotent", (_name, eol, first) => {
    const root = fixture();
    const canonical = "# Instructions\r\n\r\nKeep the public API stable.\r\n";
    writeFileSync(join(root, "AGENTS.md"), canonical);
    writeFileSync(join(root, ".ai/manifest.yaml"), manifest(eol as string, first as boolean));
    const result = run(root, "project");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("[WROTE] CLAUDE.md");
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    const projected = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(projected).toContain(canonical);
    expect(projected).toMatch(/generated-from: AGENTS\.md sha256:[a-f0-9]{12}/);
    const updatedManifest = readFileSync(join(root, ".ai/manifest.yaml"), "utf8");
    const again = run(root, "project");
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("0 changed");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(projected);
    expect(readFileSync(join(root, ".ai/manifest.yaml"), "utf8")).toBe(updatedManifest);
  });
});

it("preserves agent-shaped extension rows outside guidance.projections", () => {
  const root = fixture();
  const foreign = '    - { agent: custom, path: FOREIGN.md, generatedFrom: other.md, hash: "human-owned" }';
  const before = ["extensionBefore:", "  agents:", foreign, ""].join("\n");
  const inside = ["  extension:", "    projections:", "  " + foreign, ""].join("\n");
  const after = ["extensionAfter:", "  agents:", foreign, ""].join("\n");
  writeFileSync(join(root, "AGENTS.md"), "# Canonical\n");
  writeFileSync(join(root, ".ai/manifest.yaml"), before + manifest("\n") + inside + after);
  const result = run(root, "project");
  expect(result.status, result.stderr).toBe(0);
  const updated = readFileSync(join(root, ".ai/manifest.yaml"), "utf8");
  expect(updated).toContain(before);
  expect(updated).toContain(inside);
  expect(updated).toContain(after);
  expect(updated).not.toContain('hash: "old"');
  expect(existsSync(join(root, "FOREIGN.md"))).toBe(false);
  expect(result.stdout).toContain("Projected 1 file(s)");
});


it.each(["\n", "\r\n"])("doctor judges the same first-key guidance projections with %j endings", (eol) => {
  const root = fixture();
  writeFileSync(join(root, "AGENTS.md"), "# Canonical\n");
  const extension = ["  extension:", "    projections:", '      - { agent: custom, path: FOREIGN.md, hash: "foreign" }', ""].join(eol);
  writeFileSync(join(root, ".ai/manifest.yaml"), manifest(eol, true) + extension);
  expect(run(root, "project").status).toBe(0);
  writeFileSync(join(root, ".ai/doctor.mjs"), buildDoctor().body);
  const result = spawnSync(process.execPath, [".ai/doctor.mjs", "--json"], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, ASCENT_CONFORMANCE_URL: "", ASCENT_CONFORMANCE_TOKEN: "", GITHUB_REPOSITORY: "" },
  });
  expect(result.error).toBeUndefined();
  const jsonLine = result.stdout.trim().split("\n").reverse().find((line) => line.startsWith("{"));
  expect(jsonLine, result.stdout + result.stderr).toBeTruthy();
  const findings = (JSON.parse(jsonLine!) as { findings: { check: string; level: string }[] }).findings;
  expect(findings).toContainEqual(expect.objectContaining({ check: "guidance.canonical", level: "pass" }));
  expect(findings).not.toContainEqual(expect.objectContaining({ check: "guidance.unchecked" }));
  expect(findings).not.toContainEqual(expect.objectContaining({ check: expect.stringContaining("foreign") }));
});


it("continues monotonic note IDs after the four-digit boundary", () => {
  const root = fixture();
  const memory = join(root, ".ai/memory");
  mkdirSync(memory);
  writeFileSync(join(memory, "9999-existing.md"), "existing fact\n");
  expect(run(root, "note", "decision", "first later fact").status).toBe(0);
  expect(run(root, "note", "decision", "second later fact").status).toBe(0);
  expect(readdirSync(memory).sort()).toEqual([
    "10000-first-later-fact.md", "10001-second-later-fact.md", "9999-existing.md",
  ]);
  expect(readFileSync(join(memory, "9999-existing.md"), "utf8")).toBe("existing fact\n");
  expect(readFileSync(join(memory, "10001-second-later-fact.md"), "utf8")).toContain("id: 10001\n");
});

function git(root: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

it.each(["{broken", "null", "[]", '{"modules":{}}'])("preserves an invalid existing context index %s", (original) => {
  const root = fixture();
  const index = join(root, ".ai/context-index.json");
  writeFileSync(index, original);
  for (const args of [["touch", "src"], ["check", "--strict"]]) {
    const result = run(root, ...args);
    expect(readFileSync(index, "utf8")).toBe(original);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot read .ai/context-index.json");
    expect(result.stdout).not.toContain("CONTEXT graph current");
  }
});

it("initializes missing indexes and preserves fields it does not own", () => {
  const root = fixture();
  const index = join(root, ".ai/context-index.json");
  expect(run(root, "touch", "src").status).toBe(0);
  const original = JSON.parse(readFileSync(index, "utf8"));
  original.extension = { owner: "another tool" };
  original.modules[0].extension = "preserve me";
  writeFileSync(index, JSON.stringify(original));
  expect(run(root, "touch", "src").status).toBe(0);
  expect(JSON.parse(readFileSync(index, "utf8"))).toEqual(original);
});

it.each([
  ["src/caf\u00e9", "worktree"], ["src/caf\u00e9", "pushed"],
  [" spaced", "worktree"], [" spaced", "pushed"],
])("checks changed files under %j in the %s range", (modulePath, mode) => {
  const root = fixture();
  mkdirSync(join(root, modulePath), { recursive: true });
  writeFileSync(join(root, modulePath, "file.ts"), "before\n");
  writeFileSync(join(root, modulePath, "CONTEXT.md"), "Original context\n");
  writeFileSync(join(root, ".ai/context-index.json"), JSON.stringify({ modules: [
    { id: "module", path: modulePath, context: `${modulePath}/CONTEXT.md` },
  ] }));
  git(root, "init", "--quiet");
  git(root, "config", "core.quotePath", "true");
  git(root, "add", ".");
  const commit = () => git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture");
  commit();
  const before = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, modulePath, "file.ts"), "after\n");
  if (mode === "pushed") { git(root, "add", "."); commit(); }
  const after = git(root, "rev-parse", "HEAD");
  const result = spawnSync(process.execPath, [".ai/maintain.mjs", "check", "--strict"], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    input: mode === "pushed" ? `refs/heads/main ${after} refs/heads/main ${before}\n` : "",
  });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout).toContain('CONTEXT may be stale for "module"');
});
