// THE COMMAND-RESOLUTION CHAIN — that the guard runs what the REPOSITORY declares, in a stated order,
// and that a repository declaring nothing produces `null` rather than an invented command.
//
// The last case is the one with teeth. A guard that fell back to "npm test" on a repository that never
// asked for it would either fail on repos with no test script (rejecting honest work) or pass
// vacuously — and either way it would be Ascent's opinion masquerading as the repository's.

import { describe, expect, it } from "vitest";
import {
  asVerifyVerdict,
  firstFailureLines,
  isCiShapedCommand,
  looksUnrunnable,
  resolveVerifyCommand,
  verifyVerdictTag,
} from "@/lib/local/lane-verify";

const manifest = (body: string) => `schema: ai-manifest\nschemaVersion: 0.1.0\n${body}`;

const CI_MANIFEST = manifest(
  [
    "capabilities:",
    '  typecheck: { command: "npm run typecheck", verified: true }',
    '  test: { command: "npm test", verified: true }',
    '  dev: { command: "npm run dev", verified: false }',
    "controls:",
    "  prePush: [typecheck]",
    "  ciHardPass: [typecheck, test]",
  ].join("\n"),
);

describe("the resolution order", () => {
  it("prefers the manifest's own ciHardPass over anything inferred from prose or scripts", () => {
    const r = resolveVerifyCommand({
      manifestYaml: CI_MANIFEST,
      guidance: [{ path: "CLAUDE.md", text: "Run `npm run lint` before committing." }],
      packageJson: JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    // Both wired capabilities, chained, in the manifest's declared order — this IS the repo's gate.
    expect(r?.command).toBe("npm run typecheck && npm test");
    expect(r?.source).toContain("ciHardPass");
  });

  it("falls back to prePush when nothing is wired at ciHardPass", () => {
    const yaml = manifest(
      ['capabilities:', '  check: { command: "make check", verified: true }', "controls:", "  prePush: [check]"].join("\n"),
    );
    const r = resolveVerifyCommand({ manifestYaml: yaml });
    expect(r?.command).toBe("make check");
    expect(r?.source).toContain("prePush");
  });

  it("REFUSES a redacted or placeholder command rather than running it", () => {
    // `readManifestYaml` replaces a secret-shaped run with «redacted», so what is left is not a
    // command anybody declared. A `<placeholder>` is the same: a template, not an instruction.
    const yaml = manifest(
      [
        "capabilities:",
        '  leaky: { command: "TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa npm test", verified: true }',
        '  templated: { command: "npm run <your-check>", verified: true }',
        "controls:",
        "  ciHardPass: [leaky, templated]",
      ].join("\n"),
    );
    const r = resolveVerifyCommand({ manifestYaml: yaml });
    expect(r?.command ?? "").not.toContain("«redacted»");
    expect(r?.command ?? "").not.toContain("<your-check>");
  });

  it("reads the guidance files next, with the SAME extraction the commands_agree facet uses", () => {
    const r = resolveVerifyCommand({
      guidance: [
        { path: "CLAUDE.md", text: "## Commands\n\nRun `npm run test:unit` for the suite.\n" },
        { path: "AGENTS.md", text: "Use `npm run build`." },
      ],
      packageJson: JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    expect(r?.command).toBe("npm run test:unit");
    expect(r?.source).toBe("CLAUDE.md (test)");
  });

  // ── CI-SHAPED FIRST, below the manifest ─────────────────────────────────────────────
  //
  // The guard runs in a worktree: tracked files plus linked dependency caches, and none of the
  // operator's gitignored local state. A command CI runs works from a clean checkout by construction;
  // a bare `test` script very often does not. Preferring `test` is exactly how `xkazm04/systedo-case`
  // landed on `npm run test:unit` — 3744/3744 green in the paired checkout, 8 failing in a worktree on
  // missing Google application-default credentials.

  it("prefers a CI-SHAPED command over a bare `test` quoted in the same guidance file", () => {
    const r = resolveVerifyCommand({
      guidance: [{ path: "AGENTS.md", text: "Run `npm run test:unit` for the suite; CI runs `npm run check:ci`." }],
    });
    expect(r?.command).toBe("npm run check:ci");
    expect(r?.source).toBe("AGENTS.md (ci)");
  });

  it("prefers a CI-shaped SCRIPT over a bare `test` quoted in a guidance file", () => {
    // Not layered by source: the question is "what runs from a clean checkout", and the script's name
    // is the only evidence either file carries about that.
    const r = resolveVerifyCommand({
      guidance: [{ path: "AGENTS.md", text: "Run `npm run test:unit` before pushing." }],
      packageJson: JSON.stringify({ scripts: { "check:ci": "tsc && vitest run", "test:unit": "vitest run" } }),
    });
    expect(r?.command).toBe("npm run check:ci");
    expect(r?.source).toBe("package.json (scripts.check:ci)");
  });

  it("ranks the CI-shaped names: check:ci > ci > verify > check", () => {
    const pick = (scripts: Record<string, string>) => resolveVerifyCommand({ packageJson: JSON.stringify({ scripts }) })?.command;
    expect(pick({ ci: "make ci", "check:ci": "npm run check", check: "tsc", verify: "x", test: "vitest" })).toBe("npm run check:ci");
    expect(pick({ ci: "make ci", check: "tsc", verify: "x", test: "vitest" })).toBe("npm run ci");
    expect(pick({ check: "tsc", verify: "x", test: "vitest" })).toBe("npm run verify");
    expect(pick({ check: "tsc", test: "vitest" })).toBe("npm run check");
    expect(isCiShapedCommand("npm run check:ci")).toBe(true);
    expect(isCiShapedCommand("make ci")).toBe(true);
    expect(isCiShapedCommand("npm run test:unit")).toBe(false);
    expect(isCiShapedCommand("pytest -q")).toBe(false);
  });

  it("still puts the MANIFEST first — a declared ciHardPass outranks any CI-shaped script", () => {
    const r = resolveVerifyCommand({
      manifestYaml: CI_MANIFEST,
      guidance: [{ path: "AGENTS.md", text: "CI runs `npm run check:ci`." }],
      packageJson: JSON.stringify({ scripts: { "check:ci": "everything" } }),
    });
    expect(r?.command).toBe("npm run typecheck && npm test");
    expect(r?.source).toContain("ciHardPass");
  });

  it("prefers a test command over a lint one inside the same guidance file", () => {
    const r = resolveVerifyCommand({
      guidance: [{ path: "AGENTS.md", text: "Lint with `npm run lint`, then run `npm run test` before pushing." }],
    });
    expect(r?.command).toBe("npm run test");
  });

  it("falls back to package.json scripts, composite names first", () => {
    const r = resolveVerifyCommand({
      packageJson: JSON.stringify({ scripts: { test: "vitest run", "check:ci": "tsc && vitest run" } }),
    });
    // A repo with both means the composite when it says "the checks" — running only its unit tests
    // would be a weaker guard than the one it already wrote for itself.
    expect(r?.command).toBe("npm run check:ci");
  });

  it("uses `npm test` (not `npm run test`) for the conventional test script", () => {
    expect(resolveVerifyCommand({ packageJson: JSON.stringify({ scripts: { test: "vitest run" } }) })?.command).toBe("npm test");
  });

  it("resolves NOTHING when the repository declares nothing — no invented fallback", () => {
    expect(resolveVerifyCommand({})).toBeNull();
    expect(resolveVerifyCommand({ manifestYaml: "", guidance: [], packageJson: "" })).toBeNull();
    expect(resolveVerifyCommand({ packageJson: JSON.stringify({ name: "x", scripts: {} }) })).toBeNull();
    expect(resolveVerifyCommand({ packageJson: JSON.stringify({ scripts: { dev: "next dev" } }) })).toBeNull();
  });

  it("falls THROUGH a broken declaration instead of failing on it", () => {
    // A malformed manifest is not evidence that no check exists.
    const r = resolveVerifyCommand({
      manifestYaml: "this: is: not: a: manifest",
      packageJson: "{ not json",
      guidance: [{ path: "CLAUDE.md", text: "Run `npm run check` first." }],
    });
    expect(r?.command).toBe("npm run check");
  });
});

describe("the verdict vocabulary", () => {
  it("floors an unreadable column to null — which is NOT `skipped`", () => {
    // "we do not know" and "we looked and there was nothing to run" are different facts; a lane
    // written before the guard has the first and must never render as the second.
    expect(asVerifyVerdict(null)).toBeNull();
    expect(asVerifyVerdict("passed")).toBeNull();
    expect(asVerifyVerdict("skipped")).toBe("skipped");
    expect(verifyVerdictTag(null)).toBeNull();
    expect(verifyVerdictTag("skipped")).toBe("unverified");
  });

  it("parses the LEGACY word into the corrected one — widen the reader, never rewrite the column", () => {
    // Every lane run before 2026-08-31 carries `baseline-red`, a name that asserted something the
    // measurement never supported. The word still parses; what it means is now stated correctly.
    expect(asVerifyVerdict("baseline-red")).toBe("baseline-unavailable");
    expect(asVerifyVerdict("baseline-unavailable")).toBe("baseline-unavailable");
  });

  it("tags it `no baseline` — the badge must not read as a claim about the repository", () => {
    expect(verifyVerdictTag("baseline-unavailable")).toBe("no baseline");
    expect(verifyVerdictTag("baseline-red")).toBe("no baseline");
    expect(verifyVerdictTag("baseline-unavailable")).not.toContain("red");
  });
});

describe("firstFailureLines", () => {
  it("starts at the runner's failure marker and runs FORWARD into the assertion's detail", () => {
    const out = ["> vitest run", "ok 1", "ok 2", "FAIL src/a.test.ts > adds", "AssertionError: expected 1 to be 2", "ok 3"].join("\n");
    const note = firstFailureLines(out);
    expect(note).toContain("FAIL src/a.test.ts");
    expect(note).toContain("AssertionError");
    expect(note).not.toContain("ok 1");
  });

  // ── THE EXCERPT THAT SENT THE LOOP AFTER THE WRONG THING ───────────────────────────────
  //
  // The captured "First failure" for `xkazm04/systedo-case` was console noise printed by PASSING
  // tests — `[activity] list failed … fake firestore: unavailable`, each followed by a ✔ — because
  // the old rule scanned from the HEAD for any line containing "fail" or "error". Application logging
  // says those words constantly and says them first; a runner states its verdict at the END.
  it("skips leading console noise from PASSING tests and picks the failing assertion", () => {
    const out = [
      "[activity] list failed: fake firestore: unavailable",
      "✔ activity list degrades to empty",
      "[billing] error: fake stripe: unavailable",
      "✔ billing degrades",
      "✖ auth loads default credentials",
      "  Error: Could not load the default credentials",
      "  at GoogleAuth.getApplicationDefaultAsync",
    ].join("\n");
    const note = firstFailureLines(out);
    expect(note).toContain("✖ auth loads default credentials");
    expect(note).toContain("Could not load the default credentials");
    expect(note).not.toContain("[activity] list failed");
    expect(note).not.toContain("[billing] error");
  });

  it("recognises the markers the common runners print", () => {
    for (const marker of ["not ok 3 - adds", "✖ adds", "Failed Tests 8", "2 failing", "# fail 8", "error TS2345: nope"]) {
      const note = firstFailureLines(["[app] error: noise", "ok", marker, "detail"].join("\n"));
      expect(note.startsWith(marker)).toBe(true);
    }
  });

  it("falls back to the TAIL when no marker is present — a runner puts its verdict at the end", () => {
    const note = firstFailureLines(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
    expect(note).toContain("line 19");
    expect(note).not.toContain("line 0");
    expect(note.trim()).not.toBe("");
  });

  it("says so when a command produced no output at all", () => {
    expect(firstFailureLines("   \n\n")).toContain("no output");
  });
});

describe("looksUnrunnable", () => {
  // A worktree arrives with the paired checkout's dependency caches linked in (`worktree-deps.ts`),
  // but never with the operator's gitignored local state. Neither reading of a failure is a claim
  // about the repository; this discriminator only decides WHICH sentence the note gets — "could not
  // start at all" is more specific than "did not pass here", and specificity is worth a branch.
  it("recognises a command that could not START, across ecosystems", () => {
    for (const out of [
      "Error: Cannot find module 'vitest'",
      "code: 'ERR_MODULE_NOT_FOUND'",
      "'vitest' is not recognized as an internal or external command",
      "sh: 1: vitest: command not found",
      "npm error Missing script: \"test:unit\"",
      "npm error could not determine executable to run",
      "ModuleNotFoundError: No module named 'pytest'",
      "spawn ENOENT",
    ]) {
      expect(looksUnrunnable(out)).toBe(true);
    }
  });

  it("does NOT mistake an ordinary test failure for a missing dependency tree", () => {
    expect(looksUnrunnable("FAIL src/a.test.ts > adds\nAssertionError: expected 1 to be 2")).toBe(false);
    expect(looksUnrunnable("error TS2345: Argument of type 'string' is not assignable")).toBe(false);
    expect(looksUnrunnable("2 failed | 40 passed")).toBe(false);
  });
});
