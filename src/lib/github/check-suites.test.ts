// fetchAppInventory is the only way Ascent can see the tooling a repo configures in SETTINGS rather
// than in files (default-setup CodeQL, Socket/Wiz, Codecov, the Claude/CodeRabbit review apps). Two
// invariants carry the whole enrichment and are pinned here:
//
//   1. A FAILED read is null — never an empty inventory. `apps: []` is consumed as a real "this repo
//      installs nothing", so fabricating it from a 403/404/garbled body would turn a token problem
//      into a confident negative on D2/D3/D4/D9 for exactly the locked-down repos most likely to 403.
//   2. The dedupe is deterministic. A busy commit carries several suites per App (re-runs, matrices,
//      superseded queued suites); a reported conclusion beats a null one and the fresher of two
//      reported ones wins, so the same commit always yields the same inventory.
//
// The host layer is REAL here (only global fetch is stubbed) so the assertions cover the actual URL
// the scanner puts on the wire — the ref encoding especially, since a collapsed `release/2.1` 404s.

import { afterEach, describe, expect, it, vi } from "vitest";
import { appsOf, classifyApp, fetchAppInventory, type AppInventory } from "./check-suites";

const API = "https://api.github.com";

/** Every request the stub saw, so the URL/headers actually put on the wire can be asserted. */
const calls: { url: string; init: RequestInit }[] = [];

/** Stub global fetch with one JSON (or raw-text) response. */
function stub(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }),
  );
}

const suite = (slug: string, conclusion: string | null, updated_at = "2026-08-17T10:00:00Z", name = slug) => ({
  app: { slug, name },
  conclusion,
  updated_at,
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("fetchAppInventory — parsing and dedupe", () => {
  it("returns the deduped inventory in API order with the scored sha lower-cased", async () => {
    stub(200, {
      total_count: 3,
      check_suites: [suite("github-actions", "success"), suite("Codecov", null), suite("claude", "success")],
    });
    const inv = await fetchAppInventory("sindresorhus", "got", "E3924AA1", "tok");
    expect(inv).toEqual<AppInventory>({
      sha: "e3924aa1",
      apps: [
        { slug: "github-actions", name: "github-actions", conclusion: "success" },
        { slug: "codecov", name: "Codecov", conclusion: null }, // slug folded, display name kept
        { slug: "claude", name: "claude", conclusion: "success" },
      ],
      total: 3,
      truncated: false,
    });
  });

  it("prefers a REPORTED conclusion over a still-null one for the same App", async () => {
    stub(200, {
      total_count: 2,
      check_suites: [suite("claude", null, "2026-08-17T12:00:00Z"), suite("CLAUDE", "success", "2026-08-17T09:00:00Z")],
    });
    const inv = await fetchAppInventory("o", "r", "abc", "tok");
    expect(inv!.apps).toHaveLength(1);
    expect(inv!.apps[0]).toMatchObject({ slug: "claude", conclusion: "success" });
  });

  it("keeps the LATEST of two reported conclusions, whichever order they arrive in", async () => {
    stub(200, {
      total_count: 2,
      check_suites: [suite("codecov", "success", "2026-08-17T09:00:00Z"), suite("codecov", "failure", "2026-08-17T11:00:00Z")],
    });
    expect((await fetchAppInventory("o", "r", "abc", "tok"))!.apps[0].conclusion).toBe("failure");

    stub(200, {
      total_count: 2,
      check_suites: [suite("codecov", "failure", "2026-08-17T11:00:00Z"), suite("codecov", "success", "2026-08-17T09:00:00Z")],
    });
    expect((await fetchAppInventory("o", "r", "abc", "tok"))!.apps[0].conclusion).toBe("failure");
  });

  it("skips suites with no app or no slug rather than inventing an entry", async () => {
    stub(200, {
      total_count: 4,
      check_suites: [{ conclusion: "success" }, { app: null }, { app: { slug: "  " } }, suite("vercel", "success")],
    });
    const inv = await fetchAppInventory("o", "r", "abc", "tok");
    expect(inv!.apps.map((a) => a.slug)).toEqual(["vercel"]);
    expect(inv!.total).toBe(4); // total_count is what GitHub reported, not what we could attribute
  });

  it("flags truncation when total_count exceeds the single 100-item page", async () => {
    stub(200, { total_count: 96, check_suites: [suite("github-actions", "success")] });
    expect((await fetchAppInventory("o", "r", "abc", "tok"))!.truncated).toBe(false);
    stub(200, { total_count: 240, check_suites: [suite("github-actions", "success")] });
    const inv = await fetchAppInventory("o", "r", "abc", "tok");
    expect(inv).toMatchObject({ total: 240, truncated: true });
  });

  it("falls back to the suite count when total_count is absent", async () => {
    stub(200, { check_suites: [suite("vercel", "success"), suite("sentry", null)] });
    expect(await fetchAppInventory("o", "r", "abc", "tok")).toMatchObject({ total: 2, truncated: false });
  });

  it("a 200 with zero suites is a REAL zero, not an unknown", async () => {
    stub(200, { total_count: 0, check_suites: [] });
    expect(await fetchAppInventory("o", "r", "abc", "tok")).toEqual({
      sha: "abc",
      apps: [],
      total: 0,
      truncated: false,
    });
  });
});

describe("fetchAppInventory — a failed read is never an empty inventory", () => {
  it.each([403, 404, 422, 500])("returns null on HTTP %i", async (status) => {
    stub(status, { message: "nope" });
    expect(await fetchAppInventory("o", "r", "abc", "tok")).toBeNull();
  });

  it("returns null when a 200 body is not the documented shape (proxy HTML / truncated stream)", async () => {
    stub(200, "<html>gateway</html>");
    expect(await fetchAppInventory("o", "r", "abc", "tok")).toBeNull();
    stub(200, { total_count: 3, check_suites: null });
    expect(await fetchAppInventory("o", "r", "abc", "tok")).toBeNull();
  });

  it("returns null (never throws) when the transport itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    await expect(fetchAppInventory("o", "r", "abc", "tok")).resolves.toBeNull();
  });

  it("returns null without a request when there is no ref to read", async () => {
    stub(200, { total_count: 0, check_suites: [] });
    expect(await fetchAppInventory("o", "r", "   ", "tok")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("fetchAppInventory — request construction", () => {
  it("asks for one full page of suites on the scored commit, with auth", async () => {
    stub(200, { total_count: 0, check_suites: [] });
    await fetchAppInventory("sindresorhus", "got", "e3924aa1", "tok");
    expect(calls[0].url).toBe(`${API}/repos/sindresorhus/got/commits/e3924aa1/check-suites?per_page=100`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  // A ref, not just a sha: the scan falls back to the pinned ref / default branch, and `release/2.1`
  // collapsed to `release%2F2.1` is a commitish GitHub does not have — the read 404s and the repo
  // silently loses its entire App inventory.
  it("preserves the slashes of a ref-shaped commitish and encodes within segments", async () => {
    stub(200, { total_count: 0, check_suites: [] });
    await fetchAppInventory("acme", "core", "release/2.1", "tok");
    await fetchAppInventory("acme", "core", "feat/a b", "tok");
    expect(calls[0].url).toContain("/commits/release/2.1/check-suites");
    expect(calls[0].url).not.toContain("%2F");
    expect(calls[1].url).toContain("/commits/feat/a%20b/check-suites");
  });
});

describe("classifyApp", () => {
  it("maps the known slugs to their category", () => {
    expect(classifyApp("github-actions")).toBe("actions");
    expect(classifyApp("github-code-scanning")).toBe("sast");
    expect(classifyApp("claude")).toBe("ai-review");
    expect(classifyApp("coderabbitai")).toBe("ai-review");
    expect(classifyApp("socket-security")).toBe("supply-chain");
    expect(classifyApp("codecov")).toBe("coverage");
    expect(classifyApp("azure-pipelines")).toBe("ci");
    expect(classifyApp("vercel")).toBe("deploy");
    expect(classifyApp("datadog-official")).toBe("observability");
  });

  // Live shape (vercel/next.js, 2026-08-17): Wiz posts per-installation slugs like `wiz-af7ed32ef9`.
  it("matches the hash-suffixed families by prefix", () => {
    expect(classifyApp("wiz-af7ed32ef9")).toBe("supply-chain");
    expect(classifyApp("wiz")).toBe("supply-chain");
    expect(classifyApp("snyk-io")).toBe("supply-chain");
    expect(classifyApp("codeql-action")).toBe("sast");
  });

  it("is case-insensitive and earns nothing for an unknown slug", () => {
    expect(classifyApp("Codecov")).toBe("coverage");
    expect(classifyApp("vercel-gh-bot-3")).toBe("other");
    expect(classifyApp("")).toBe("other");
  });
});

describe("appsOf", () => {
  const inv: AppInventory = {
    sha: "abc",
    apps: [
      { slug: "github-actions", name: "GitHub Actions", conclusion: "failure" },
      { slug: "claude", name: "Claude", conclusion: "success" },
      { slug: "wiz-af7ed32ef9", name: "Wiz", conclusion: null },
      { slug: "serval", name: "Serval", conclusion: null },
    ],
    total: 4,
    truncated: false,
  };

  it("filters to one category in API order", () => {
    expect(appsOf(inv, "supply-chain").map((a) => a.slug)).toEqual(["wiz-af7ed32ef9"]);
    expect(appsOf(inv, "other").map((a) => a.slug)).toEqual(["serval"]);
    expect(appsOf(inv, "coverage")).toEqual([]);
  });

  it("treats an unobservable inventory as an empty list for consumers", () => {
    expect(appsOf(null, "ai-review")).toEqual([]);
    expect(appsOf(undefined, "ai-review")).toEqual([]);
  });
});
