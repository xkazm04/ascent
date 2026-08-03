// @vitest-environment jsdom
//
// Direction 3, UI half: an unmatchable but previously-tracked recommendation must never be a silent
// reset. The user is told HOW MANY were dropped and WHICH, and can re-link each one onto the item in
// this scan that is the same gap — resolving exactly the ambiguity the matcher honestly declined to
// guess at. The panel is an addition to the tracker, so a failed/empty load renders nothing rather
// than an error state.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PersistedRecommendation } from "@/lib/types";
import type { OrphanedTrackedRec } from "@/lib/db/scans-recommendations";
import { OrphanedTracking } from "./OrphanedTracking";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rec(over: Partial<PersistedRecommendation> = {}): PersistedRecommendation {
  return {
    id: "n1",
    title: "The pipeline runs tests without gating on them",
    dimension: "D3" as PersistedRecommendation["dimension"],
    impact: "high" as PersistedRecommendation["impact"],
    effort: "low" as PersistedRecommendation["effort"],
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  };
}

const orphan: OrphanedTrackedRec = {
  dim: "D3",
  title: "CI never gates the tests",
  status: "in_progress",
  assigneeLogin: "octocat",
  targetDate: "2026-09-01",
  fromScanId: "scan_prev",
};

/** GET /orphans returns `items`; any PATCH echoes back the patched row. */
function stubFetch(items: OrphanedTrackedRec[], patched?: PersistedRecommendation) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify(patched ?? rec()), { status: patched ? 200 : 500 });
    }
    return new Response(JSON.stringify({ items }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("OrphanedTracking", () => {
  it("renders nothing when the re-scan carried everything", async () => {
    stubFetch([]);
    const { container } = render(<OrphanedTracking repoRef="acme/web" items={[rec()]} onApplied={() => {}} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing when the lookup fails — the roadmap stays usable", async () => {
    const mock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", mock);
    const { container } = render(<OrphanedTracking repoRef="acme/web" items={[rec()]} onApplied={() => {}} />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many were dropped, and which — with the tracking that was on them", async () => {
    stubFetch([orphan]);
    render(<OrphanedTracking repoRef="acme/web" items={[rec()]} onApplied={() => {}} />);

    expect(await screen.findByText(/1 tracked item couldn’t be carried into this scan/)).toBeInTheDocument();
    expect(screen.getByText("CI never gates the tests")).toBeInTheDocument();
    expect(screen.getByText(/D3 · In progress · @octocat · due 2026-09-01/)).toBeInTheDocument();
  });

  it("re-links an orphan onto the chosen item in this scan, carrying its whole planning state", async () => {
    const target = rec({ id: "n1", status: "in_progress", assigneeLogin: "octocat", targetDate: "2026-09-01" });
    const mock = stubFetch([orphan], target);
    const onApplied = vi.fn();
    render(<OrphanedTracking repoRef="acme/web" items={[rec()]} onApplied={onApplied} />);

    const select = await screen.findByRole("combobox", { name: /Re-link/ });
    fireEvent.change(select, { target: { value: "n1" } });
    fireEvent.click(screen.getByRole("button", { name: "Re-link" }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(target));
    const patch = mock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toMatchObject({
      status: "in_progress",
      assigneeLogin: "octocat",
      targetDate: "2026-09-01",
    });
    // …and the panel stops reporting it without waiting for a reload.
    await waitFor(() => expect(screen.queryByText("CI never gates the tests")).not.toBeInTheDocument());
  });

  it("offers only same-dimension targets, and says so when this scan raised none", async () => {
    stubFetch([orphan]);
    render(
      <OrphanedTracking
        repoRef="acme/web"
        items={[rec({ id: "x", dimension: "D5" as PersistedRecommendation["dimension"] })]}
        onApplied={() => {}}
      />,
    );
    expect(await screen.findByText(/This scan raised nothing in D3/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("surfaces a failed re-link instead of pretending it worked", async () => {
    stubFetch([orphan]); // no `patched` ⇒ PATCH 500s
    render(<OrphanedTracking repoRef="acme/web" items={[rec()]} onApplied={() => {}} />);

    fireEvent.change(await screen.findByRole("combobox", { name: /Re-link/ }), { target: { value: "n1" } });
    fireEvent.click(screen.getByRole("button", { name: "Re-link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn’t re-link/);
    expect(screen.getByText("CI never gates the tests")).toBeInTheDocument(); // still listed
  });
});
