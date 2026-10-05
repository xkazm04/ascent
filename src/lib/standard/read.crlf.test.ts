import { describe, expect, it } from "vitest";
import { readManifestYaml } from "./read";
import { resolveVerifyLadder } from "@/lib/local/lane-verify";

// Measured 2026-10-05: a Windows checkout (core.autocrlf) hands the reader CRLF, and every line-anchored
// pattern missed — a declared ciHardPass gate resolved to nothing from disk and to two rungs from git.
const LF = [
  "schema: ai-manifest",
  "schemaVersion: 0.1.0",
  "capabilities:",
  '  test: { command: "node --test tools/a.test.mjs", verified: false }',
  '  lint: { command: "node tools/lint.mjs", verified: false }',
  "controls:",
  "  ciHardPass: [lint, test]",
  "",
].join("\n");

describe("readManifestYaml reads CRLF exactly as LF", () => {
  it("the same capabilities and controls", () => {
    const crlf = LF.replace(/\n/g, "\r\n");
    expect(readManifestYaml(crlf)).toEqual(readManifestYaml(LF));
    expect(readManifestYaml(crlf).status).toBe("ok");
  });
  it("so the loop's guard resolves the declared gate from a Windows checkout", () => {
    const crlf = LF.replace(/\n/g, "\r\n");
    expect(resolveVerifyLadder({ manifestYaml: crlf }).length).toBeGreaterThan(0);
    expect(resolveVerifyLadder({ manifestYaml: crlf })).toEqual(resolveVerifyLadder({ manifestYaml: LF }));
  });
});
