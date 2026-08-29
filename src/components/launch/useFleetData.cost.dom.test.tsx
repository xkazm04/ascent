// @vitest-environment jsdom
//
// The fleet map's two COST bounds, split out of useFleetData.dom.test.tsx when that file crossed the
// 300-LOC cap (AGENTS.md). Sibling by THEME: everything here is about what the poll cycle COSTS —
// the per-org exponential backoff (a permanently failing org must stop being re-asked every 90s) and
// the bounded fan-out (a 20-org fleet must not open 20 sockets at once). The timing/race behaviour
// of the same hook stays next door. Carries its own harness, as the rule prescribes.

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
