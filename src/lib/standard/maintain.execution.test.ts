import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildMaintain } from "./maintain";

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
