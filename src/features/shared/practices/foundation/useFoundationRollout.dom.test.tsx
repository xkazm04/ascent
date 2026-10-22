// @vitest-environment jsdom
//
// The report-back dialog's failure path: a 403 for missing Secrets write names the App's Configure
// page as the next action, instead of the generic "GitHub refused the write".

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useFoundationRollout } from "./useFoundationRollout";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

describe("useFoundationRollout report-back failure", () => {
  it("a missing-permission failure sets an action to the App's configure URL", async () => {
    const url = "https://github.com/settings/installations/4242";
    stubFetch({ results: [{ repo: "a/one", ok: false, reason: "missing-permission", configureUrl: url, error: "no" }] });
    const { result } = renderHook(() => useFoundationRollout("a", []));
    act(() => result.current.setDialog({ repo: "a/one", mode: "provision" }));
    await act(async () => result.current.submitDialog("a/one"));
    expect(result.current.dialogAction).toEqual({ label: "Grant Secrets write", href: url });
    expect(result.current.dialogError).toContain(url);
    expect(result.current.dialogError).not.toContain("GitHub refused the write");
    expect(result.current.dialogError).not.toContain("\u2014");
  });

  it("any other failure keeps no action", async () => {
    stubFetch({ results: [{ repo: "a/one", ok: false, reason: "write-failed", error: "Boom." }] });
    const { result } = renderHook(() => useFoundationRollout("a", []));
    act(() => result.current.setDialog({ repo: "a/one", mode: "provision" }));
    await act(async () => result.current.submitDialog("a/one"));
    expect(result.current.dialogAction).toBeNull();
    expect(result.current.dialogError).toBe("Boom.");
  });
});
