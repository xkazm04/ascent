// @vitest-environment jsdom
//
// Direction 3 — per-repo retry on the done screen. One failed row out of ten used to cost the user the
// entire wizard: the only recovery was "Scan another" → resetRun → pick step, everything cleared.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { ScanRowView } from "./OnboardingScanRow";
import { retryRowMessage } from "./retryRepo";
import { resetAutoWatchOptIn, setAutoWatchOptIn } from "./OnboardingSelectStep.watchOptIn";
import { resetPreviewFirst, setPreviewFirst } from "./OnboardingSelectStep.previewFirst";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetAutoWatchOptIn();
  resetPreviewFirst();
});

/** An SSE body that emits one successful `repo` event for `repo`, then the terminal `result`. */
function sseBody(repo: string) {
  const frames = [
    `event: repo\ndata: ${JSON.stringify({ repo, level: "L3", overall: 71 })}\n\n`,
    `event: result\ndata: ${JSON.stringify({ ok: true })}\n\n`,
  ].join("");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
      controller.close();
    },
  });
}

describe("useOnboardingFlow.retryRepo — one row recovers without touching its siblings", () => {
  it("re-runs JUST the errored repo: error → scanning → done, one POST, siblings untouched", async () => {
    const imports: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/org/repos")) {
          return {
            ok: true,
            json: async () => ({
              repos: [
                { fullName: "acme/web", private: false, language: "TS", stars: 9, pushedAt: null },
                { fullName: "acme/api", private: false, language: "Go", stars: 4, pushedAt: null },
              ],
            }),
          };
        }
        if (url.includes("/api/org/import")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { repos: string[] };
          imports.push(body.repos);
          return { ok: true, status: 200, body: sseBody(body.repos[0]) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadRepos(undefined, "acme");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));

    // Land on a done screen with one failed row and one good row (the shape the batch leaves behind).
    act(() => {
      result.current.setRows({
        "acme/web": { repo: "acme/web", level: "L4", overall: 82 },
        "acme/api": { repo: "acme/api", error: "Scan failed." },
      });
      result.current.setPhase("done");
    });

    await act(async () => {
      await result.current.retryRepo("acme/api");
    });

    // Exactly one import POST, for exactly the retried repo.
    expect(imports).toEqual([["acme/api"]]);
    // The row settled on its new result…
    expect(result.current.rows["acme/api"]).toMatchObject({ repo: "acme/api", level: "L3", overall: 71 });
    expect(result.current.rows["acme/api"].error).toBeUndefined();
    // …and the sibling is byte-for-byte what it was.
    expect(result.current.rows["acme/web"]).toEqual({ repo: "acme/web", level: "L4", overall: 82 });
    // The done screen is still the done screen — a retry is not a new run.
    expect(result.current.phase).toBe("done");
  });

  it("guards a double-click synchronously — two clicks, one POST", async () => {
    let resolveImport: ((v: unknown) => void) | null = null;
    const imports: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/org/repos")) {
          return {
            ok: true,
            json: async () => ({ repos: [{ fullName: "acme/api", private: false, language: null, stars: 0, pushedAt: null }] }),
          };
        }
        if (url.includes("/api/org/import")) {
          imports.push(JSON.parse(String(init?.body ?? "{}")).repos);
          // Hang until released, so the second click lands while the first is still in flight.
          return new Promise((res) => {
            resolveImport = () => res({ ok: true, status: 200, body: sseBody("acme/api") });
          });
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadRepos(undefined, "acme");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(1));
    act(() => {
      result.current.setRows({ "acme/api": { repo: "acme/api", error: "Scan failed." } });
    });

    let first: Promise<void>;
    let second: Promise<void>;
    await act(async () => {
      first = result.current.retryRepo("acme/api");
      second = result.current.retryRepo("acme/api"); // the double-click
      await waitFor(() => expect(imports.length).toBeGreaterThan(0));
      resolveImport?.(null);
      await Promise.all([first, second]);
    });

    expect(imports).toEqual([["acme/api"]]);
    expect(result.current.rows["acme/api"]).toMatchObject({ level: "L3", overall: 71 });
  });
});

describe("ScanRowView retry affordance", () => {
  it("offers Retry on an errored row and calls back with that repo", () => {
    const onRetry = vi.fn();
    render(<ScanRowView row={{ repo: "acme/api", error: "Scan failed." }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry acme\/api/i }));
    expect(onRetry).toHaveBeenCalledWith("acme/api");
  });

  it("offers no Retry on a healthy or skipped row", () => {
    const { rerender } = render(<ScanRowView row={{ repo: "acme/web", level: "L4", overall: 82 }} onRetry={() => {}} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    rerender(<ScanRowView row={{ repo: "acme/web", skipped: "insufficient_credits" }} onRetry={() => {}} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

describe("retryRowMessage", () => {
  it("never leaves a raw auth-API string in the row", () => {
    expect(
      retryRowMessage(
        { aborted: false, stalled: false, status: 401, message: "Sign in to manage this organization." },
        "acme",
      ),
    ).toBe("Sign in to rescan.");
    expect(retryRowMessage({ aborted: true, stalled: true }, "acme")).toMatch(/stalled/i);
    // A genuine failure keeps its diagnostic.
    expect(retryRowMessage({ aborted: false, stalled: false, status: 500, message: "Import failed (500)." }, "acme")).toBe(
      "Import failed (500).",
    );
  });
});

// Direction 6 — the retry POST carries the consent the SELECT step obtained.
//
// The body used to be { org, repos, installationId, mock } and nothing else. `watch` omitted means
// runImportScan defaults it to Boolean(installationId) — true on the App path — and the server then
// falls through to the weekly schedule: ONE Retry click re-subscribed that repo to the recurring
// billable autoscan the user declined on the select step. `publicFunnel` omitted means a public-handle
// retry is credit-metered server-side, so it hits the 401/402 wall right after the select step
// promised "No prepaid credits are used". These pin the full body on both paths.
describe("runRepoRetry — the request body honours the select step's consent", () => {
  /** Capture every /api/org/import body; the import POST fails right after, since the assertion is
   *  about what was SENT (and a failed retry leaves a terminal row rather than hanging). */
  function stubFetch(bodies: Record<string, unknown>[], repos: { fullName: string }[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/app/repos") || url.includes("/api/org/repos"))
          return {
            ok: true,
            json: async () => ({
              repos: repos.map((r) => ({ ...r, private: false, language: null, stars: 1, pushedAt: null })),
            }),
          };
        if (url.includes("/api/org/credits"))
          return { ok: true, json: async () => ({ balance: 10, unlimited: false, allowanceRemaining: 0 }) };
        if (url.includes("/api/org/import")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return { ok: false, status: 500, body: null, json: async () => ({ error: "stub" }) };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
  }

  it("App path, autoscan NOT opted into: watch travels as an explicit false", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(bodies, [{ fullName: "acme/api" }]);
    // The direct (non-upgrade) App wire — "fast preview first" has its own plan, pinned below.
    setPreviewFirst(false);
    resetAutoWatchOptIn();

    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadInstallationRepos("acme", "42");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(1));
    act(() => {
      result.current.setRows({ "acme/api": { repo: "acme/api", error: "Scan failed." } });
      result.current.setPhase("done");
    });
    await act(async () => {
      await result.current.retryRepo("acme/api");
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      org: "acme",
      repos: ["acme/api"],
      installationId: "42",
      mock: false,
      watch: false,
    });
    // No cadence is sent when nothing is being watched — the weekly default must not ride along.
    expect(bodies[0].schedule).toBeUndefined();
  });

  it("App path, autoscan opted into: watch:true rides with the weekly cadence", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(bodies, [{ fullName: "acme/api" }]);
    setPreviewFirst(false);
    setAutoWatchOptIn(true);

    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadInstallationRepos("acme", "42");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(1));
    act(() => {
      result.current.setRows({ "acme/api": { repo: "acme/api", error: "Scan failed." } });
    });
    await act(async () => {
      await result.current.retryRepo("acme/api");
    });

    expect(bodies[0]).toMatchObject({ watch: true, schedule: "weekly" });
  });

  it("public path: publicFunnel:true, no installation, no watch", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetch(bodies, [{ fullName: "acme/web" }]);

    const { result } = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await result.current.loadRepos(undefined, "acme");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(1));
    act(() => {
      result.current.setRows({ "acme/web": { repo: "acme/web", error: "Scan failed." } });
    });
    await act(async () => {
      await result.current.retryRepo("acme/web");
    });

    expect(bodies[0]).toMatchObject({ org: "acme", repos: ["acme/web"], publicFunnel: true, watch: false, mock: false });
    expect(bodies[0].installationId).toBeUndefined();
  });
});
