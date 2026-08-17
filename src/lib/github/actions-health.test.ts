// fetchCiHealth is the difference between "this repo has a CI workflow committed" (all D3 could ever
// see) and "this repo's CI actually passes". Three things are pinned here:
//
//   1. Null on a failed read. 403 (no Actions:read) and 404 (Actions disabled) must NOT become a 0%
//      success rate — the enrichment is additive, and a fabricated zero would describe a healthy repo
//      as having broken CI purely because the token was narrow. `sampled: 0` on a 200 is the real zero.
//   2. The sample excludes non-verdicts. Cancelled/skipped/neutral/stale/action_required runs say
//      nothing about pipeline health; counting them as failures would make a path-filtered monorepo
//      look permanently red.
//   3. `failing` is CURRENTLY red, not EVER red — only a workflow whose most recent sampled run failed.
//
// The host layer is real (only global fetch is stubbed) so the query string asserted here is the one
// the scanner sends.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CI_HEALTH_SAMPLE, fetchCiHealth } from "./actions-health";

const API = "https://api.github.com";
const calls: { url: string; init: RequestInit }[] = [];

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }),
  );
}

/** A completed run. `mins` drives updated_at − run_started_at, the duration the summary medians. */
function run(
  name: string,
  conclusion: string | null,
  created_at: string,
  opts: { mins?: number; workflow_id?: number; status?: string } = {},
) {
  const started = Date.parse(created_at);
  return {
    id: started,
    name,
    workflow_id: opts.workflow_id ?? name.length,
    status: opts.status ?? "completed",
    conclusion,
    created_at,
    run_started_at: created_at,
    updated_at: new Date(started + (opts.mins ?? 1) * 60_000).toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("fetchCiHealth — the summary math", () => {
  it("computes success rate, median duration, latest run and workflow count over the sample", async () => {
    stub(200, {
      total_count: 4,
      workflow_runs: [
        run("Tests", "success", "2026-08-17T12:00:00Z", { mins: 10, workflow_id: 1 }),
        run("Lint", "success", "2026-08-17T11:00:00Z", { mins: 2, workflow_id: 2 }),
        run("Tests", "failure", "2026-08-16T12:00:00Z", { mins: 4, workflow_id: 1 }),
        run("Tests", "success", "2026-08-15T12:00:00Z", { mins: 8, workflow_id: 1 }),
      ],
    });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toEqual({
      branch: "main",
      sampled: 4,
      successRate: 75, // 3 of 4
      medianDurationMin: 6, // (4 + 8) / 2 over the sorted 2,4,8,10
      latestRunAt: "2026-08-17T12:00:00Z",
      workflows: 2,
      failing: [], // Tests failed once, but its MOST RECENT run is green
    });
  });

  it("rounds the success rate and keeps one decimal on the median", async () => {
    stub(200, {
      total_count: 3,
      workflow_runs: [
        run("A", "success", "2026-08-17T12:00:00Z", { mins: 1.25, workflow_id: 1 }),
        run("A", "success", "2026-08-17T11:00:00Z", { mins: 5, workflow_id: 1 }),
        run("A", "failure", "2026-08-17T10:00:00Z", { mins: 9, workflow_id: 1 }),
      ],
    });
    const h = await fetchCiHealth("o", "r", "main", "tok");
    expect(h).toMatchObject({ sampled: 3, successRate: 67, medianDurationMin: 5, workflows: 1 });
  });

  it("counts timed_out and startup_failure as failures", async () => {
    stub(200, {
      total_count: 3,
      workflow_runs: [
        run("A", "timed_out", "2026-08-17T12:00:00Z", { workflow_id: 1 }),
        run("B", "startup_failure", "2026-08-17T11:00:00Z", { workflow_id: 2 }),
        run("C", "success", "2026-08-17T10:00:00Z", { workflow_id: 3 }),
      ],
    });
    const h = await fetchCiHealth("o", "r", "main", "tok");
    expect(h).toMatchObject({ sampled: 3, successRate: 33 });
    expect(h!.failing).toEqual(["A", "B"]);
  });

  // A cancelled or path-skipped run is not a verdict on the pipeline. Counting one as a failure would
  // make an ordinary monorepo (most workflows skipped on most pushes) look permanently broken.
  it("drops non-verdict conclusions and not-yet-completed runs from the sample entirely", async () => {
    stub(200, {
      total_count: 8,
      workflow_runs: [
        run("A", "success", "2026-08-17T12:00:00Z", { workflow_id: 1 }),
        run("A", "cancelled", "2026-08-17T11:59:00Z", { workflow_id: 1 }),
        run("A", "skipped", "2026-08-17T11:58:00Z", { workflow_id: 1 }),
        run("A", "neutral", "2026-08-17T11:57:00Z", { workflow_id: 1 }),
        run("A", "stale", "2026-08-17T11:56:00Z", { workflow_id: 1 }),
        run("A", "action_required", "2026-08-17T11:55:00Z", { workflow_id: 1 }),
        run("A", null, "2026-08-17T11:54:00Z", { workflow_id: 1 }),
        run("A", "failure", "2026-08-17T11:53:00Z", { workflow_id: 1, status: "in_progress" }),
      ],
    });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toMatchObject({
      sampled: 1,
      successRate: 100,
      failing: [],
    });
  });

  it("names a workflow whose LATEST sampled run failed, even when older runs were green", async () => {
    stub(200, {
      total_count: 4,
      workflow_runs: [
        run("Deploy", "failure", "2026-08-17T12:00:00Z", { workflow_id: 7 }),
        run("Deploy", "success", "2026-08-16T12:00:00Z", { workflow_id: 7 }),
        run("Tests", "success", "2026-08-17T09:00:00Z", { workflow_id: 8 }),
        run("Tests", "failure", "2026-08-10T09:00:00Z", { workflow_id: 8 }),
      ],
    });
    const h = await fetchCiHealth("o", "r", "main", "tok");
    expect(h!.failing).toEqual(["Deploy"]); // Tests recovered — a healed workflow is not "red now"
    expect(h!.successRate).toBe(50);
  });

  it("dedupes the failing names when one workflow appears under several ids", async () => {
    stub(200, {
      total_count: 2,
      workflow_runs: [
        run("Nightly", "failure", "2026-08-17T12:00:00Z", { workflow_id: 1 }),
        run("Nightly", "failure", "2026-08-17T11:00:00Z", { workflow_id: 2 }),
      ],
    });
    expect((await fetchCiHealth("o", "r", "main", "tok"))!.failing).toEqual(["Nightly"]);
  });

  it("omits the median when no run has a usable duration", async () => {
    stub(200, {
      total_count: 1,
      workflow_runs: [
        { ...run("A", "success", "2026-08-17T12:00:00Z", { workflow_id: 1 }), run_started_at: null, updated_at: null },
      ],
    });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toMatchObject({ sampled: 1, medianDurationMin: null });
  });

  it("a 200 with no runs is a REAL zero, distinct from an unreadable one", async () => {
    stub(200, { total_count: 0, workflow_runs: [] });
    expect(await fetchCiHealth("o", "r", "trunk", "tok")).toEqual({
      branch: "trunk",
      sampled: 0,
      successRate: null,
      medianDurationMin: null,
      latestRunAt: null,
      workflows: 0,
      failing: [],
    });
  });

  it("also reports the real zero when every run in the page was excluded", async () => {
    stub(200, { total_count: 2, workflow_runs: [run("A", "cancelled", "2026-08-17T12:00:00Z"), run("B", null, "2026-08-17T11:00:00Z")] });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toMatchObject({ sampled: 0, successRate: null });
  });
});

describe("fetchCiHealth — an unreadable run history is null, never a 0% success rate", () => {
  it.each([403, 404, 500])("returns null on HTTP %i", async (status) => {
    stub(status, { message: "nope" });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toBeNull();
  });

  it("returns null on a 200 whose body is not the documented shape", async () => {
    stub(200, "<html>gateway</html>");
    expect(await fetchCiHealth("o", "r", "main", "tok")).toBeNull();
    stub(200, { total_count: 3, workflow_runs: { "0": "nope" } });
    expect(await fetchCiHealth("o", "r", "main", "tok")).toBeNull();
  });

  it("returns null (never throws) when the transport fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ETIMEDOUT"); }));
    await expect(fetchCiHealth("o", "r", "main", "tok")).resolves.toBeNull();
  });
});

describe("fetchCiHealth — request construction", () => {
  it("samples one page of the named branch and excludes PR-triggered runs", async () => {
    stub(200, { total_count: 0, workflow_runs: [] });
    await fetchCiHealth("vercel", "next.js", "canary", "tok");
    expect(calls[0].url).toBe(
      `${API}/repos/vercel/next.js/actions/runs?branch=canary&per_page=${CI_HEALTH_SAMPLE}&exclude_pull_requests=true`,
    );
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("encodes a slash-containing branch as a query value", async () => {
    stub(200, { total_count: 0, workflow_runs: [] });
    const h = await fetchCiHealth("acme", "core", "release/2.1", "tok");
    expect(calls[0].url).toContain("branch=release%2F2.1");
    expect(h!.branch).toBe("release/2.1"); // reported back unencoded
  });
});
