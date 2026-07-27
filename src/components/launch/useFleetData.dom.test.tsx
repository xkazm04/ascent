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
import { backoffDelayMs, useFleetData } from "./useFleetData";
import { POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS, POLL_ORG_CAP, SCAN_SETTLE_MS } from "./FleetMap.constants";
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

describe("useFleetData — per-org failure backoff", () => {
  it("computes an exponential schedule from one poll interval, capped", () => {
    expect(backoffDelayMs(1)).toBe(POLL_INTERVAL_MS); // a single blip retries on the normal next tick
    expect(backoffDelayMs(2)).toBe(POLL_INTERVAL_MS * 2);
    expect(backoffDelayMs(3)).toBe(POLL_INTERVAL_MS * 4);
    expect(backoffDelayMs(20)).toBe(POLL_BACKOFF_MAX_MS);
  });

  it("backs a FAILING org off while every healthy org keeps its normal cadence", async () => {
    respond = (org) =>
      org === "bad"
        ? { ok: false, status: 502, body: { repos: [] } }
        : { ok: true, body: { repos: [repoRow(`${org}/web`, 40)] } };
    mount(["good", "bad"]);
    await tick();
    const countOf = (org: string) => calls.filter((c) => c === org).length;
    expect(countOf("good")).toBe(1);
    expect(countOf("bad")).toBe(1);

    await tick(POLL_INTERVAL_MS); // 1st refresh: both polled; bad fails → next attempt one interval on
    expect(countOf("bad")).toBe(2);
    await tick(POLL_INTERVAL_MS); // 2nd: bad's penalty has elapsed, it fails again → 2 intervals
    expect(countOf("bad")).toBe(3);
    await tick(POLL_INTERVAL_MS); // 3rd: SKIPPED — the failing org stops hammering
    expect(countOf("bad")).toBe(3);
    await tick(POLL_INTERVAL_MS); // 4th: penalty elapsed, tried again
    expect(countOf("bad")).toBe(4);

    // The healthy org never missed a beat.
    expect(countOf("good")).toBe(5);
  });

  it("treats a malformed 200 as a failed pull (it must not read as a healthy poll)", async () => {
    respond = () => ({ ok: true, body: null });
    mount(["acme"]);
    await tick();
    await tick(POLL_INTERVAL_MS); // fails → 1 interval
    await tick(POLL_INTERVAL_MS); // fails → 2 intervals
    await tick(POLL_INTERVAL_MS); // skipped
    expect(calls).toHaveLength(3);
  });

  it("clears the penalty as soon as the org recovers", async () => {
    let healthy = false;
    respond = (org) =>
      healthy ? { ok: true, body: { repos: [repoRow(`${org}/web`, 60)] } } : { ok: false, status: 502, body: null };
    const { state } = mount(["acme"]);
    await tick();
    await tick(POLL_INTERVAL_MS); // fail → fails=1
    healthy = true;
    await tick(POLL_INTERVAL_MS); // recovers: the errored org HEALS to done…
    expect(reposOf(state.current[0])?.[0].overall).toBe(60);
    const after = calls.length;
    await tick(POLL_INTERVAL_MS); // …and polls on the very next tick, no residual penalty
    expect(calls).toHaveLength(after + 1);
  });
});

describe("useFleetData — bounded fan-out", () => {
  it("never has more than POLL_ORG_CAP pulls in flight, on mount or on a poll tick", async () => {
    const logins = Array.from({ length: POLL_ORG_CAP + 6 }, (_, i) => `org${i}`);
    mount(logins);
    await tick();
    expect(calls).toHaveLength(logins.length); // every org still pulled…
    expect(maxInFlight).toBe(POLL_ORG_CAP); // …just capped concurrently

    maxInFlight = 0;
    await tick(POLL_INTERVAL_MS);
    expect(calls).toHaveLength(logins.length * 2);
    expect(maxInFlight).toBe(POLL_ORG_CAP);
  });

  it("keeps the exact prior parallel burst for a fleet at or under the cap", async () => {
    mount(Array.from({ length: POLL_ORG_CAP }, (_, i) => `org${i}`));
    await tick();
    expect(maxInFlight).toBe(POLL_ORG_CAP);
  });
});
