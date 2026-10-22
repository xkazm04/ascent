// playbooks-1: openDraftPr's opt-in, digest-bound replace. The never-overwrite guard (write.test.ts)
// holds for every caller that does not pass `replaceIfBaseDigest`; with it, a base file is replaced
// ONLY when its fetched bytes hash to the digest Ascent itself landed, and the PUT carries that file's
// blob sha so a concurrent edit makes GitHub refuse the write.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { AppApiError } = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");

vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return { ...actual, githubAppFetch: vi.fn() };
});

import { openDraftPr } from "./write";
import { githubAppFetch } from "@/lib/github/app";
import { contentDigest } from "@/lib/registry/parse";

const mockFetch = vi.mocked(githubAppFetch);
const BASE = "main";
const BRANCH = "ascent/playbook-pb1-v3";
const PATH = "docs/playbooks/pb1-old-title.md";
const LANDED = "# Old title\n\nv1 body\n";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

let calls: { path: string; method: string; body: Record<string, unknown> | null }[];
const puts = () => calls.filter((c) => c.method === "PUT" && c.path.includes("/contents/"));

function router(state: { base?: { sha: string; content: string } | null; branch?: { sha: string; content: string } | null }) {
  mockFetch.mockImplementation(async (path: string, _t: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init.body ? JSON.parse(init.body as string) : null });
    if (method === "GET" && path.includes("/git/ref/heads/")) return { object: { sha: "base-sha" } } as never;
    if (method === "GET" && path.includes("/contents/")) {
      const ref = decodeURIComponent(path.split("?ref=")[1] ?? "");
      const file = ref === BASE ? state.base : (state.branch ?? state.base);
      if (!file) throw new AppApiError(404, path, "Not Found");
      return { sha: file.sha, content: b64(file.content), encoding: "base64" } as never;
    }
    if (method === "POST" && path.endsWith("/git/refs")) return {} as never;
    if (method === "PUT") return {} as never;
    if (method === "POST" && path.endsWith("/pulls")) return { html_url: "https://github.com/acme/app/pull/9", number: 9 } as never;
    throw new Error(`unrouted ${method} ${path}`);
  });
}

const input = (over: Record<string, unknown> = {}) => ({
  token: "t",
  owner: "acme",
  repo: "app",
  branch: BRANCH,
  base: BASE,
  path: PATH,
  content: "# New title\n\nv3 body\n",
  commitMessage: "update",
  prTitle: "Update playbook",
  prBody: "body",
  ...over,
});

beforeEach(() => {
  calls = [];
  mockFetch.mockReset();
});

describe("openDraftPr replaceIfBaseDigest", () => {
  it("replaces a base file whose bytes are exactly what Ascent landed: one PUT carrying its blob sha, one draft PR", async () => {
    router({ base: { sha: "blob-landed", content: LANDED } });
    const res = await openDraftPr(input({ replaceIfBaseDigest: contentDigest(LANDED) }));
    expect(res.number).toBe(9);
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.body).toMatchObject({ branch: BRANCH, sha: "blob-landed", content: b64("# New title\n\nv3 body\n") });
    const pr = calls.find((c) => c.method === "POST" && c.path.endsWith("/pulls"));
    expect(pr?.body).toMatchObject({ draft: true, base: BASE, head: BRANCH });
  });

  it("refuses a customer-edited base file (digest differs): 409 and ZERO PUTs", async () => {
    router({ base: { sha: "blob-edited", content: `${LANDED}\nOur own notes.\n` } });
    const err = await openDraftPr(input({ replaceIfBaseDigest: contentDigest(LANDED) })).catch((e) => e);
    expect(err).toBeInstanceOf(AppApiError);
    expect(err.status).toBe(409);
    expect(String(err.body)).toMatch(/changed since Ascent landed it/);
    expect(String(err.body)).not.toContain("—");
    expect(puts()).toHaveLength(0);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("without the option the base file is refused exactly as before (409, zero PUTs)", async () => {
    router({ base: { sha: "blob-landed", content: LANDED } });
    const err = await openDraftPr(input()).catch((e) => e);
    expect(err.status).toBe(409);
    expect(String(err.body)).toMatch(/refusing to overwrite it with a starter artifact/);
    expect(puts()).toHaveLength(0);
  });

  it("refuses when the landed file is gone from base (nothing to update; the removal is the user's)", async () => {
    router({ base: null });
    const err = await openDraftPr(input({ replaceIfBaseDigest: contentDigest(LANDED) })).catch((e) => e);
    expect(err.status).toBe(409);
    expect(puts()).toHaveLength(0);
  });

  it("a retry over its own branch skips the PUT; a branch carrying other bytes is refused", async () => {
    const next = "# New title\n\nv3 body\n";
    router({ base: { sha: "blob-landed", content: LANDED }, branch: { sha: "blob-ours", content: next } });
    await openDraftPr(input({ replaceIfBaseDigest: contentDigest(LANDED) }));
    expect(puts()).toHaveLength(0);

    calls = [];
    router({ base: { sha: "blob-landed", content: LANDED }, branch: { sha: "blob-other", content: "someone else" } });
    const err = await openDraftPr(input({ replaceIfBaseDigest: contentDigest(LANDED) })).catch((e) => e);
    expect(err.status).toBe(409);
    expect(puts()).toHaveLength(0);
  });
});
