// @vitest-environment jsdom
//
// The drawer as the single onboarding channel (W6c): what it renders in each posture, that doneness is
// SERVER-derived and refreshes on the poll, and that the two stamp writes fire exactly where they should.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { GettingStartedStep, GettingStartedStepId } from "@/lib/org/getting-started";
import type { GettingStartedPayload } from "./tasks";
import { GETTING_STARTED_POLL_MS } from "./useGettingStarted";

const nav = vi.hoisted(() => ({ pathname: "/org/acme", search: "", push: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { TourChecklist } from "./TourChecklist";

const TAB: Record<GettingStartedStepId, GettingStartedStep["tab"]> = {
  "first-scan": "overview",
  "gap-engaged": "followups",
  registry: "skills",
  loop: "repositories",
  team: "members",
};
const PHASE: Record<GettingStartedStepId, GettingStartedStep["phase"]> = {
  "first-scan": "baseline",
  "gap-engaged": "resolve",
  registry: "registry",
  loop: "loop",
  team: "team",
};

function step(id: GettingStartedStepId, over: Partial<GettingStartedStep> = {}): GettingStartedStep {
  return { id, phase: PHASE[id], done: false, available: true, tab: TAB[id], anchor: `${id}-anchor`, ...over };
}

function payload(over: Partial<GettingStartedPayload> = {}): GettingStartedPayload {
  return {
    steps: [step("first-scan"), step("gap-engaged"), step("registry"), step("loop"), step("team")],
    allDone: false,
    personal: false,
    onboarding: { completedAt: null, skippedAt: null, dismissed: false },
    ...over,
  };
}

/** Serve a queue of checklist snapshots (the last repeats) and record every stamp POST. */
function serve(...snapshots: GettingStartedPayload[]) {
  const posts: Array<{ org: string; status: string }> = [];
  let call = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/org/onboarding")) {
      posts.push(JSON.parse(String(init?.body)));
      return { ok: true, json: async () => ({ ok: true, stamped: true }) } as Response;
    }
    const snap = snapshots[Math.min(call++, snapshots.length - 1)]!;
    return { ok: true, json: async () => snap } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts, fetchMock };
}

const drawer = () => document.querySelector("[aria-expanded]")!;
const isOpen = () => drawer().getAttribute("aria-expanded") === "true";

beforeEach(() => {
  nav.pathname = "/org/acme";
  nav.search = "";
  nav.push.mockReset();
  sessionStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TourChecklist — entry intensity by stamp", () => {
  it("opens itself as the companion for an unstamped member with work left", async () => {
    serve(payload());
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(screen.getByText("Set up your dashboard")).toBeTruthy();
    // ONE promoted task with its primary CTA, the rest as a thin rail.
    expect(screen.getByText(/^Next · Baseline$/)).toBeTruthy();
    // W1b: Overview is an explicit ?tab= destination — the bare /org/acme is the landing decision,
    // which for an org with PRs in flight is Live. A "read your baseline" CTA must name the tab.
    expect(screen.getByRole("link", { name: "Open the fleet" }).getAttribute("href")).toBe("/org/acme?tab=overview");
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeTruthy();
  });

  it("stays collapsed and teaching-flavored once the member is stamped", async () => {
    serve(payload({ onboarding: { completedAt: "2026-08-01T00:00:00.000Z", skippedAt: null, dismissed: true } }));
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByText("Learn this dashboard")).toBeTruthy());
    expect(isOpen()).toBe(false);
    expect(screen.queryByRole("button", { name: "Skip setup" })).toBeNull();
    // The teach steps no task claimed stay reachable here.
    expect(screen.getByText("Learn the dashboard")).toBeTruthy();
    expect(screen.getByText("The rail is the journey")).toBeTruthy();
  });

  it("never auto-opens for a non-member, on the demo org, or when everything is done", async () => {
    for (const [slug, p] of [
      ["acme", payload({ onboarding: null })],
      ["public", payload()],
      ["acme", payload({ allDone: true })],
    ] as const) {
      serve(p);
      const view = render(<TourChecklist slug={slug} />);
      await waitFor(() => expect(screen.getByText("Learn this dashboard")).toBeTruthy());
      expect(isOpen()).toBe(false);
      view.unmount();
      sessionStorage.clear();
    }
  });
});

describe("TourChecklist — the task list", () => {
  it("renders server-derived checkmarks and honest n/a rows", async () => {
    serve(
      payload({
        steps: [
          step("first-scan", { done: true }),
          step("gap-engaged"),
          step("loop", { available: false }),
          step("team", { available: false }),
        ],
      }),
    );
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByText("Run your first scan")).toBeTruthy());

    // done/total counts AVAILABLE tasks only (1 of 2 here — the two unavailable ones don't count).
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getAllByText("n/a")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Instrument the loop/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Resolve one gap/ }).hasAttribute("disabled")).toBe(false);
  });

  it("flips a row live on the poll when the underlying work lands", async () => {
    vi.useFakeTimers();
    serve(payload(), payload({ steps: [step("first-scan", { done: true }), step("gap-engaged")] }));
    render(<TourChecklist slug="acme" />);
    await act(async () => {});
    expect(screen.getByText(/^Next · Baseline$/)).toBeTruthy(); // still the first task

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GETTING_STARTED_POLL_MS + 10);
    });
    // The scan completed elsewhere; the drawer promotes the next task without any click in here.
    expect(screen.getByText(/^Next · Resolve$/)).toBeTruthy();
  });

  it("deep-links to the task's tab and spotlights it on “Show me”", async () => {
    serve(payload({ steps: [step("gap-engaged")] }));
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Show me" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(nav.push).toHaveBeenCalledWith("/org/acme?tab=followups");
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });
});

describe("TourChecklist — the stamp writes", () => {
  it("POSTs skipped when the member skips setup, and collapses to the teaching posture", async () => {
    const { posts } = serve(payload());
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(isOpen()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(posts).toEqual([{ org: "acme", status: "skipped" }]);
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(screen.getByText("Learn this dashboard")).toBeTruthy();
  });

  it("POSTs completed exactly once when allDone lands, without a click", async () => {
    vi.useFakeTimers();
    const { posts } = serve(payload({ allDone: true, steps: [step("first-scan", { done: true })] }));
    render(<TourChecklist slug="acme" />);
    await act(async () => {});
    expect(posts).toEqual([{ org: "acme", status: "completed" }]);

    // Every later poll sees the same allDone payload; the one-shot guard must not re-post.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GETTING_STARTED_POLL_MS * 3);
    });
    expect(posts).toHaveLength(1);
  });

  it("does not stamp completion when the caller has no membership row", async () => {
    const { posts } = serve(payload({ allDone: true, onboarding: null }));
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByText("Learn this dashboard")).toBeTruthy());
    expect(posts).toEqual([]);
  });
});
