// THE GUARD VOIDS WEAKENING, NOT ADDING — the status-aware half (2026-10-05).
//
// A lane that creates the first test, the first workflow or better guidance on a repo with none must be
// credited; a lane that edits, deletes or moves an existing check must be void exactly as before. Each
// strict fallback is pinned too: a refinement that loosened one would read as a clean lane.

import { describe, expect, it } from "vitest";
import { checkGateDiff, parseNameStatus, type LadderRung } from "@/lib/local/lane-gate-diff";

const NEW_TEST = 'import { it, expect } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n';
const A = (path: string) => ({ path, status: "A" });
const M = (path: string) => ({ path, status: "M" });
const D = (path: string) => ({ path, status: "D" });
const ladder = (...commands: string[]): LadderRung[] => commands.map((command) => ({ command, rung: "primary" as const }));

describe("ADDED files", () => {
  it("a lane adding a new test and a new CI workflow on a repo with neither is NOT void", () => {
    const v = checkGateDiff([A("src/app.ts"), A("src/app.test.ts"), A(".github/workflows/ci.yml")], {
      addedText: { "src/app.test.ts": NEW_TEST },
    });
    expect(v).toEqual({ void: false, reason: null, paths: [] });
  });

  it("an added test whose text was NOT read cannot be cleared", () => {
    const v = checkGateDiff([A("src/app.test.ts")]);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("not read");
  });

  it.each([
    ["internal/engine/main_test.go", "package engine\nfunc TestMain(m *testing.M) { os.Exit(0) }\n"],
    ["tests/test_boot.py", "import os\nos._exit(0)\n"],
    ["tests/test_cli.py", "import pytest\npytest.exit('done', returncode=0)\n"],
    ["src/boot.test.ts", "process.exit(0);\n"],
  ])("an added test that can END THE RUN is void: %s", (path, text) => {
    const v = checkGateDiff([A(path)], { addedText: { [path]: text } });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("end the test run early");
  });

  it("an added gate config in a test directory is not cleared as a test (conftest, playwright config)", () => {
    for (const path of ["tests/conftest.py", "e2e/playwright.config.ts"]) {
      expect(checkGateDiff([A(path)], { addedText: { [path]: "x = 1\n" } }).void, path).toBe(true);
    }
  });

  it("an added vitest.config.ts still voids — a new config can narrow what an existing check includes", () => {
    const v = checkGateDiff([A("vitest.config.ts")]);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("gate-config, added");
  });

  it("an added fixture still voids — it can change what an existing snapshot loads", () => {
    expect(checkGateDiff([A("src/__fixtures__/new.json")]).void).toBe(true);
  });

  it("an added package.json where none existed voids — it can CREATE the command", () => {
    const v = checkGateDiff([A("package.json")], { verifyLadder: { before: [], after: [] } });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("verify-command, added");
  });
});

describe("MODIFIED and DELETED files void exactly as before", () => {
  it.each([
    [M("src/app.test.ts"), "test-file, modified"],
    [D("src/app.test.ts"), "test-file, deleted"],
    [M(".github/workflows/ci.yml"), "gate-config, modified"],
    [M("src/__fixtures__/a.json"), "fixture, modified"],
    [M("package.json"), "verify-command, modified"],
  ])("%o -> void (%s)", (change, label) => {
    const v = checkGateDiff([change], { addedText: { [change.path]: NEW_TEST }, verifyLadder: { before: [], after: [] } });
    expect(v.void).toBe(true);
    expect(v.reason).toContain(label);
    expect(v.paths).toEqual([change.path]);
  });

  it("a renamed test (read --no-renames: delete + add) is void through its delete", () => {
    const v = checkGateDiff([D("src/old.test.ts"), A("src/new.test.ts")], { addedText: { "src/new.test.ts": NEW_TEST } });
    expect(v.void).toBe(true);
    expect(v.paths).toEqual(["src/old.test.ts"]);
  });

  it("statuses may ride in opts beside bare names, keyed as the names are passed", () => {
    const opts = { statuses: { "src/a.test.ts": "A" }, addedText: { "src/a.test.ts": NEW_TEST } };
    expect(checkGateDiff(["src/a.test.ts"], opts).void).toBe(false);
    expect(checkGateDiff(["src/a.test.ts", "src/b.test.ts"], opts).paths).toEqual(["src/b.test.ts"]);
  });

  it("a path git gave a status for is judged even when the name list missed it (a rename's source)", () => {
    // `--name-only` with rename detection on lists only the destination; the deletion must still void.
    const opts = { statuses: { "src/old.test.ts": "D", "src/new.test.ts": "A" }, addedText: { "src/new.test.ts": NEW_TEST } };
    const v = checkGateDiff(["src/new.test.ts"], opts);
    expect(v.void).toBe(true);
    expect(v.paths).toEqual(["src/old.test.ts"]);
  });

  it("bare names with no statuses are the strict guard — an added test reads as a change", () => {
    const v = checkGateDiff(["src/app.test.ts", ".github/workflows/ci.yml"]);
    expect(v.void).toBe(true);
    expect(v.paths).toEqual(["src/app.test.ts", ".github/workflows/ci.yml"]);
  });
});

describe("GUIDANCE declarations void only when the resolved verify command changed", () => {
  it("a CLAUDE.md edit that leaves the ladder unchanged is NOT void", () => {
    const v = checkGateDiff([M("CLAUDE.md")], { verifyLadder: { before: ladder("npm test"), after: ladder("npm test") } });
    expect(v.void).toBe(false);
  });

  it("a CLAUDE.md edit that changes the declared test command is void, naming old -> new", () => {
    const v = checkGateDiff([M("CLAUDE.md")], {
      verifyLadder: { before: ladder("npm test"), after: ladder("npm run test:smoke") },
    });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("`npm test` -> `npm run test:smoke`");
  });

  it("an .ai/manifest.yaml wiring a ciHardPass where none resolved is void", () => {
    const v = checkGateDiff([A(".ai/manifest.yaml")], { verifyLadder: { before: [], after: ladder("npm test") } });
    expect(v.void).toBe(true);
    expect(v.reason).toContain("(none resolved) -> `npm test`");
  });

  it("a guidance edit whose ladder could not be compared is void (strict)", () => {
    const v = checkGateDiff([M("AGENTS.md")]);
    expect(v.void).toBe(true);
    expect(v.reason).toContain("could not be compared");
  });
});

describe("parseNameStatus", () => {
  it("reads a -z stream into a status per path", () => {
    expect(parseNameStatus("A\0src/a.test.ts\0M\0CLAUDE.md\0D\0old.ts\0")).toEqual({
      "src/a.test.ts": "A",
      "CLAUDE.md": "M",
      "old.ts": "D",
    });
  });

  it("gives both sides of a rename the strict letter, if renames were left on", () => {
    expect(parseNameStatus("R100\0a.test.ts\0b.test.ts\0")).toEqual({ "a.test.ts": "M", "b.test.ts": "M" });
  });

  it("is all-or-nothing: a stream that is not name-status yields nothing, never a half-trusted map", () => {
    expect(parseNameStatus("src/app.ts\nsrc/app.test.ts")).toEqual({});
    expect(parseNameStatus("A\0ok.ts\0README.md\0")).toEqual({});
    expect(parseNameStatus("")).toEqual({});
  });
});

describe("fixture directories: documentation and generator scripts (2026-10-05)", () => {
  it("a modified fixtures/README.md is not a scoring surface", () => {
    expect(checkGateDiff([{ path: "fixtures/README.md", status: "M" }]).void).toBe(false);
  });
  it("an ADDED shell generator in a fixture dir is cleared; an added data file or a mock module still voids", () => {
    expect(checkGateDiff([{ path: "fixtures/make-clip.sh", status: "A" }]).void).toBe(false);
    expect(checkGateDiff([{ path: "fixtures/clip-03.json", status: "A" }]).void).toBe(true);
    expect(checkGateDiff([{ path: "__mocks__/make.sh", status: "A" }]).void).toBe(true);
    expect(checkGateDiff([{ path: "fixtures/gen.py", status: "A" }]).void).toBe(true);
  });
  it("a MODIFIED generator script in a fixture dir still voids", () => {
    expect(checkGateDiff([{ path: "fixtures/make-clip.sh", status: "M" }]).void).toBe(true);
  });
});

describe("an added test under a gate-script-shaped path (2026-10-05)", () => {
  it("tools/check-action-pins.test.mjs is a test by its own name — cleared when its text cannot end the run", () => {
    const v = checkGateDiff([{ path: "tools/check-action-pins.test.mjs", status: "A" }], {
      addedText: { "tools/check-action-pins.test.mjs": "import { test } from 'node:test';\ntest('pins', () => {});\n" },
    });
    expect(v.void).toBe(false);
  });
  it("tools/check-changelog-test.cjs (a `-test` suffix, no exit) is a test by its own name too", () => {
    const v = checkGateDiff([{ path: "tools/check-changelog-test.cjs", status: "A" }], {
      addedText: { "tools/check-changelog-test.cjs": "const assert = require('node:assert');\nassert.ok(true);\n" },
    });
    expect(v.void).toBe(false);
  });
  it("a bare scripts/test.mjs (which may BE the verify script) stays excluded", () => {
    const v = checkGateDiff([{ path: "scripts/test.mjs", status: "A" }], { addedText: { "scripts/test.mjs": "x();\n" } });
    expect(v.void).toBe(true);
  });
});

describe("an ADDED gate config no rung of the ladder can read (2026-10-05)", () => {
  const ladder = (cmd: string) => ({ before: [{ command: cmd, source: "x", rung: "primary" as const }], after: [{ command: cmd, source: "x", rung: "primary" as const }] });
  it("eslint.config.mjs + ruff.toml on a `dotnet test` gate are cleared — the repo's first linters", () => {
    const v = checkGateDiff([{ path: "eslint.config.mjs", status: "A" }, { path: "ruff.toml", status: "A" }], { verifyLadder: ladder("dotnet test shared/core-dotnet") });
    expect(v.void).toBe(false);
  });
  it("the same eslint config on an `npm test` gate still voids — a reader of it runs", () => {
    expect(checkGateDiff([{ path: "eslint.config.mjs", status: "A" }], { verifyLadder: ladder("npm test") }).void).toBe(true);
  });
  it("ruff.toml on a `pytest -q` gate still voids, and any added config with no ladder evidence voids", () => {
    expect(checkGateDiff([{ path: "ruff.toml", status: "A" }], { verifyLadder: ladder("pytest -q") }).void).toBe(true);
    expect(checkGateDiff([{ path: "eslint.config.mjs", status: "A" }]).void).toBe(true);
  });
  it("a MODIFIED config on an unrelated gate still voids", () => {
    expect(checkGateDiff([{ path: "eslint.config.mjs", status: "M" }], { verifyLadder: ladder("dotnet test x") }).void).toBe(true);
  });
});
