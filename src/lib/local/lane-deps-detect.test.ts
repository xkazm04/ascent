// The dependency lane's pure rules, as tables: which changed paths trigger an install, which manager a
// repository gets, the exact argv each is run with (scripts OFF — the property the operator approved
// the loosening on), and the line of a failed install that reaches the lane note.

import { describe, expect, it } from "vitest";
import { changedJsManifests, commandLine, firstMeaningfulLine, installCommand, managerFor, yarnMajor } from "./lane-deps-detect";

describe("changedJsManifests — the detection table", () => {
  it.each([
    [["package.json"], ["package.json"]],
    [["package-lock.json", "src/a.ts"], ["package-lock.json"]],
    [["npm-shrinkwrap.json"], ["npm-shrinkwrap.json"]],
    [["pnpm-lock.yaml"], ["pnpm-lock.yaml"]],
    [["yarn.lock"], ["yarn.lock"]],
    // any depth — a workspace package's manifest counts
    [["packages/web/package.json"], ["packages/web/package.json"]],
    [["apps\\api\\package.json"], ["apps/api/package.json"]],
    // never under node_modules — that is installed state, not a declaration
    [["node_modules/left-pad/package.json"], []],
    [["packages/web/node_modules/x/package.json"], []],
    // other ecosystems are not v1's business
    [["requirements.txt", "go.mod", "go.sum", "Cargo.toml", "Cargo.lock", "pyproject.toml", "Gemfile.lock"], []],
    // names that merely resemble a manifest
    [["package.json.bak", "my-package.json", "docs/package-lock.md"], []],
    [[], []],
  ])("%j → %j", (paths, expected) => {
    expect(changedJsManifests(paths)).toEqual(expected);
  });

  it("de-duplicates and sorts", () => {
    expect(changedJsManifests(["package.json", "./package.json", "a/package.json", ""])).toEqual(["a/package.json", "package.json"]);
  });
});

describe("managerFor — the root lockfile decides", () => {
  it.each([
    [["package.json", "package-lock.json"], "npm"],
    [["package.json", "npm-shrinkwrap.json"], "npm"],
    [["package.json", "pnpm-lock.yaml"], "pnpm"],
    [["package.json", "yarn.lock"], "yarn"],
    [["package.json"], "npm"],
    [["package.json", "package-lock.json", "yarn.lock"], "npm"],
  ] as const)("%j → %s", (files, manager) => {
    expect(managerFor(new Set(files))).toBe(manager);
  });
});

describe("installCommand — scripts are off for every manager", () => {
  it("npm: install (never ci), --ignore-scripts, no audit, no fund", () => {
    const cmd = installCommand("npm");
    expect(commandLine(cmd)).toBe("npm install --ignore-scripts --no-audit --no-fund");
    expect(cmd.args).not.toContain("ci");
    expect(cmd.env.npm_config_ignore_scripts).toBe("true");
  });

  it("pnpm: --ignore-scripts, and never a frozen lockfile even when CI is set", () => {
    expect(commandLine(installCommand("pnpm"))).toBe("pnpm install --ignore-scripts --no-frozen-lockfile");
  });

  it("yarn classic vs berry, by the major version the worktree's own yarn reports", () => {
    expect(commandLine(installCommand("yarn", 1))).toBe("yarn install --ignore-scripts --non-interactive");
    const berry = installCommand("yarn", 4);
    expect(commandLine(berry)).toBe("yarn install --mode=skip-build --no-immutable");
    expect(berry.env).toEqual({ YARN_ENABLE_SCRIPTS: "false", YARN_ENABLE_IMMUTABLE_INSTALLS: "false" });
  });

  it("reads yarn's major version", () => {
    expect(yarnMajor("1.22.22\n")).toBe(1);
    expect(yarnMajor("4.5.1")).toBe(4);
    expect(yarnMajor("command not found")).toBeNull();
  });
});

describe("firstMeaningfulLine", () => {
  it("skips a bare code label and quotes the line that says what went wrong", () => {
    const out = [
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/lefft-pad - Not found",
      "npm error 404 'lefft-pad@^1.0.0' is not in this registry.",
    ].join("\n");
    expect(firstMeaningfulLine(out)).toBe("npm error 404 Not Found - GET https://registry.npmjs.org/lefft-pad - Not found");
  });

  it("names a missing binary on Windows, strips colour, and falls back to the first line", () => {
    expect(firstMeaningfulLine("'pnpm' is not recognized as an internal or external command,\r\noperable program")).toMatch(/^'pnpm' is not recognized/);
    expect(firstMeaningfulLine("\u001b[31mERR_PNPM_FETCH_404\u001b[39m GET failed")).toBe("ERR_PNPM_FETCH_404 GET failed");
    expect(firstMeaningfulLine("something odd happened")).toBe("something odd happened");
    expect(firstMeaningfulLine("\n\n")).toBeNull();
  });
});
