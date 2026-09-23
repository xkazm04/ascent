// @vitest-environment jsdom
//
// first-run-onboarding-wizard#B (challenge-2026-09-23): the App-path listing keeps each repo's
// standing (the /api/app/repos `state` the normalize map used to drop), and "Scan another" overlays
// the run it just finished onto the next listing, because the route's 30s payload cache can still
// answer with the pre-scan state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { resetAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { resetPreviewFirst, setPreviewFirst } from "./OnboardingSelectStep.previewFirst";
import { standingLabel } from "./repoStanding";

const SCANNED = { watched: true, scanSchedule: "weekly", level: "L3", overall: 62, scannedAt: "2026-09-20T10:00:00.000Z", preview: false };

/** acme/web is the most-starred; ten less-starred siblings keep the default selection full without it. */
function listing(webState: unknown) {
  return [
    { fullName: "acme/web", private: true, language: "TS", stars: 50, pushedAt: "2026-09-01T00:00:00.000Z", url: "u", state: webState },
    ...Array.from({ length: 10 }, (_, i) => ({
      fullName: `acme/r${i}`,
      private: true,
      language: null,
      stars: 10 - i,
      pushedAt: null,
      url: "u",
      state: null,
    })),
  ];
}

function sse(frames: [string, unknown][]) {
  const text = [...frames, ["result", { ok: true }] as [string, unknown]]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

/** The repos payload is FROZEN (the route's 30s cache): every re-list answers with `webState`. */
function stub(webState: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/org/credits"))
        return { ok: true, json: async () => ({ balance: 10, unlimited: false, allowanceRemaining: 0 }) };
      if (url.includes("/api/app/repos")) return { ok: true, json: async () => ({ repos: listing(webState), truncated: false }) };
      if (url.includes("/api/org/import"))
        return { ok: true, status: 200, body: sse([["repo", { repo: "acme/web", level: "L4", overall: 80 }]]) };
      return { ok: true, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  resetAutoWatchOptIn();
  resetPreviewFirst();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("loadInstallationRepos keeps the standing", () => {
  it("maps the wire state onto repos[i].standing, and state:null onto standing:null", async () => {
    stub(SCANNED);
    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadInstallationRepos("acme", "77");
    });
    const web = result.current.repos.find((r) => r.fullName === "acme/web");
    expect(web?.standing).toEqual({
      level: "L3",
      overall: 62,
      watched: true,
      schedule: "weekly",
      scannedAt: "2026-09-20T10:00:00.000Z",
      preview: false,
    });
    expect(result.current.repos.find((r) => r.fullName === "acme/r0")?.standing).toBeNull();
    // The scored repo is the most-starred, yet the 10 default slots go to the unscanned ten.
    expect(result.current.selected.has("acme/web")).toBe(false);
    expect(result.current.selected.size).toBe(10);
  });
});

async function scanWebThenScanAnother() {
  stub(null);
  const { result } = renderHook(() => useOnboardingFlow());
  await act(async () => {
    await result.current.loadInstallationRepos("acme", "77");
  });
  expect(result.current.selected.has("acme/web")).toBe(true); // never scanned: preselected
  act(() => result.current.setSelected(new Set(["acme/web"])));
  await act(async () => {
    await result.current.startScan();
  });
  await waitFor(() => expect(result.current.phase).toBe("done"));
  act(() => result.current.resetRun());
  await act(async () => {
    await result.current.loadInstallationRepos("acme", "77");
  });
  return result;
}

describe("'Scan another' overlays the finished run onto the cached listing", () => {
  it("a live run's scored repo shows its new standing and is not preselected", async () => {
    setPreviewFirst(false);
    const result = await scanWebThenScanAnother();
    const web = result.current.repos.find((r) => r.fullName === "acme/web")!;
    expect(web.standing).toMatchObject({ level: "L4", overall: 80, preview: false });
    expect(standingLabel(web.standing ?? null, web.pushedAt)).toMatch(/^L4 · 80/);
    expect(result.current.selected.has("acme/web")).toBe(false);
  });

  it("revision: a preview run's repo is overlaid as a preview, so it stays preselected and is never 'free'", async () => {
    // Preview-first is ON by default: with headroom this run is the instant mock preview.
    const result = await scanWebThenScanAnother();
    const web = result.current.repos.find((r) => r.fullName === "acme/web")!;
    expect(web.standing).toMatchObject({ level: "L4", overall: 80, preview: true });
    expect(standingLabel(web.standing ?? null, web.pushedAt)).not.toMatch(/unchanged|free/);
    expect(result.current.selected.has("acme/web")).toBe(true);
  });
});
