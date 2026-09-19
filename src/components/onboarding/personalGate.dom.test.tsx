// @vitest-environment jsdom
//
// Direction 2 — serve the personal tier a real answer. An individual who installs the App on their
// own GitHub account and picks it in the wizard hit requireFleetOrg's 403, whose message quotes an
// INTERNAL API ROUTE at an end user ("track repos via /api/me/watch and rescan through the public
// report flow"), and the wizard had no personal branch at all. This pins: upfront detection, the
// 403 fallback, the handoff (copy + /me CTA + watch intents), and that the raw string never renders.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { GateStep } from "./OnboardingGateStep";
import { classifyScanFailure } from "./scanGate";

const FLEET_403 =
  "This is a fleet operation. Personal workspaces track repos via /api/me/watch and rescan through the public report flow.";

const REPOS = [
  { fullName: "dana/notes", private: false, language: "TS", stars: 1, pushedAt: null },
  { fullName: "dana/secret", private: true, language: "Go", stars: 0, pushedAt: null },
];

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function stubFetch(importStatus = 200, importError = "") {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/org/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
      if (url.includes("/api/org/import")) {
        return { ok: false, status: importStatus, body: null, json: async () => ({ error: importError }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }),
  );
  return calls;
}

describe("useOnboardingFlow — the personal tier gets a handoff, not a 403", () => {
  it("refuses UPFRONT when the target is the viewer's personal workspace — no doomed import POST", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useOnboardingFlow({ personalOrg: "dana" }));

    await act(async () => {
      await result.current.loadRepos(undefined, "dana");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.gate).toEqual({ kind: "personal", org: "dana" });
    expect(result.current.error).toBeNull();
    // The whole point of "upfront": the import was never attempted.
    expect(calls.some((u) => u.includes("/api/org/import"))).toBe(false);
    // The wizard did not pretend to scan.
    expect(result.current.phase).toBe("select");
  });

  it("falls back to catching requireFleetOrg's 403 when the workspace kind wasn't known upfront", async () => {
    stubFetch(403, FLEET_403);
    const { result } = renderHook(() => useOnboardingFlow()); // no personalOrg — e.g. signed-out render

    await act(async () => {
      await result.current.loadRepos(undefined, "dana");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));
    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.gate).toEqual({ kind: "personal", org: "dana" });
    // The internal-route string is NOT what the user is left holding.
    expect(result.current.error).toBeNull();
  });

  it("keeps a FLEET org's 403 on the plain no-access gate", () => {
    expect(
      classifyScanFailure({ status: 403, message: "You don't have access to this organization." }, "acme"),
    ).toEqual({ kind: "no-access", org: "acme" });
  });

  it("leaves a fleet org's happy path untouched (no gate, real import attempt)", async () => {
    const calls = stubFetch(500, "Import failed (500).");
    const { result } = renderHook(() => useOnboardingFlow({ personalOrg: "dana" }));
    await act(async () => {
      await result.current.loadRepos(undefined, "acme");
    });
    await waitFor(() => expect(result.current.repos).toHaveLength(2));
    await act(async () => {
      await result.current.startScan();
    });
    expect(calls.some((u) => u.includes("/api/org/import"))).toBe(true);
    expect(result.current.gate).toBeNull();
  });
});

describe("PersonalHandoff (the gate's personal branch)", () => {
  const gate = { kind: "personal" as const, org: "dana" };

  it("explains the workspace in human words and offers the /me front door — never the API route", () => {
    render(<GateStep gate={gate} auth="supabase" selectedCount={2} selectedRepos={REPOS} onBack={() => {}} />);
    expect(screen.getByRole("link", { name: /open your workspace/i }).getAttribute("href")).toBe("/me");
    expect(document.body.textContent).not.toMatch(/\/api\/me\/watch/);
    expect(document.body.textContent).not.toMatch(/fleet operation/i);
    expect(document.body.textContent).toMatch(/personal workspace/i);
  });

  it("carries the PUBLIC picks over as watch intents and discloses the private ones it left out", async () => {
    const posts: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        posts.push({ url: String(url), body: String(init?.body ?? "") });
        return { ok: true, json: async () => ({ ok: true }) };
      }),
    );

    render(<GateStep gate={gate} auth="supabase" selectedCount={2} selectedRepos={REPOS} onBack={() => {}} />);
    // One of the two picks is private — personal workspaces track public repos only.
    expect(document.body.textContent).toMatch(/1 private/i);

    fireEvent.click(screen.getByRole("button", { name: /track 1 repository/i }));
    await waitFor(() => expect(screen.getByText(/now tracking/i)).toBeInTheDocument());

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/me/watch");
    expect(JSON.parse(posts[0].body)).toEqual({ repo: "dana/notes", watched: true });
  });

  it("reports a refusal (e.g. the personal cap) instead of claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        json: async () => ({ error: "Personal watchlists are capped at 10 repositories." }),
      })),
    );
    render(<GateStep gate={gate} auth="supabase" selectedCount={1} selectedRepos={[REPOS[0]]} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /track 1 repository/i }));
    await waitFor(() => expect(screen.getByText(/capped at 10 repositories/i)).toBeInTheDocument());
    expect(screen.queryByText(/now tracking/i)).toBeNull();
  });
});
