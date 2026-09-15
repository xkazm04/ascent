import { describe, expect, it, vi } from "vitest";
// The GitHub host seam is mocked as an object literal (not `importActual` + spread) so the factory
// carries no reference to a `const` declared below it — vi.mock is hoisted above every declaration.
vi.mock("@/lib/github/host", () => ({
  githubApiBase: () => "https://api.github.test",
  ghFetch: vi.fn(),
}));

import { ghFetch } from "@/lib/github/host";
import { fetchDeployments, toDeploymentRecord, FAILED_STATES } from "./deployments";

const gh = { id: 42, environment: "production", sha: "AbC123", ref: "main", created_at: "2026-08-01T00:00:00Z" };

describe("toDeploymentRecord", () => {
  it("maps a deployment with its latest status", () => {
    expect(toDeploymentRecord(gh, { state: "success", created_at: "2026-08-01T00:05:00Z" })).toEqual({
      externalId: "42",
      environment: "production",
      sha: "abc123", // lower-cased — the join key must fold with the merge-sha index
      ref: "main",
      state: "success",
      createdAt: "2026-08-01T00:00:00Z",
      statusAt: "2026-08-01T00:05:00Z",
    });
  });

  // "We do not know how this ended" is a real state. Defaulting to success would understate the
  // failure rate; defaulting to failure would invent one.
  it("normalizes a missing status to pending — never success, never failure", () => {
    expect(toDeploymentRecord(gh, null)!.state).toBe("pending");
    expect(toDeploymentRecord(gh, {})!.state).toBe("pending");
  });

  it("normalizes an unrecognized status to pending rather than storing it raw", () => {
    expect(toDeploymentRecord(gh, { state: "something_new" })!.state).toBe("pending");
  });

  it("drops a deployment with nothing to key, join or window on", () => {
    expect(toDeploymentRecord({ ...gh, id: undefined }, null)).toBeNull();
    expect(toDeploymentRecord({ ...gh, sha: undefined }, null)).toBeNull();
    expect(toDeploymentRecord({ ...gh, created_at: undefined }, null)).toBeNull();
  });

  it("falls back to a named-unknown environment rather than dropping the row", () => {
    expect(toDeploymentRecord({ ...gh, environment: undefined }, null)!.environment).toBe("unknown");
  });

  it("treats failure and error — and only those — as failed deployments", () => {
    expect([...FAILED_STATES].sort()).toEqual(["error", "failure"]);
    for (const ok of ["success", "pending", "inactive", "in_progress", "queued"]) {
      expect(FAILED_STATES.has(ok)).toBe(false);
    }
  });
});

// ── The abort signal (Direction 3) ───────────────────────────────────────────────────────────────
// The deployments read is 1 + N STRICTLY SEQUENTIAL calls (sequential on purpose — a parallel page
// trips GitHub's secondary rate limit), which makes it the longest enrichment in a scan and the only
// one that used to keep issuing requests after the client had disconnected: it was created without
// the scan's signal while every sibling passed it.

const mockFetch = vi.mocked(ghFetch);

/** Minimal Response-alike: `.ok` + `.json()` are all `ghJson` reads. */
const res = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

/** One deployment list page of `n` entries, then one status per entry. */
function wireGitHub(n: number, onCall?: (url: string) => void) {
  mockFetch.mockImplementation(async (url: string) => {
    onCall?.(url);
    if (url.includes("/statuses")) return res([{ state: "success", created_at: "2026-08-01T00:05:00Z" }]);
    return res(
      Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        environment: "production",
        sha: `sha${i}`,
        ref: "main",
        created_at: "2026-08-01T00:00:00Z",
      })),
    );
  });
}

describe("fetchDeployments — the scan's abort signal", () => {
  // Each test installs its own implementation; nothing here leaks between them.
  it("passes the signal to every request it makes", async () => {
    const seen: unknown[] = [];
    mockFetch.mockImplementation(async (url: string, opts = {}) => {
      seen.push(opts.signal);
      return res(url.includes("/statuses") ? [] : [{ id: 1, sha: "a", created_at: "2026-08-01T00:00:00Z" }]);
    });
    const ctrl = new AbortController();
    await fetchDeployments("acme", "r", "t", ctrl.signal);
    expect(seen.length).toBeGreaterThan(1); // the list call AND the status call
    for (const s of seen) expect(s).toBe(ctrl.signal);
  });

  it("stops the sequential status loop once the caller has gone, keeping what it read", async () => {
    const ctrl = new AbortController();
    let statusCalls = 0;
    wireGitHub(20, (url) => {
      if (url.includes("/statuses")) {
        statusCalls += 1;
        if (statusCalls === 3) ctrl.abort(); // the client disconnects mid-page
      }
    });
    const out = await fetchDeployments("acme", "r", "t", ctrl.signal);
    // Three statuses read, then the loop breaks — not the remaining 17 calls nobody is waiting for.
    expect(statusCalls).toBe(3);
    expect(out).toHaveLength(3);
  });

  it("without a signal it pages the whole bounded set, exactly as before", async () => {
    let statusCalls = 0;
    wireGitHub(20, (url) => {
      if (url.includes("/statuses")) statusCalls += 1;
    });
    const out = await fetchDeployments("acme", "r", "t");
    expect(statusCalls).toBe(20);
    expect(out).toHaveLength(20);
  });

  it("honors the limit argument in its new (post-signal) position", async () => {
    wireGitHub(20);
    expect(await fetchDeployments("acme", "r", "t", undefined, 5)).toHaveLength(5);
  });
});

