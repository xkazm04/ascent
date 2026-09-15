// @vitest-environment jsdom
//
// Direction 7 — honest skip reasons. The row rendered "skipped (out of credits)" for ANY truthy
// `skipped`, and the hook relabelled every unreported leftover as `insufficient_credits`, while the
// server actually reports three different reasons (insufficient_credits / monthly_quota /
// in_progress) and caps a batch with two more notices the client dropped entirely. The net effect
// these pin against: a public-funnel user who exhausted the FREE monthly allowance was told to top up
// a prepaid balance the select step had just promised they would not need.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ScanRowView } from "./OnboardingScanRow";
import { ScanStep } from "./OnboardingScanStep";
import { useOnboardingFlow } from "./useOnboardingFlow";
import { leftoverSkipReason } from "./skipReason";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("ScanRowView — one reason, one sentence", () => {
  it("names credits, the monthly allowance, and a concurrent run distinctly", () => {
    const { rerender } = render(<ScanRowView row={{ repo: "acme/a", skipped: "insufficient_credits" }} />);
    expect(screen.getByText(/out of credits/i)).toBeTruthy();

    rerender(<ScanRowView row={{ repo: "acme/a", skipped: "monthly_quota" }} />);
    expect(screen.getByText(/monthly free scans/i)).toBeTruthy();
    expect(screen.queryByText(/credits/i)).toBeNull();

    rerender(<ScanRowView row={{ repo: "acme/a", skipped: "in_progress" }} />);
    expect(screen.getByText(/already being scanned/i)).toBeTruthy();

    // An unknown reason claims nothing rather than guessing a billing story.
    rerender(<ScanRowView row={{ repo: "acme/a", skipped: "not_scanned" }} />);
    expect(screen.getByText(/not scanned/i)).toBeTruthy();
  });
});

const stepBase = {
  phase: "done" as const,
  error: null,
  announce: "",
  onCancel: () => {},
  onViewDashboard: () => {},
  onScanAnother: () => {},
};

describe("ScanStep done-screen banners — the recovery matches the reason", () => {
  it("offers a top-up only for a credit shortfall", () => {
    render(<ScanStep {...stepBase} rows={{ "a/b": { repo: "a/b", skipped: "insufficient_credits" } }} />);
    expect(screen.getByText(/top up your prepaid balance/i)).toBeTruthy();
  });

  it("explains the free monthly allowance without mentioning a prepaid top-up", () => {
    render(<ScanStep {...stepBase} rows={{ "a/b": { repo: "a/b", skipped: "monthly_quota" } }} />);
    // Both the row and the banner say it — neither may say "top up your prepaid balance".
    expect(screen.getAllByText(/free scans/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/top up your prepaid balance/i)).toBeNull();
  });

  it("says a concurrent run holds the repo, not that anything is wrong with money", () => {
    render(<ScanStep {...stepBase} rows={{ "a/b": { repo: "a/b", skipped: "in_progress" } }} />);
    expect(screen.getAllByText(/already being scanned/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/credits/i)).toBeNull();
  });

  it("surfaces a batch-level notice that no row can express", () => {
    render(
      <ScanStep
        {...stepBase}
        rows={{ "a/b": { repo: "a/b", level: "L3", overall: 60 } }}
        notices={[{ reason: "listing_truncated", scanning: 50, skipped: 0 }]}
      />,
    );
    expect(screen.getByText(/more repositories than one listing pass/i)).toBeTruthy();
  });

  it("says nothing at all when every repo scanned", () => {
    render(<ScanStep {...stepBase} rows={{ "a/b": { repo: "a/b", level: "L3", overall: 60 } }} />);
    expect(screen.queryByText(/skipped/i)).toBeNull();
    expect(screen.queryByText(/not scanned/i)).toBeNull();
  });
});

describe("leftoverSkipReason", () => {
  it("takes the server's last capping reason, and invents nothing when there is none", () => {
    expect(leftoverSkipReason([])).toBe("not_scanned");
    expect(leftoverSkipReason([{ reason: "monthly_quota", scanning: 1, skipped: 2 }])).toBe("monthly_quota");
    expect(leftoverSkipReason([{ reason: "insufficient_credits", scanning: 1, skipped: 2 }])).toBe(
      "insufficient_credits",
    );
    // A notice that skipped nothing explains nothing.
    expect(leftoverSkipReason([{ reason: "listing_truncated", scanning: 50, skipped: 0 }])).toBe("not_scanned");
  });
});

/** An SSE body: the given frames, then the terminal `result`. */
function sse(frames: [string, unknown][]) {
  const text = [...frames, ["result", { ok: true }] as [string, unknown]]
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

function stubImport(frames: [string, unknown][]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/org/repos"))
        return {
          ok: true,
          json: async () => ({
            repos: [
              { fullName: "acme/web", private: false, language: null, stars: 9, pushedAt: null },
              { fullName: "acme/api", private: false, language: null, stars: 4, pushedAt: null },
            ],
          }),
        };
      if (url.includes("/api/org/import")) return { ok: true, status: 200, body: sse(frames) };
      return { ok: true, json: async () => ({}) };
    }),
  );
}

async function runFlow(frames: [string, unknown][]) {
  stubImport(frames);
  const { result } = renderHook(() => useOnboardingFlow());
  await act(async () => {
    await result.current.loadRepos(undefined, "acme");
  });
  await waitFor(() => expect(result.current.repos).toHaveLength(2));
  await act(async () => {
    await result.current.startScan();
  });
  await waitFor(() => expect(result.current.phase).toBe("done"));
  return result;
}

describe("useOnboardingFlow — the reason the server gave is the reason the user sees", () => {
  it("keeps every notice, and resolves leftovers with the monthly-quota cap rather than credits", async () => {
    const result = await runFlow([
      ["notice", { reason: "monthly_quota", scanning: 1, skipped: 1 }],
      ["repo", { repo: "acme/web", level: "L3", overall: 71 }],
    ]);
    expect(result.current.notices).toEqual([{ reason: "monthly_quota", scanning: 1, skipped: 1 }]);
    // The row the stream never reported: the server said "monthly quota", so the row says so too.
    expect(result.current.rows["acme/api"].skipped).toBe("monthly_quota");
    expect(result.current.rows["acme/web"]).toMatchObject({ level: "L3", overall: 71 });
  });

  it("does not invent a credit shortfall when the server capped nothing", async () => {
    const result = await runFlow([["repo", { repo: "acme/web", level: "L3", overall: 71 }]]);
    expect(result.current.rows["acme/api"].skipped).toBe("not_scanned");
    expect(result.current.notices).toEqual([]);
  });

  it("forwards a truncation/too-many notice instead of dropping it", async () => {
    const result = await runFlow([
      ["notice", { reason: "too_many_repos", scanning: 2, skipped: 3 }],
      ["repo", { repo: "acme/web", level: "L3", overall: 71 }],
      ["repo", { repo: "acme/api", skipped: "in_progress" }],
    ]);
    expect(result.current.notices).toEqual([{ reason: "too_many_repos", scanning: 2, skipped: 3 }]);
    expect(result.current.rows["acme/api"].skipped).toBe("in_progress");
  });
});
