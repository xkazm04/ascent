// @vitest-environment jsdom
//
// FIRST tests for the fleet map's live-data ORCHESTRATION (launch-fleet-map 07-27). Until now only the
// pure settleInitialFetch was covered, while the genuinely tricky code — the 90s poll cycle, the
// visibility re-pull, the commit-time scanGen race, the SCAN_SETTLE_MS deferral — had none, and the
// two new cost bounds (per-org backoff, bounded fan-out) needed a harness to be trustworthy at all.
//
// The hook is driven directly rather than through FleetMap: it takes the setter + refs as arguments,
// so a plain functional-update sink reproduces exactly what FleetMap gives it, with no React state
// scheduling in the way of the timing assertions.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFleetData } from "./useFleetData";
import { POLL_INTERVAL_MS, SCAN_SETTLE_MS } from "./FleetMap.constants";
import type { Constellation } from "./fleetMapStars";

type Body = { repos?: unknown } | null;
/** What the mocked fetch should do for a given org login. */
type Responder = (org: string) => { ok: boolean; status?: number; body: Body } | Promise<{ ok: boolean; status?: number; body: Body }>;

const repoRow = (fullName: string, overall: number | null) => ({
  fullName,
  state: { level: overall == null ? null : "L3", overall, watched: false },
  dOverall: null,
});

let respond: Responder;
let calls: string[];
let maxInFlight: number;

function stubFetch() {
  calls = [];
  maxInFlight = 0;
  let inFlight = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const org = new URL(url, "https://x.test").searchParams.get("org")!;
      calls.push(org);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const r = await respond(org);
        return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body };
      } finally {
        inFlight -= 1;
      }
    }),
  );
}

/** Mount the hook with a functional-update sink standing in for FleetMap's useState setter. */
function mount(logins: string[]) {
  const installations = logins.map((login, i) => ({ id: i + 1, login }));
  const state: { current: Constellation[] } = {
    current: installations.map((i) => ({ id: i.id, login: i.login, status: "loading" as const })),
  };
  const setConstellations = (u: Constellation[] | ((c: Constellation[]) => Constellation[])) => {
    state.current = typeof u === "function" ? u(state.current) : u;
  };
  const scanCtrl = { current: null as AbortController | null };
  const scanGen = { current: 0 };
  const recentScan = { current: new Map<string, number>() };
  const view = renderHook(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the sink matches Dispatch<SetStateAction<…>> structurally
    useFleetData(installations, setConstellations as any, scanCtrl, scanGen, recentScan),
  );
  return { view, state, scanCtrl, scanGen, recentScan };
}

/** Let every pending microtask (and any timer due within `ms`) run. */
const tick = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const reposOf = (c: Constellation) => (c.status === "done" ? c.repos : null);

beforeEach(() => {
  vi.useFakeTimers();
  respond = (org) => ({ ok: true, body: { repos: [repoRow(`${org}/web`, 40)] } });
  stubFetch();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("useFleetData — the 90s poll cycle", () => {
  it("pulls each org once on mount, then again on every interval tick, merging fresh scores in place", async () => {
    const { state } = mount(["acme"]);
    await tick();
    expect(calls).toEqual(["acme"]);
    expect(reposOf(state.current[0])).toEqual([
      { fullName: "acme/web", overall: 40, level: "L3", dOverall: null, watched: false },
    ]);

    respond = (org) => ({ ok: true, body: { repos: [repoRow(`${org}/web`, 71)] } });
    await tick(POLL_INTERVAL_MS);
    expect(calls).toEqual(["acme", "acme"]);
    expect(reposOf(state.current[0])?.[0].overall).toBe(71);

    await tick(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(3);
  });

  it("no-ops the tick while the tab is HIDDEN, and re-pulls the moment it becomes visible again", async () => {
    mount(["acme"]);
    await tick();
    expect(calls).toHaveLength(1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await tick(POLL_INTERVAL_MS * 3);
    expect(calls).toHaveLength(1); // a backgrounded tab costs nothing

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    // Immediately — not up to 90s later, which is the whole point of the visibilitychange listener.
    expect(calls).toHaveLength(2);
  });

  // The interval paces itself; the visibilitychange listener did not. Alt-tabbing back and forth fired
  // a complete fleet fan-out on EVERY focus — one /api/app/repos call per org, each a live GitHub App
  // listing plus two DB queries — which is the same cost POLL_ORG_CAP and the per-org backoff exist to
  // bound, bypassed by frequency instead of by concurrency.
  it("does not re-pull the fleet on every focus within one poll interval", async () => {
    mount(["acme", "globex"]);
    await tick();
    expect(calls).toHaveLength(2); // the mount fetch, one per org

    // Six rapid focus events inside the window (a user flicking between tabs).
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    // The FIRST focus is a legitimate pull (nothing had refreshed yet, so the stars could be stale);
    // the other five are inside its window and cost nothing. Before this guard: 2 + 6*2 = 14 calls.
    expect(calls).toHaveLength(4);
  });

  it("still re-pulls immediately on a focus AFTER the interval has elapsed", async () => {
    mount(["acme"]);
    await tick();
    expect(calls).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(2); // first focus pulls

    // A full interval passes with the tab hidden, so the scheduled tick no-ops...
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await tick(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    // ...and coming back is worth a pull again: the throttle measures REFRESHES, not focus events.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(3);
  });

  it("stops polling and detaches its listener on unmount", async () => {
    const { view } = mount(["acme"]);
    await tick();
    view.unmount();
    await tick(POLL_INTERVAL_MS * 2);
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(calls).toHaveLength(1);
  });
});

describe("useFleetData — a live scan owns the stars", () => {
  it("DISCARDS a poll result whose scan generation changed mid-flight (the commit-time race)", async () => {
    const { state, scanGen } = mount(["acme"]);
    await tick();
    const before = reposOf(state.current[0]);
    expect(before?.[0].overall).toBe(40);

    // The refresh pull hangs; a manual scan starts and finishes (bumping the generation) while it is
    // in flight. Its late payload carries PRE-scan rows and must never be committed over the SSE ones.
    let release!: () => void;
    respond = () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, body: { repos: [repoRow("acme/web", 5)] } });
      });
    await tick(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(2);

    scanGen.current += 1;
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reposOf(state.current[0])?.[0].overall).toBe(40); // stale pull dropped, not committed
  });

  it("skips a scan already in flight (scanCtrl held) without even asking the server", async () => {
    const { scanCtrl } = mount(["acme"]);
    await tick();
    scanCtrl.current = new AbortController();
    await tick(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(1);
  });

  it("defers a JUST-SCANNED org for SCAN_SETTLE_MS, then resumes and clears the marker", async () => {
    const { recentScan } = mount(["acme"]);
    await tick();
    recentScan.current.set("acme", Date.now());

    await tick(POLL_INTERVAL_MS); // t=90s < 120s settle window
    expect(calls).toHaveLength(1);

    await tick(POLL_INTERVAL_MS); // t=180s > settle window
    expect(calls).toHaveLength(2);
    expect(recentScan.current.has("acme")).toBe(false);
    expect(SCAN_SETTLE_MS).toBeGreaterThan(POLL_INTERVAL_MS); // the deferral must outlast one tick
  });
});
