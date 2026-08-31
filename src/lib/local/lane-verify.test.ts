// THE COMMAND-RESOLUTION CHAIN — that the guard runs what the REPOSITORY declares, in a stated order,
// and that a repository declaring nothing produces `null` rather than an invented command.
//
// The last case is the one with teeth. A guard that fell back to "npm test" on a repository that never
// asked for it would either fail on repos with no test script (rejecting honest work) or pass
// vacuously — and either way it would be Ascent's opinion masquerading as the repository's.

import { describe, expect, it } from "vitest";
import { asVerifyVerdict, firstFailureLines, resolveVerifyCommand, verifyVerdictTag } from "@/lib/local/lane-verify";

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
    expect(verifyVerdictTag("baseline-red")).toBe("baseline red");
  });
});

describe("firstFailureLines", () => {
  it("pulls the failure-shaped lines out of a long log", () => {
    const out = ["> vitest run", "ok 1", "ok 2", "FAIL src/a.test.ts > adds", "AssertionError: expected 1 to be 2", "ok 3"].join("\n");
    const note = firstFailureLines(out);
    expect(note).toContain("FAIL src/a.test.ts");
    expect(note).toContain("AssertionError");
    expect(note).not.toContain("ok 1");
  });

  it("falls back to the TAIL when nothing looks like a failure — never an empty note", () => {
    const note = firstFailureLines("aaa\nbbb\nccc");
    expect(note).toContain("ccc");
    expect(note.trim()).not.toBe("");
  });

  it("says so when a command produced no output at all", () => {
    expect(firstFailureLines("   \n\n")).toContain("no output");
  });
});
