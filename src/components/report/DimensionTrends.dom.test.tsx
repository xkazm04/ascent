// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { RepositoryHistory } from "@/lib/db/scans";
import { DimensionTrends } from "./DimensionTrends";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(() => vi.restoreAllMocks());

function scan(day: number, score: number, dims: { dimId: string; score: number }[], engineProvider = "claude-cli") {
  return {
    id: `s${day}`,
    headSha: null,
    overallScore: score,
    level: "L3",
    levelName: "Managed",
    confidence: 0.9,
    engineProvider,
    engineModel: "m",
    scannedAt: `2026-07-${String(day).padStart(2, "0")}T09:00:00.000Z`,
    dimensions: dims,
  };
}

/** The lightweight, overall-only payload the server passes (no per-dimension rows). */
function serverHistory(engines: string[] = ["claude-cli", "claude-cli"]): RepositoryHistory {
  return {
    repo: { owner: "acme", name: "app", fullName: "acme/app" },
    scans: engines.map((e, i) => scan(i + 1, 60 + i, [], e)),
  } as unknown as RepositoryHistory;
}

function stubHistoryFetch(body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
}

// G5-25. `loadDimensions` flipped to "done" on ANY non-throwing response. A degraded payload — scans
// present but every `dimensions` array emptied by the validator dropping malformed rows — then
// rendered all nine dimension cards as "—" as if the load had succeeded, masking real data loss
// beside an overall chart that plainly has data.

describe("DimensionTrends degraded per-dimension payload", () => {
  it("treats scans-with-no-dimensions as a load FAILURE, offering the retry instead of empty cards", async () => {
    // Malformed dimension rows (no numeric score) are dropped by parseRepositoryHistory, leaving the
    // scan with `dimensions: []` — the exact degraded shape.
    stubHistoryFetch({
      repo: { owner: "acme", name: "app", fullName: "acme/app" },
      scans: [
        { ...scan(1, 60, []), dimensions: [{ dimId: "D1", score: "not a number" }] },
        { ...scan(2, 61, []), dimensions: [] },
      ],
    });

    render(<DimensionTrends history={serverHistory()} />);

    await waitFor(() => expect(screen.getByText(/couldn't load the per-dimension breakdown/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // The nine "—" placeholder cards must NOT be presented as a finished result.
    expect(screen.queryByText("AI Tooling & Conventions")).not.toBeInTheDocument();
    // …while the overall chart above still renders its real data.
    expect(screen.getByRole("img", { name: /overall score over time/i })).toBeInTheDocument();
  });

  it("renders the dimension cards when the payload actually carries per-dimension data", async () => {
    stubHistoryFetch({
      repo: { owner: "acme", name: "app", fullName: "acme/app" },
      scans: [scan(2, 61, [{ dimId: "D1", score: 70 }]), scan(1, 60, [{ dimId: "D1", score: 65 }])],
    });

    render(<DimensionTrends history={serverHistory()} />);

    await waitFor(() => expect(screen.getByText("AI Tooling & Conventions")).toBeInTheDocument());
    expect(screen.queryByText(/couldn't load the per-dimension breakdown/i)).not.toBeInTheDocument();
    // A dimension the payload never scored shows the honest "no trend data" placeholder, not a flat line.
    expect(screen.getAllByText("No trend data").length).toBeGreaterThan(0);
  });

  it("does not report a failure when the repo genuinely has no scans at all", async () => {
    stubHistoryFetch({ repo: { owner: "acme", name: "app", fullName: "acme/app" }, scans: [] });
    render(<DimensionTrends history={serverHistory()} />);
    await waitFor(() => expect(screen.getByText("AI Tooling & Conventions")).toBeInTheDocument());
    expect(screen.queryByText(/couldn't load the per-dimension breakdown/i)).not.toBeInTheDocument();
  });
});

// G5-30, small-multiples half: one legend for the whole grid rather than nine copies.
describe("DimensionTrends mock-engine legend", () => {
  it("shows the hollow-point legend once when any plotted scan was mock-scored", async () => {
    stubHistoryFetch({
      repo: { owner: "acme", name: "app", fullName: "acme/app" },
      scans: [scan(2, 61, [{ dimId: "D1", score: 70 }], "mock"), scan(1, 60, [{ dimId: "D1", score: 65 }], "claude-cli")],
    });
    render(<DimensionTrends history={serverHistory(["mock", "claude-cli"])} />);
    await waitFor(() => expect(screen.getByText("AI Tooling & Conventions")).toBeInTheDocument());
    expect(screen.getAllByText(/hollow points are demo scans/i)).toHaveLength(2); // overall chart + grid
  });

  it("shows no legend when every plotted scan was model-scored", async () => {
    stubHistoryFetch({
      repo: { owner: "acme", name: "app", fullName: "acme/app" },
      scans: [scan(2, 61, [{ dimId: "D1", score: 70 }]), scan(1, 60, [{ dimId: "D1", score: 65 }])],
    });
    render(<DimensionTrends history={serverHistory()} />);
    await waitFor(() => expect(screen.getByText("AI Tooling & Conventions")).toBeInTheDocument());
    expect(screen.queryByText(/hollow points are demo scans/i)).not.toBeInTheDocument();
  });
});
