// The scan credential's destination binding (src/lib/forge/scan-credential.ts): a GitHub credential
// never reaches a non-GitHub forge, and a caller's own credential for the forge it named still flows.

import { describe, it, expect, vi, afterEach } from "vitest";
import { ambientAllowedFor, bindScanToken, warnDroppedScanToken } from "./scan-credential";

afterEach(() => vi.restoreAllMocks());

describe("bindScanToken", () => {
  it("drops a GitHub installation token aimed at a GitLab scan, and does not fall back to the ambient one", () => {
    expect(bindScanToken({ forge: "gitlab", token: "ghs_install", tokenForge: "github", ambient: "ghp_env" })).toEqual({
      token: undefined,
      dropped: "forge-mismatch",
    });
  });

  it("an UNLABELLED token is a GitHub one (fail closed)", () => {
    expect(bindScanToken({ forge: "gitlab", token: "ghs_install" })).toEqual({ token: undefined, dropped: "forge-mismatch" });
    expect(bindScanToken({ forge: "local", token: "ghs_install" })).toEqual({ token: undefined, dropped: "forge-mismatch" });
  });

  it("never offers the ambient GITHUB_TOKEN to a GitLab scan, whatever noAmbientToken says", () => {
    expect(bindScanToken({ forge: "gitlab", token: undefined, noAmbientToken: false, ambient: "ghp_env" })).toEqual({ token: undefined });
    expect(bindScanToken({ forge: "gitlab", ambient: "ghp_env" })).toEqual({ token: undefined });
    expect(bindScanToken({ forge: "local", ambient: "ghp_env" })).toEqual({ token: undefined });
  });

  it("lets a caller's own GitLab credential flow to the GitLab coordinate it named", () => {
    expect(bindScanToken({ forge: "gitlab", token: "glpat_x", tokenForge: "gitlab" })).toEqual({ token: "glpat_x" });
  });

  it("keeps GitHub byte-identical: explicit token wins, else the ambient one unless refused", () => {
    expect(bindScanToken({ forge: "github", token: "ghs_install", ambient: "ghp_env" })).toEqual({ token: "ghs_install" });
    expect(bindScanToken({ forge: "github", ambient: "ghp_env" })).toEqual({ token: "ghp_env" });
    expect(bindScanToken({ forge: "github", noAmbientToken: true, ambient: "ghp_env" })).toEqual({ token: undefined });
    expect(bindScanToken({ forge: "github", ambient: undefined })).toEqual({ token: undefined });
    // `??` semantics kept: an explicit empty string is still the caller's token, not a fallback trigger.
    expect(bindScanToken({ forge: "github", token: "", ambient: "ghp_env" })).toEqual({ token: "" });
  });

  it("refuses a GitLab credential on a GitHub scan too (binding is symmetric)", () => {
    expect(bindScanToken({ forge: "github", token: "glpat_x", tokenForge: "gitlab", ambient: "ghp_env" })).toEqual({
      token: undefined,
      dropped: "forge-mismatch",
    });
  });
});

describe("ambientAllowedFor", () => {
  it("is GitHub only", () => {
    expect(ambientAllowedFor("github")).toBe(true);
    expect(ambientAllowedFor("gitlab")).toBe(false);
    expect(ambientAllowedFor("local")).toBe(false);
  });
});

describe("warnDroppedScanToken", () => {
  it("names both forges and never the token value, with no em dash", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnDroppedScanToken("gitlab", undefined);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("github");
    expect(line).toContain("gitlab");
    expect(line).not.toMatch(/gh[sp]_/);
    expect(line).not.toContain(String.fromCharCode(0x2014));
  });
});
