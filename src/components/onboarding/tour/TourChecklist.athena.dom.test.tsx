// @vitest-environment jsdom
//
// THE ABSORB: Athena is a posture of the one right-edge drawer, not a second floating surface.
//
// A sibling file rather than more cases in `TourChecklist.dom.test.tsx`, which owns the entry-intensity
// and stamp rules and carries its own mock setup. These four are the properties the absorb had to keep:
// only one channel exists, the checklist is unchanged underneath it, the conversation is not thrown
// away by switching back, and the demo org — whose conversations the API refuses outright — is not
// offered a door that leads to a 403.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { GettingStartedPayload } from "./tasks";

const nav = vi.hoisted(() => ({ pathname: "/org/acme", search: "", push: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { TourChecklist } from "./TourChecklist";

const payload = (): GettingStartedPayload => ({
  steps: [
    { id: "first-scan", phase: "baseline", done: false, available: true, tab: "overview", anchor: "results-view" },
  ],
  allDone: false,
  personal: false,
  onboarding: { completedAt: null, skippedAt: null, dismissed: false },
});

/** Count the boot reads so "mounted once, then hidden" is observable rather than assumed. */
function serve() {
  const boots: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/athena/threads")) {
        boots.push(url);
        return {
          ok: true,
          json: async () => ({ thread: null, turns: [], proposals: [], degraded: false }),
        } as Response;
      }
      return { ok: true, json: async () => payload() } as Response;
    }),
  );
  return { boots };
}

const toAthena = () => fireEvent.click(screen.getByRole("button", { name: "Athena" }));
const toSetup = () => fireEvent.click(screen.getByRole("button", { name: "Setup" }));

beforeEach(() => {
  nav.pathname = "/org/acme";
  nav.push.mockReset();
  sessionStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("TourChecklist — the Athena posture", () => {
  it("switches channel inside the SAME drawer, adding no second floating surface", async () => {
    serve();
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByText("Set up your dashboard")).toBeTruthy());
    // One drawer: exactly one thing on the page discloses (the pull tab).
    expect(document.querySelectorAll("[aria-expanded]")).toHaveLength(1);

    await act(async () => {
      toAthena();
    });
    await waitFor(() => expect(screen.getByLabelText("Ask Athena")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Athena" })).toBeTruthy();
    // Still one drawer, still one discloser — she did not bring her own launcher.
    expect(document.querySelectorAll("[aria-expanded]")).toHaveLength(1);
    expect(document.querySelectorAll("aside")).toHaveLength(1);
  });

  it("speaks the checklist's next step rather than deriving its own", async () => {
    serve();
    render(<TourChecklist slug="acme" />);
    // The promoted card and its rail row both carry the title, hence getAllBy.
    await waitFor(() => expect(screen.getAllByText("Run your first scan").length).toBeGreaterThan(0));
    await act(async () => {
      toAthena();
    });
    // The same step the checklist promoted, in her voice.
    await waitFor(() => expect(screen.getByText(/The next thing waiting on you here is/)).toBeTruthy());
    expect(screen.getByText(/Run your first scan/)).toBeTruthy();
  });

  it("keeps the conversation alive across a switch back to the checklist", async () => {
    const { boots } = serve();
    render(<TourChecklist slug="acme" />);
    await waitFor(() => expect(screen.getByText("Set up your dashboard")).toBeTruthy());

    await act(async () => {
      toAthena();
    });
    await waitFor(() => expect(boots).toHaveLength(1));

    // Back to setup: the checklist is intact and her panel is HIDDEN, not unmounted.
    await act(async () => {
      toSetup();
    });
    expect(screen.getAllByText("Run your first scan").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Ask Athena")).toBeTruthy();

    await act(async () => {
      toAthena();
    });
    // A second boot would mean the conversation had been thrown away and rebuilt.
    expect(boots).toHaveLength(1);
  });

  it("offers no channel switch on the demo org, whose conversations the API refuses", async () => {
    serve();
    render(<TourChecklist slug="public" />);
    await waitFor(() => expect(screen.getByText("Learn this dashboard")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Athena" })).toBeNull();
  });
});
