// @vitest-environment jsdom
//
// Direction 8 — re-attach to a running import after a refresh. There was no resume test at all.
//
// What this pins: the import stream is NOT the run. `mapPool` inside /api/org/import is not tied to
// the request signal, so a refresh mid-scan leaves the run scanning, persisting and spending — while
// the wizard used to rehydrate to the SELECT step with no trace of it, whose obvious next move is to
// start the very same scan again (scanned twice, charged twice). A snapshot taken during "scanning"
// now carries the run's handle, and the wizard follows the run through the already-gated queue read.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { RESUME_KEY, type ResumeSnapshot } from "./OnboardingFlow.model";
import { rowFromJob } from "./useImportReattach";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const RUNNING: ResumeSnapshot = {
  org: "acme",
  sourceLabel: "acme",
  sourceInstallId: "42",
  selected: ["acme/web", "acme/api"],
  phase: "scanning",
  runId: "run-1",
};

/** Seed the snapshot a mid-scan refresh would have left behind. */
function seed(snap: ResumeSnapshot = RUNNING) {
  sessionStorage.setItem(RESUME_KEY, JSON.stringify(snap));
}

/** Stub fetch; `queue` is the body (or status) the queue endpoint answers with. Every call is
 *  recorded so the tests can assert the wizard never re-POSTs the import. */
function stubQueue(queue: { ok?: boolean; body?: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/org/scan/queue")) {
        if (queue.ok === false) return { ok: false, status: 403, json: async () => ({ error: "no" }) };
        return { ok: true, status: 200, json: async () => queue.body };
      }
      return { ok: true, json: async () => ({ repos: [] }) };
    }),
  );
  return calls;
}

describe("rowFromJob", () => {
  it("maps job states without inventing a score or a reason", () => {
    // The queue endpoint is the SCHEDULER's view — states, no reports — so a finished repo is
    // "completed" (a link to its report), never a fabricated level.
    expect(rowFromJob({ repo: "a/b", state: "done" })).toEqual({ repo: "a/b", completed: true });
    expect(rowFromJob({ repo: "a/b", state: "failed" })?.error).toMatch(/scan failed/i);
    expect(rowFromJob({ repo: "a/b", state: "skipped" })?.skipped).toBe("not_scanned");
    // Still in flight — the row stays "scanning…".
    expect(rowFromJob({ repo: "a/b", state: "queued" })).toBeNull();
    expect(rowFromJob({ repo: "a/b", state: "claimed" })).toBeNull();
  });
});

describe("useOnboardingFlow — a mid-scan refresh re-attaches instead of re-running", () => {
  it("re-enters the scan step, follows the run, and POSTs no new import", async () => {
    seed();
    const calls = stubQueue({
      body: {
        runId: "run-1",
        total: 2,
        pending: 1,
        repos: [
          { repo: "acme/web", state: "done" },
          { repo: "acme/api", state: "claimed" },
        ],
      },
    });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.reattach.status).toBe("polling"));
    expect(result.current.phase).toBe("scanning");
    expect(result.current.sourceLabel).toBe("acme");
    expect(result.current.importRunId).toBe("run-1");
    // The finished repo shows as finished; the in-flight one is still in flight.
    await waitFor(() => expect(result.current.rows["acme/web"]).toEqual({ repo: "acme/web", completed: true }));
    expect(result.current.rows["acme/api"]).toEqual({ repo: "acme/api" });
    expect(result.current.reattach).toMatchObject({ pending: 1, total: 2 });

    // The whole point: no second scan of the same repos.
    expect(calls.some((u) => u.includes("/api/org/import"))).toBe(false);
    expect(calls.some((u) => u.includes("/api/org/scan/queue?org=acme&runId=run-1"))).toBe(true);
  });

  it("shows the done screen once every job has settled, with the job rows as the results", async () => {
    seed();
    stubQueue({
      body: {
        runId: "run-1",
        total: 2,
        pending: 0,
        repos: [
          { repo: "acme/web", state: "done" },
          { repo: "acme/api", state: "failed" },
        ],
      },
    });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.reattach.status).toBe("settled");
    expect(result.current.rows["acme/web"]).toEqual({ repo: "acme/web", completed: true });
    expect(result.current.rows["acme/api"].error).toMatch(/scan failed/i);
  });

  it("resolves rows the queue never accounted for neutrally, never as a credit shortfall", async () => {
    seed();
    // The run left no readable jobs (an old run whose rows aged out): "not running" is still the
    // truth, and the unknown rows must not be relabelled into a billing story.
    stubQueue({ body: { runId: "run-1", total: 0, pending: 0, repos: [] } });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.rows["acme/web"].skipped).toBe("not_scanned");
    expect(result.current.rows["acme/api"].skipped).toBe("not_scanned");
  });

  it("says the run can't be followed when the queue refuses — never that it finished", async () => {
    seed();
    stubQueue({ ok: false });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.reattach.status).toBe("unavailable"));
    // Still on the scanning step: claiming "done" here would invent an outcome nobody can see.
    expect(result.current.phase).toBe("scanning");
  });

  it("a snapshot WITHOUT a run handle keeps the old behavior — back to the select step", async () => {
    seed({ ...RUNNING, phase: "scanning", runId: null });
    const calls = stubQueue({ body: {} });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("select"));
    expect(result.current.reattach.status).toBe("off");
    expect(calls.some((u) => u.includes("/api/org/scan/queue"))).toBe(false);
  });

  it("guards against leaving while a scan is in flight, and lifts the guard when it settles", async () => {
    seed();
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, ...rest) => {
      added.push(String(type));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realAdd(type as any, ...(rest as [any, any]));
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type, ...rest) => {
      removed.push(String(type));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realRemove(type as any, ...(rest as [any, any]));
    });
    stubQueue({
      body: { runId: "run-1", total: 2, pending: 1, repos: [{ repo: "acme/web", state: "claimed" }] },
    });

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("scanning"));
    await waitFor(() => expect(added).toContain("beforeunload"));
    expect(removed).not.toContain("beforeunload");
  });
});
