// @vitest-environment jsdom
//
// W6b: the header scan button's one-shot auto-start — the dashboard half of the wizard's
// preview-then-upgrade handoff. Pins that (1) a fresh flag for THIS org fires exactly one
// POST /api/org/scan scoped to the flagged repos, (2) a remount (refresh) does NOT re-fire — the
// flag is consumed before the run starts, and (3) a flag for a different org never starts anything
// here (and survives for the org it names).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useOrgScanButton } from "./useOrgScanButton";
import { setUpgradeScanFlag } from "@/components/onboarding/upgradeScan";

let bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies = [];
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/org/scan")) {
        bodies.push(JSON.parse(String(init?.body)));
        // Refuse after capturing the body — the assertions are about what was SENT and how often.
        return { ok: false, status: 503, body: null, json: async () => ({ error: "stub" }) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
});

afterEach(() => vi.restoreAllMocks());

describe("useOrgScanButton — preview-then-upgrade auto-start", () => {
  it("consumes the flag on mount and fires ONE live scan scoped to the flagged repos", async () => {
    setUpgradeScanFlag("acme", ["acme/api", "acme/web"]);
    renderHook(() => useOrgScanButton("acme", 2));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ org: "acme", repos: ["acme/api", "acme/web"] });
  });

  it("does NOT re-fire on a remount (refresh) — the flag is one-shot", async () => {
    setUpgradeScanFlag("acme", ["acme/api"]);
    const first = renderHook(() => useOrgScanButton("acme", 1));
    await waitFor(() => expect(bodies).toHaveLength(1));
    first.unmount();
    renderHook(() => useOrgScanButton("acme", 1));
    // Give any (wrong) second effect a tick to fire, then assert it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(bodies).toHaveLength(1);
  });

  it("ignores a flag written for a DIFFERENT org and leaves it in place", async () => {
    setUpgradeScanFlag("globex", ["globex/api"]);
    renderHook(() => useOrgScanButton("acme", 3));
    await new Promise((r) => setTimeout(r, 10));
    expect(bodies).toHaveLength(0);
    expect(sessionStorage.getItem("ascent.upgrade-scan.v1")).toContain("globex");
  });

  it("still fires when the layout reports 0 watched repos — the flag names its own work list", async () => {
    // The manual "Scan all watched (0)" button stays refused (nothing to walk), but a scoped run
    // carries its repos; a stale/cached watchedCount must not swallow the handoff.
    setUpgradeScanFlag("acme", ["acme/api"]);
    renderHook(() => useOrgScanButton("acme", 0));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ org: "acme", repos: ["acme/api"] });
  });

  it("matches the org case-insensitively (wizard writes the GitHub handle, the URL may be lower-cased)", async () => {
    setUpgradeScanFlag("Acme-Corp", ["Acme-Corp/api"]);
    renderHook(() => useOrgScanButton("acme-corp", 1));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ org: "acme-corp", repos: ["Acme-Corp/api"] });
  });

  it("mounts idle (no auto-start) when no flag exists", async () => {
    const { result } = renderHook(() => useOrgScanButton("acme", 3));
    await new Promise((r) => setTimeout(r, 10));
    expect(bodies).toHaveLength(0);
    expect(result.current.p.running).toBe(false);
  });
});
