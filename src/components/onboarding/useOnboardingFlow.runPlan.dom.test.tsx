// @vitest-environment jsdom
//
// first-run-onboarding-wizard#A (challenge-2026-09-23): a re-attached run knows WHAT it is.
//
// The resume snapshot used to record only where the user was (source, selection, phase, runId). A
// refresh mid-scan therefore re-attached to a run whose plan was lost: the done screen defaulted to
// preview copy on a live run ("install the GitHub App"), a preview-then-upgrade run never wrote the
// one-shot handoff flag (the owed live upgrade was silently dropped), and a Retry read the consent
// stores a reload had reset, downgrading a paid live run to a mock. The v2 snapshot carries the plan
// and the consent; these pin each disclosure off it.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { RESUME_KEY } from "./OnboardingFlow.model";
import { resetAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { resetPreviewFirst } from "./OnboardingSelectStep.previewFirst";

const FLAG_KEY = "ascent.upgrade-scan.v1";
const BASE = {
  org: "acme",
  sourceLabel: "acme",
  sourceInstallId: "42",
  selected: ["acme/web", "acme/api"],
  phase: "scanning",
  runId: "run-1",
};
const UPGRADE_PLAN = {
  mock: true,
  watch: true,
  schedule: "off",
  upgradeAfter: true,
  publicFunnel: false,
  previewCause: null,
};
const LIVE_PLAN = { mock: false, watch: true, upgradeAfter: false, publicFunnel: false, previewCause: null };

let bodies: Record<string, unknown>[] = [];

/** The queue answers with `jobs` all settled; credits are readable; an import POST is recorded and
 *  refused (the assertion is about what was SENT). */
function stub(jobs: { repo: string; state: string }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/org/scan/queue"))
        return { ok: true, status: 200, json: async () => ({ runId: "run-1", total: jobs.length, pending: 0, repos: jobs }) };
      if (url.includes("/api/org/credits"))
        return { ok: true, json: async () => ({ balance: 10, unlimited: false, allowanceRemaining: 0 }) };
      if (url.includes("/api/org/import")) {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return { ok: false, status: 500, body: null, json: async () => ({ error: "stub" }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

const DONE = [
  { repo: "acme/web", state: "done" },
  { repo: "acme/api", state: "done" },
];

beforeEach(() => {
  bodies = [];
  sessionStorage.clear();
  // A reload resets the module stores to their defaults (preview-first ON, autoscan OFF).
  resetAutoWatchOptIn();
  resetPreviewFirst();
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("useOnboardingFlow — a re-attached run restores its plan from the v2 snapshot", () => {
  it("an owed live upgrade is written on settle, exactly as the streamed path writes it", async () => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...BASE, version: 2, plan: UPGRADE_PLAN, consent: { previewFirst: true, watchOptIn: false } }));
    stub(DONE);

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.upgradePlanned).toBe(true);
    expect(result.current.previewScan).toBe(true);
    const flag = JSON.parse(sessionStorage.getItem(FLAG_KEY) ?? "null");
    expect(flag).toMatchObject({ org: "acme", repos: ["acme/web", "acme/api"] });
  });

  it("a live run is disclosed as live: no preview banner on its done screen", async () => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...BASE, version: 2, plan: LIVE_PLAN, consent: { previewFirst: false, watchOptIn: true } }));
    stub(DONE);

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.previewScan).toBe(false);
    expect(result.current.upgradePlanned).toBe(false);
    expect(sessionStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it("Retry after a re-attach carries the run's recorded consent, not the reloaded store defaults", async () => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...BASE, version: 2, plan: LIVE_PLAN, consent: { previewFirst: false, watchOptIn: true } }));
    stub([
      { repo: "acme/web", state: "done" },
      { repo: "acme/api", state: "failed" },
    ]);

    const { result } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(result.current.phase).toBe("done"));

    await act(async () => {
      await result.current.retryRepo("acme/api");
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ org: "acme", repos: ["acme/api"], installationId: "42", mock: false, watch: true, schedule: "weekly" });
  });

  it("guard: a v1 snapshot (no plan) still re-attaches and settles with today's disclosures", async () => {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(BASE));
    stub(DONE);

    const { result } = renderHook(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.rows["acme/web"]).toEqual({ repo: "acme/web", completed: true });
    expect(result.current.previewScan).toBe(true);
    expect(result.current.upgradePlanned).toBe(false);
    expect(sessionStorage.getItem(FLAG_KEY)).toBeNull();
  });
});
