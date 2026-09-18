// @vitest-environment jsdom
//
// THE DRIVE HOOK WITH A STANDING RUNNER (spark theater-upgrade, 2026-09-18):
//   - a runner that is `paused` or `idle` is LIVE — it is waiting, not over — so the poll keeps
//     running through the pause, and sees it lift, and nothing is handed up as "settled";
//   - the poll is a chain: no read starts beside another, and a hidden tab reads nothing;
//   - `resumeRepo` posts `action: "resume-repo"` and adopts the runner the route hands back.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDrive } from "./useDrive";
import { repoState, runnerDrive } from "./runner.fixture";

let payloads: unknown[] = [];
let calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];

beforeEach(() => {
  calls = [];
  payloads = [{ enabled: true, drives: [runnerDrive({ phase: "paused", pausedReason: "session-limit" })] }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, url, body });
      if (method === "GET") {
        const next = payloads.length > 1 ? payloads.shift() : payloads[0];
        return { ok: true, json: async () => next } as Response;
      }
      return { ok: true, json: async () => ({ drive: runnerDrive({ repoState: [repoState({ repo: "acme/web" })] }) }) } as Response;
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

const gets = () => calls.filter((c) => c.method === "GET").length;

describe("useDrive — a standing runner", () => {
  it("keeps polling a paused runner, sees the pause lift, and never settles it", async () => {
    payloads = [
      { enabled: true, drives: [runnerDrive({ phase: "paused", pausedReason: "session-limit" })] },
      { enabled: true, drives: [runnerDrive({ phase: "idle" })] },
      { enabled: true, drives: [runnerDrive({ phase: "running" })] },
    ];
    const onSettled = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true, onSettled }));
    await waitFor(() => expect(result.current.drive?.phase).toBe("paused"));
    expect(result.current.live).toBe(true);

    await act(async () => void (await vi.advanceTimersByTimeAsync(12_100)));
    await waitFor(() => expect(result.current.drive?.phase).toBe("idle"));
    expect(result.current.live).toBe(true);

    await act(async () => void (await vi.advanceTimersByTimeAsync(12_100)));
    await waitFor(() => expect(result.current.drive?.phase).toBe("running"));
    expect(gets()).toBe(3);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("reads nothing while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(result.current.live).toBe(true));
    const before = gets();
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(gets()).toBe(before);
  });

  it("resumes one repo through resume-repo and adopts the runner it hands back", async () => {
    const { result } = renderHook(() => useDrive({ slug: "acme", enabled: true }));
    await waitFor(() => expect(result.current.drive).not.toBeNull());
    await act(async () => {
      await result.current.resumeRepo("acme/web");
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/org/local/drive");
    expect(post?.body).toEqual({ org: "acme", action: "resume-repo", repo: "acme/web" });
    expect(result.current.drive?.phase).toBe("running");
    expect(result.current.error).toBeNull();
  });
});
