// createCheckRun must survive a transient GitHub blip: the Check Run IS the required merge status, and a
// single un-retried POST left it permanently pending (ci-gate-status-checks #3) — blocking the PR forever
// with no status and no retry (we always 2xx, so GitHub never redelivers). Pins the bounded backoff (retry
// 429/5xx/network, NOT the terminal 401/403/404/422), the honor-Retry-After path, and the LOUD rethrow on
// exhaustion/terminal — so the caller's neutral-check + delivery-release fallback still fires.
//
// We mock githubAppFetch but keep the REAL AppApiError so the `instanceof AppApiError` status branching in
// checks.ts fires. Fake timers keep the backoff waits instant.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { AppApiError } = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");

vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return { ...actual, githubAppFetch: vi.fn() }; // keep the real AppApiError
});

import { createCheckRun, upsertStickyComment } from "./checks";
import { githubAppFetch } from "@/lib/github/app";

const mockFetch = vi.mocked(githubAppFetch);

const input = () => ({
  token: "t",
  owner: "acme",
  repo: "app",
  headSha: "abc",
  conclusion: "success" as const,
  title: "Gate",
  summary: "ok",
});

const ok = { html_url: "https://github.com/acme/app/runs/1", id: 1 };

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createCheckRun — bounded retry", () => {
  it.each([
    ["502 server error", new AppApiError(502, "/x", "bad gateway")],
    ["429 rate limit", new AppApiError(429, "/x", "rate limited")],
    ["network error (TypeError)", new TypeError("fetch failed")],
  ])("retries a transient %s then succeeds", async (_label, err) => {
    mockFetch.mockRejectedValueOnce(err).mockResolvedValueOnce(ok);
    const p = createCheckRun(input());
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ url: ok.html_url, id: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_ATTEMPTS on a persistent 5xx and rethrows (loud, not swallowed)", async () => {
    mockFetch.mockRejectedValue(new AppApiError(503, "/x", "unavailable"));
    const p = createCheckRun(input());
    const assertion = expect(p).rejects.toMatchObject({ status: 503 }); // attach handler before flushing timers
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it.each([
    ["401 bad token", 401],
    ["403 permission", 403],
    ["404 gone repo", 404],
    ["422 rejected payload", 422],
  ])("does NOT retry a terminal %s — throws on the first attempt", async (_label, status) => {
    mockFetch.mockRejectedValue(new AppApiError(status, "/x", "terminal"));
    await expect(createCheckRun(input())).rejects.toMatchObject({ status });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After (retryAfterSec) over the default backoff", async () => {
    const err = Object.assign(new AppApiError(429, "/x", "secondary rate limit"), { retryAfterSec: 2 });
    mockFetch.mockRejectedValueOnce(err).mockResolvedValueOnce(ok);
    const p = createCheckRun(input());
    await vi.advanceTimersByTimeAsync(1000); // less than the 2s Retry-After — must NOT retry yet
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // 2s total → retry fires
    await expect(p).resolves.toEqual({ url: ok.html_url, id: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the first try with no retry", async () => {
    mockFetch.mockResolvedValueOnce(ok);
    await expect(createCheckRun(input())).resolves.toEqual({ url: ok.html_url, id: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// upsertStickyComment must be idempotent on the stable `marker` (ci-gate-status-checks #4): concurrent PR
// events (two pushes, a synchronize racing a labeled) can BOTH miss the marker and BOTH create, stacking
// duplicate bot comments. We reconcile after the create — keep the earliest (lowest-id) marked comment,
// delete the rest — so racing handlers converge on ONE comment. githubAppFetch is mocked and routed by
// method so we can drive the found/created/raced branches.
const MARKER = "<!-- ascent-gate -->";
const sticky = (over: Partial<{ prNumber: number; body: string }> = {}) => ({
  token: "t",
  owner: "acme",
  repo: "app",
  prNumber: 7,
  marker: MARKER,
  body: "gate body",
  ...over,
});

describe("upsertStickyComment — idempotent find-or-create on the marker", () => {
  it("PATCHes the existing marked comment in place (no new comment) when one is already present", async () => {
    const patched: number[] = [];
    mockFetch.mockImplementation(async (path: string, _t: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return [{ id: 55, body: `old ${MARKER}`, html_url: "u55" }];
      if (method === "PATCH") {
        patched.push(Number(path.split("/").pop()));
        return { html_url: "u55-updated" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    const out = await upsertStickyComment(sticky());
    expect(out).toEqual({ url: "u55-updated", updated: true });
    expect(patched).toEqual([55]); // updated in place, never a new POST
  });

  it("creates a new comment when none exists; the post-create reconcile is a single scan with NO delete", async () => {
    let created = false;
    const deleted: number[] = [];
    mockFetch.mockImplementation(async (path: string, _t: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        deleted.push(Number(path.split("/").pop()));
        return {};
      }
      // Before the create: no marker → take the create path. After: reconcile sees only OUR comment.
      if (method === "GET") return created ? [{ id: 10, body: `b ${MARKER}`, html_url: "u10" }] : [];
      if (method === "POST") {
        created = true;
        return { id: 10, html_url: "u10" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    const out = await upsertStickyComment(sticky());
    expect(out).toEqual({ url: "u10", updated: false });
    expect(deleted).toEqual([]); // no duplicate → nothing deleted
  });

  it("reconciles a concurrent duplicate: keeps the EARLIEST (lowest-id) comment and deletes the racer's extra", async () => {
    // Simulate the race: our first scan sees no marker (the other handler's comment isn't visible yet),
    // so we create id=200. The reconcile scan then sees BOTH the earlier racer (id=100) and ours (id=200).
    let created = false;
    const deleted: number[] = [];
    mockFetch.mockImplementation(async (path: string, _t: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        deleted.push(Number(path.split("/").pop()));
        return {};
      }
      if (method === "GET") {
        return created
          ? [
              { id: 100, body: `earlier ${MARKER}`, html_url: "u100" },
              { id: 200, body: `ours ${MARKER}`, html_url: "u200" },
            ]
          : [];
      }
      if (method === "POST") {
        created = true;
        return { id: 200, html_url: "u200" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    const out = await upsertStickyComment(sticky());
    // Converged on the earliest comment; our later duplicate was deleted — one sticky comment survives.
    expect(out).toEqual({ url: "u100", updated: false });
    expect(deleted).toEqual([200]);
  });
});
