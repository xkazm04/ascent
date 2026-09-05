// @vitest-environment jsdom

// The Trace panel's honesty rules (#36), the three that would each be an easy and invisible lie:
// an unresolved version must render "—" rather than the neighbour's, an unreachable GitHub must say
// so rather than showing an empty timeline, and a hosted skill must not be offered a Trace at all.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock("./skillTrace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skillTrace")>();
  return { ...actual, fetchSkillTrace: mockFetch };
});

import { SkillTracePanel } from "./SkillTracePanel";
import { SkillTraceTimeline } from "./SkillTraceTimeline";

const entry = (sha: string, version: string | null, day = "25") => ({
  sha,
  authoredAt: `2026-08-${day}T00:00:00.000Z`,
  authorLogin: "someone",
  message: "skills: sharpen it",
  version,
});

const lesson = (id: string, versionUsed: string) => ({
  id,
  versionUsed,
  learnedOn: "2026-08-20T00:00:00.000Z",
  project: "checkout-service",
  headingRaw: `## ${versionUsed} - 2026-08-20 - checkout-service`,
  body: "- what it taught",
});

beforeEach(() => vi.clearAllMocks());

/** jsdom does not fire `toggle` from a click on <summary>, so the disclosure is opened the way the
 *  browser would leave it and the event is dispatched explicitly. */
function openDetails(container: HTMLElement) {
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: true }));
}

describe("SkillTraceTimeline", () => {
  it("renders an unresolved version as an em dash, never as the neighbour's", () => {
    render(<SkillTraceTimeline entries={[entry("c2", "2.1.0", "25"), entry("c1", null, "10")]} lessons={[]} truncated={false} />);
    expect(screen.getByText("v2.1.0")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("version not resolved")).toBeTruthy();
  });

  it("labels a lesson whose version matches no commit instead of filing it under the newest", () => {
    render(<SkillTraceTimeline entries={[entry("c2", "2.1.0")]} lessons={[lesson("l1", "1.0.0")]} truncated={false} />);
    expect(screen.getByText(/version not in the last 30 commits/)).toBeTruthy();
  });

  it("hangs a matching lesson under its own version", () => {
    render(<SkillTraceTimeline entries={[entry("c2", "2.1.0")]} lessons={[lesson("l1", "2.1.0")]} truncated={false} />);
    expect(screen.getByText("- what it taught")).toBeTruthy();
    expect(screen.queryByText(/version not in the last/)).toBeNull();
  });

  it("discloses a truncated history rather than presenting it as the whole one", () => {
    render(<SkillTraceTimeline entries={[entry("c1", "1.0.0")]} lessons={[]} truncated />);
    expect(screen.getByText(/older commits exist beyond the read budget/)).toBeTruthy();
  });
});

describe("SkillTracePanel", () => {
  it("fetches only when opened, not on mount", async () => {
    render(<SkillTracePanel slug="acme" skill="forge" />);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows HISTORY UNAVAILABLE rather than an empty timeline", async () => {
    mockFetch.mockResolvedValue({
      skill: "forge",
      path: "",
      headSha: "",
      entries: [],
      truncated: false,
      lessons: [],
      cached: false,
      error: "History is unavailable — rate limited.",
    });
    const { container } = render(<SkillTracePanel slug="acme" skill="forge" />);
    openDetails(container);
    await waitFor(() => expect(screen.getByText(/History is unavailable/)).toBeTruthy());
  });

  it("labels a stale cache as stale", async () => {
    mockFetch.mockResolvedValue({
      skill: "forge",
      path: "p",
      headSha: "old",
      entries: [entry("c1", "1.0.0")],
      truncated: false,
      lessons: [],
      cached: true,
      stale: true,
    });
    const { container } = render(<SkillTracePanel slug="acme" skill="forge" />);
    openDetails(container);
    await waitFor(() => expect(screen.getByText(/GitHub is unreachable right now/)).toBeTruthy());
  });
});
