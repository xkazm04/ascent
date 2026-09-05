// @vitest-environment jsdom
//
// W6b preview-then-upgrade, the wire: with "fast preview first" ON (the default) on the App path
// with real headroom, startScan must (1) POST the import as an instant mock preview that WATCHES the
// repos with schedule "off" (the header's live upgrade walks the watchlist; unconsented weekly
// billing must not ride along), and (2) write the one-shot handoff flag — org + exact repo set — on
// the stream's `result`, marking the run upgradePlanned for the done-phase handoff. With the toggle
// OFF, the run is byte-identical to pre-W6b live behavior and no flag is written.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { resetAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { resetPreviewFirst, setPreviewFirst, getPreviewFirst } from "./OnboardingSelectStep.previewFirst";

const REPOS = [
  { fullName: "acme/api", private: true, language: "TS", stars: 5, pushedAt: null },
  { fullName: "acme/web", private: false, language: "TS", stars: 3, pushedAt: null },
];
const FLAG_KEY = "ascent.upgrade-scan.v1";

let bodies: Record<string, unknown>[] = [];

/** A minimal successful import stream: one repo frame, then the terminal result. */
function sseBody(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const frames =
    'event: repo\ndata: {"repo":"acme/api","level":"L2","overall":40}\n\n' +
    'event: repo\ndata: {"repo":"acme/web","level":"L2","overall":42}\n\n' +
    'event: result\ndata: {"org":"acme","scanned":2,"total":2}\n\n';
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(frames));
      c.close();
    },
  });
}

beforeEach(() => {
  bodies = [];
  resetAutoWatchOptIn();
  resetPreviewFirst();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/app/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
      if (url.includes("/api/org/credits"))
        return { ok: true, json: async () => ({ balance: 10, unlimited: false, allowanceRemaining: 0 }) };
      if (url.includes("/api/org/import")) {
        bodies.push(JSON.parse(String(init?.body)));
        return { ok: true, status: 200, body: sseBody(), json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAutoWatchOptIn();
  resetPreviewFirst();
});

async function loadAndScan(result: { current: ReturnType<typeof useOnboardingFlow> }) {
  await act(async () => {
    await result.current.loadInstallationRepos("acme", "42");
  });
  await waitFor(() => expect(result.current.repos).toHaveLength(2));
  await act(async () => {
    await result.current.startScan();
  });
}

describe("onboarding preview-then-upgrade (fast preview first)", () => {
  it("defaults ON: imports as mock + watch with schedule 'off', and writes the one-shot handoff flag on result", async () => {
    const { result } = renderHook(() => useOnboardingFlow());
    await loadAndScan(result);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.mock).toBe(true);
    expect(bodies[0]!.watch).toBe(true);
    expect(bodies[0]!.schedule).toBe("off");

    // The run is disclosed as a preview with the live upgrade queued.
    expect(result.current.phase).toBe("done");
    expect(result.current.previewScan).toBe(true);
    expect(result.current.upgradePlanned).toBe(true);

    const flag = JSON.parse(sessionStorage.getItem(FLAG_KEY)!);
    expect(flag.org).toBe("acme");
    expect(flag.repos).toEqual(["acme/api", "acme/web"]);
  });

  it("toggle OFF: runs live in the wizard exactly as before — no mock, no flag, not upgradePlanned", async () => {
    setPreviewFirst(false);
    const { result } = renderHook(() => useOnboardingFlow());
    await loadAndScan(result);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.mock).toBe(false);
    expect(bodies[0]!.watch).toBe(false); // autoscan opt-in untouched
    expect(bodies[0]!.schedule).toBeUndefined();
    expect(result.current.upgradePlanned).toBe(false);
    expect(result.current.previewScan).toBe(false);
    expect(sessionStorage.getItem(FLAG_KEY)).toBeNull();
  });

  it("'Scan another' restores the preview-first default so one run's choice can't leak into the next", () => {
    setPreviewFirst(false);
    const { result } = renderHook(() => useOnboardingFlow());
    act(() => result.current.resetRun());
    expect(getPreviewFirst()).toBe(true);
  });
});
