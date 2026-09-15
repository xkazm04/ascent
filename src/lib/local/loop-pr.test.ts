// The one action that leaves the machine. Four things are load-bearing:
//   • a push that fails carries GIT'S OWN message (a non-fast-forward, a missing remote and a bad
//     credential need three different human responses and only git knows which happened);
//   • a 422 on create reuses the open PR, so a second click is idempotent rather than an error;
//   • the recorded row carries `source: "loop"`, its `loopLaneId`, and the LANE's own baseline scan —
//     which is what lets a merge move points from in-review to bought without re-measuring;
//   • a lane with no dominant dimension is REFUSED, never filed under a fabricated one.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppApiError } from "@/lib/github/app";

const git: { ok: boolean; stderr: string } = { ok: true, stderr: "" };
const pushes: string[][] = [];
vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (_dir: string, args: string[]) => {
    pushes.push(args);
    return { ok: git.ok, stdout: "", stderr: git.stderr };
  }),
}));

const fetches: { path: string; init?: RequestInit }[] = [];
const behaviour = { createThrows: null as AppApiError | null, openPrs: [] as { html_url: string; number: number }[] };
vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return {
    ...actual,
    getInstallationToken: vi.fn(async () => "tok"),
    githubAppFetch: vi.fn(async (path: string, _t: string, init?: RequestInit) => {
      fetches.push({ path, init });
      if (path.endsWith("/pulls") && init?.method === "POST") {
        if (behaviour.createThrows) throw behaviour.createThrows;
        return { html_url: "https://github.com/acme/web/pull/7", number: 7 };
      }
      return behaviour.openPrs;
    }),
  };
});

const installation = { id: "42" as string | null };
vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: vi.fn(async () => installation.id) }));

const recorded: Record<string, unknown>[] = [];
vi.mock("@/lib/db/improvement-events", () => ({
  recordLoopPr: vi.fn(async (input: Record<string, unknown>) => {
    recorded.push(input);
    return true;
  }),
}));
const lanePatches: Record<string, unknown>[] = [];
vi.mock("@/lib/db/loop-runs", () => ({
  updateLane: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    lanePatches.push(patch);
    return {};
  }),
}));

import { openPrForLane } from "@/lib/local/loop-pr";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";

const lane = (over: Partial<LoopLaneRecord> = {}): LoopLaneRecord =>
  ({
    id: "lane-1",
    runId: "run-1",
    repoFullName: "acme/web",
    cycle: 2,
    phase: "done",
    branch: "ascent/loop-2026-web",
    batchIds: ["r1"],
    closedIds: ["r1"],
    commits: 3,
    beforeScanId: "scan-before",
    afterScanId: "scan-after",
    stage: null,
    log: [],
    error: null,
    startedAt: null,
    endedAt: null,
    model: "sonnet",
    costSource: "envelope",
    costMicros: 1000,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    turns: null,
    agentDurationMs: null,
    agentSessionId: null,
    abPairKey: null,
    dimId: "D3",
    prNumber: null,
    prUrl: null,
    brief: null,
    report: null,
    ...over,
  }) as LoopLaneRecord;

const open = (over: Partial<LoopLaneRecord> = {}) =>
  openPrForLane({ orgSlug: "acme", orgId: "org-1", lane: lane(over), pairedPath: "C:/paired/web", actor: "kazimi66" });

beforeEach(() => {
  git.ok = true;
  git.stderr = "";
  pushes.length = 0;
  fetches.length = 0;
  recorded.length = 0;
  lanePatches.length = 0;
  behaviour.createThrows = null;
  behaviour.openPrs = [];
  installation.id = "42";
});

describe("openPrForLane — the happy path", () => {
  it("pushes the lane branch WITHOUT force and opens a draft PR", async () => {
    const res = await open();
    expect(pushes[0]).toEqual(["push", "--set-upstream", "origin", "ascent/loop-2026-web"]);
    // Never --force: if the remote branch moved, a human needs to look.
    expect(pushes[0]).not.toContain("--force");
    expect(res).toEqual({ prNumber: 7, prUrl: "https://github.com/acme/web/pull/7", reused: false });
    expect(JSON.parse(String(fetches[0]!.init!.body))).toMatchObject({ draft: true, head: "ascent/loop-2026-web" });
  });

  it("records the ledger row against the LANE's own baseline, tagged as a loop row", async () => {
    await open();
    expect(recorded[0]).toMatchObject({
      laneId: "lane-1",
      repoFullName: "acme/web",
      dimId: "D3",
      prNumber: 7,
      beforeScanId: "scan-before",
      openedBy: "kazimi66",
    });
    // …and denormalizes the PR onto the lane so the cockpit renders the link without a join.
    expect(lanePatches[0]).toMatchObject({ prNumber: 7, prUrl: "https://github.com/acme/web/pull/7" });
  });

  it("tells the reviewer the measurement was taken on the BRANCH, not bought", async () => {
    await open();
    const body = JSON.parse(String(fetches[0]!.init!.body)) as { body: string };
    expect(body.body).toContain("on this branch");
    expect(body.body).toContain("not counted as bought");
  });
});

describe("openPrForLane — refusals", () => {
  it("surfaces git's own message when the push is rejected", async () => {
    git.ok = false;
    git.stderr = "! [rejected] ascent/loop-2026-web -> ascent/loop-2026-web (non-fast-forward)";
    await expect(open()).rejects.toMatchObject({ status: 409 });
    await expect(open()).rejects.toThrow(/non-fast-forward/);
    // Nothing was filed: a push that did not happen has no PR to record.
    expect(recorded).toEqual([]);
  });

  it("refuses a lane with no dominant dimension rather than inventing one", async () => {
    // `ImprovementPr.dimId` is not nullable, and filing real work under a dimension nobody chose
    // would put a fabricated row in the improvement ledger.
    await expect(open({ dimId: null })).rejects.toMatchObject({ status: 409 });
    expect(pushes).toEqual([]);
  });

  it("refuses a lane with no branch", async () => {
    await expect(open({ branch: null })).rejects.toMatchObject({ status: 409 });
  });

  it("says the branch is pushed when there is no installation to open the PR with", async () => {
    installation.id = null;
    await expect(open()).rejects.toThrow(/branch is pushed/);
  });
});

describe("openPrForLane — idempotence", () => {
  it("reuses the already-open PR for this head on a 422", async () => {
    behaviour.createThrows = new AppApiError(422, "/pulls", "A pull request already exists");
    behaviour.openPrs = [{ html_url: "https://github.com/acme/web/pull/3", number: 3 }];
    const res = await open();
    expect(res).toEqual({ prNumber: 3, prUrl: "https://github.com/acme/web/pull/3", reused: true });
    expect(recorded[0]).toMatchObject({ prNumber: 3 });
  });

  it("rethrows the 422 when no open PR can be found for the head", async () => {
    behaviour.createThrows = new AppApiError(422, "/pulls", "something else entirely");
    behaviour.openPrs = [];
    await expect(open()).rejects.toMatchObject({ status: 422 });
  });
});
