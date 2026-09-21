// @vitest-environment jsdom
//
// The theater's states as a whole page: a stale pulse (every liveness label switches and nothing moves),
// reduced motion (every animation resolves to its end state), the demo (the fixture, no fetch), the
// kiosk (token transport, no signed-in controls), and "Enter theater mode" (fullscreen + wake lock).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CYCLE_S, fixturePulse } from "./theaterFixture";

const sound = vi.hoisted(() => ({ playCue: vi.fn(), unlockAudio: vi.fn(() => true), lockAudio: vi.fn() }));
vi.mock("./theaterSound", () => sound);

const { TheaterShell } = await import("./TheaterShell");

let replies: { status: number; body: unknown }[] = [];
let urls: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const r = replies.length > 1 ? replies.shift()! : replies[0]!;
      return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function reduceMotion() {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
}

describe("TheaterShell — states", () => {
  it("stale: after 10 s without a good read the page says so everywhere and the live-dot stops", async () => {
    replies = [{ status: 200, body: fixturePulse() }, { status: 503, body: { error: "down" } }];
    const { container } = render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(0);
    expect(screen.getByTestId("theater-live-dot")).toBeInTheDocument();
    expect(container.querySelector("[data-stale]")).toBeNull();
    await advance(12_000);
    expect(container.querySelector("[data-stale]")).not.toBeNull();
    expect(screen.queryByTestId("theater-live-dot")).toBeNull();
    expect(screen.getByRole("region", { name: "Running?" })).toHaveTextContent(/Reconnecting…/);
    expect(screen.getByRole("region", { name: "Now" })).toHaveTextContent(/Last heard \d+ s ago/);
    // Nothing pretends to move: the hero's elapsed figures are frozen at last contact.
    const frozen = screen.getByRole("region", { name: "Lanes at work" }).textContent;
    await advance(5_000);
    expect(screen.getByRole("region", { name: "Lanes at work" }).textContent).toBe(frozen);
  });

  it("reduced motion: a new arrival's card and rail entry render at their end state, no animation", async () => {
    reduceMotion();
    const base = fixturePulse();
    const landed = { at: "2026-09-18T12:00:03.000Z", repo: "acme/kp", kind: "landed" as const, headline: "kp landed run #15" };
    replies = [{ status: 200, body: base }, { status: 200, body: { ...base, latest: [landed, ...base.latest] } }];
    const { container } = render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(2_000);
    await advance(1);
    const card = container.querySelector('[data-cue="celebrate"]');
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/animate-/);
    expect(container.querySelector(".burst-ring")).toBeNull();
    expect(container.querySelector("footer .animate-pop-in")).toBeNull();
  });

  it("without reduced motion the arrival enters once (pop-in on the rail, burst on the card)", async () => {
    const base = fixturePulse();
    const landed = { at: "2026-09-18T12:00:03.000Z", repo: "acme/kp", kind: "landed" as const, headline: "kp landed run #15" };
    replies = [{ status: 200, body: base }, { status: 200, body: { ...base, latest: [landed, ...base.latest] } }];
    const { container } = render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(2_000);
    await advance(1);
    expect(container.querySelectorAll("footer .animate-pop-in")).toHaveLength(1); // only the new one
    expect(container.querySelector('[data-cue="celebrate"]')!.className).toMatch(/animate-burst/);
  });

  it("the demo renders the fixture on a simulated clock, fetches nothing, and still celebrates arrivals", async () => {
    const { container } = render(<TheaterShell source={{ kind: "demo", slug: "acme", scenario: "running", startAtS: 0 }} />);
    expect(screen.getByText(/demo · fixture data/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Running?" })).toHaveTextContent("Running");
    // The script lands systedo at 80 s into each cycle (theaterFixture.ts).
    await advance(81_000);
    expect(container.querySelector('[data-cue="celebrate"]')).toHaveTextContent(/systedo landed/);
    await advance(DEMO_CYCLE_S * 1000);
    expect(urls).toEqual([]);
  });

  it("the kiosk reads through its token and carries no signed-in controls or ledger link", async () => {
    replies = [{ status: 200, body: fixturePulse({ needsYou: { plans: 1, pausedRepos: 0, runnerPaused: false } }) }];
    render(<TheaterShell source={{ kind: "kiosk", slug: "acme", token: "tok.sig" }} />);
    await advance(0);
    expect(urls[0]).toBe("/api/live/pulse?token=tok.sig");
    expect(screen.getByText("kiosk · read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Notify me/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Share to a kiosk/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open the ledger/ })).toBeNull();
  });

  it("the signed-in theater polls the org pulse route and offers the notifier and the kiosk link", async () => {
    replies = [{ status: 200, body: fixturePulse() }];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(0);
    expect(urls[0]).toBe("/api/org/loop/pulse?org=acme");
    expect(screen.getByRole("button", { name: "Notify me when the runner needs me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share to a kiosk" })).toBeInTheDocument();
  });

  // NOTHING TO REPORT: six components used to answer the same thing. One answers now, and it routes.
  it("no runner: says it once, in the middle, with the way to start one — and the rest stand down", async () => {
    const blank = fixturePulse({
      runner: null,
      run: null,
      lanes: [],
      waiting: [],
      latest: [],
      needsYou: { plans: 0, pausedRepos: 0, runnerPaused: false },
      today: { verifiedCloses: 0, landed: 0, liftPoints: null, spendMicros: 0 },
    });
    replies = [{ status: 200, body: blank }];
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await advance(0);
    expect(screen.getByText("No runner is reporting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start one from the Live tab" })).toHaveAttribute(
      "href",
      "/org/acme?tab=live&view=cockpit",
    );
    // The four questions keep their kickers and answer with nothing; the rail stands down.
    expect(document.querySelector("header[data-quiet]")).not.toBeNull();
    expect(screen.getByLabelText("Running?")).toBeInTheDocument();
    expect(screen.queryByText("No runner")).toBeNull();
    expect(screen.queryByText("Nothing running")).toBeNull();
    expect(screen.queryByText("Nothing waiting")).toBeNull();
    expect(screen.queryByText("Nothing yet today.")).toBeNull();
    expect(screen.queryByText(/verified/)).toBeNull();
  });

  it("no runner on a kiosk: the same statement without a link its viewer cannot open", async () => {
    const blank = fixturePulse({
      runner: null,
      run: null,
      lanes: [],
      waiting: [],
      latest: [],
      needsYou: { plans: 0, pausedRepos: 0, runnerPaused: false },
      today: { verifiedCloses: 0, landed: 0, liftPoints: null, spendMicros: 0 },
    });
    replies = [{ status: 200, body: blank }];
    render(<TheaterShell source={{ kind: "kiosk", slug: "acme", token: "tok.sig" }} />);
    await advance(0);
    expect(screen.getByText("No runner is reporting")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Live tab/ })).toBeNull();
  });

  it("'Enter theater mode' fullscreens the page and holds a screen wake lock", async () => {
    replies = [{ status: 200, body: fixturePulse() }];
    const requestFullscreen = vi.fn(async () => {});
    document.documentElement.requestFullscreen = requestFullscreen;
    const request = vi.fn(async () => ({ release: async () => {} }));
    (navigator as Navigator & { wakeLock?: unknown }).wakeLock = { request };
    render(<TheaterShell source={{ kind: "org", slug: "acme" }} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Enter theater mode" })));
    expect(requestFullscreen).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("screen");
  });
});
