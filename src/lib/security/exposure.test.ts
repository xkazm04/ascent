import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCargoDeps, parsePnpmDeps } from "./exposure-lockfiles";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/github/host", () => ({
  githubRawBase: () => "https://raw.example",
  ghHeaders: () => ({}),
  fetchWithTimeout: h.fetch,
}));

import { fetchSecurityExposure } from "./exposure";

beforeEach(() => { h.fetch.mockReset(); });

describe("supported exposure lockfiles", () => {
  it("parses pnpm package keys and Cargo registry crates without local root packages", () => {
    expect(parsePnpmDeps("lockfileVersion: '9.0'\npackages:\n  '@acme/core@1.2.3':\n    resolution: {}\n  lodash@4.17.21:\n    resolution: {}\nsnapshots:\n  lodash@4.17.21:\n"))
      .toEqual([
        { name: "@acme/core", version: "1.2.3", ecosystem: "npm" },
        { name: "lodash", version: "4.17.21", ecosystem: "npm" },
      ]);
    expect(parseCargoDeps("[[package]]\nname = \"local\"\nversion = \"0.1.0\"\n\n[[package]]\nname = \"serde\"\nversion = \"1.0.210\"\nsource = \"registry+https://github.com/rust-lang/crates.io-index\"\n"))
      .toEqual([{ name: "serde", version: "1.0.210", ecosystem: "crates.io" }]);
  });

  it("queries OSV for Cargo crates and returns the reported severity", async () => {
    h.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("package-lock.json") || url.endsWith("pnpm-lock.yaml")) return new Response("", { status: 404 });
      if (url.endsWith("Cargo.lock")) return new Response("[[package]]\nname = \"serde\"\nversion = \"1.0.210\"\nsource = \"registry+https://github.com/rust-lang/crates.io-index\"\n");
      if (url.endsWith("querybatch")) return Response.json({ results: [{ vulns: [{ id: "RUSTSEC-1" }] }] });
      return Response.json({ database_specific: { severity: "CRITICAL" } });
    });
    const result = await fetchSecurityExposure("acme", "rust", "main");
    expect(result).toMatchObject({ known: true, scanned: 1, critical: 1 });
    const body = JSON.parse(h.fetch.mock.calls.find(([url]) => url.endsWith("querybatch"))![1].body);
    expect(body.queries).toEqual([{ package: { name: "serde", ecosystem: "crates.io" }, version: "1.0.210" }]);
  });

  it("keeps npm as the first lockfile and does not fetch alternatives when it has dependencies", async () => {
    h.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("package-lock.json")) return Response.json({ packages: { "node_modules/lodash": { version: "4.17.21" } } });
      if (url.endsWith("querybatch")) return Response.json({ results: [{}] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    expect(await fetchSecurityExposure("acme", "js", "main")).toMatchObject({ known: true, scanned: 1 });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});
