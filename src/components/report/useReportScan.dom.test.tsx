// @vitest-environment jsdom
//
// The PRE-STREAM refusals of /api/scan/stream — the three JSON responses the scan hook can get back
// before any SSE frame exists (401 sign-in wall, 402 out-of-credits, 429 monthly quota). These are
// the branches that decide whether the user sees an actionable wall or a dead-end "Try again", and
// until now the hook had no tests at all: the 402 fell through to the generic error, so an org out
// of credits was told "Couldn't scan that repo" with a retry that re-trips the same gate.
//
// Every case runs with `initialFresh: true` so the hook skips its cache peek and the POST to
// /api/scan/stream is the first request — the refusal under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useReportScan } from "./useReportScan";

type Reply = { status: number; body: unknown; ok?: boolean };
/** URL → reply. `stream` is the POST; `peek` is the quota-salvage GET. */
let replies: { stream: Reply; peek?: Reply };
let calls: string[];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const reply = url.startsWith("/api/scan/stream") ? replies.stream : (replies.peek ?? { status: 204, body: null });
      return {
        ok: reply.ok ?? (reply.status >= 200 && reply.status < 300),
        status: reply.status,
        // The hook's refusal branch is `!res.ok || !res.body` — a JSON refusal carries no stream.
        body: null,
        headers: new Headers(),
        json: async () => reply.body,
      } as unknown as Response;
    }),
  );
}

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

const runScan = () => renderHook(() => useReportScan("acme/app", true));

describe("useReportScan — pre-stream refusals", () => {
  it("402 INSUFFICIENT_CREDITS becomes a credits-classified error carrying the balance", async () => {
    replies = {
      stream: {
        status: 402,
        body: {
          error: "This organization is out of private-scan credits. Add credits to continue.",
          code: "INSUFFICIENT_CREDITS",
          balance: 0,
        },
      },
    };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toEqual({ balance: 0 });
    // Not misfiled as one of the other walls, and not the generic transient failure.
    expect(state.blocked).toBeUndefined();
    expect(state.authRequired).toBeUndefined();
    expect(state.message).toMatch(/credits/i);
    // A 402 is terminal for this request: no salvage peek, no second attempt.
    expect(calls).toEqual(["/api/scan/stream"]);
  });

  it("keeps a non-zero balance rather than flattening it to 0", async () => {
    replies = { stream: { status: 402, body: { code: "INSUFFICIENT_CREDITS", balance: 3 } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toEqual({ balance: 3 });
  });

  it("401 auth_required becomes the sign-in class", async () => {
    replies = { stream: { status: 401, body: { error: "Sign in to run a scan.", code: "auth_required" } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.authRequired).toBe(true);
    expect(state.credits).toBeUndefined();
  });

  it("429 monthly_quota becomes the quota class with its attribution scope", async () => {
    replies = {
      stream: { status: 429, body: { error: "Out of free scans.", code: "monthly_quota", scope: "user", resetAt: 1 } },
      // Salvage peek finds nothing saved for this repo → the blocked wall stands.
      peek: { status: 204, body: null },
    };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    // The reset horizon rides along so the re-scan banner can say when the window reopens.
    expect(state.blocked).toEqual({ scope: "user", resetAt: 1 });
    expect(state.credits).toBeUndefined();
    // The quota branch — unlike the 401/402 ones — tries the salvage peek before walling.
    expect(calls.some((u) => u.includes("peek=1&latest=1"))).toBe(true);
  });

  it("an unclassified refusal stays the generic (retryable) failure", async () => {
    replies = { stream: { status: 500, body: { error: "Boom." } } };
    const { result } = runScan();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    const state = result.current.state;
    if (state.status !== "error") throw new Error("expected an error state");
    expect(state.credits).toBeUndefined();
    expect(state.blocked).toBeUndefined();
    expect(state.authRequired).toBeUndefined();
    expect(state.notFound).toBeUndefined();
  });
});
