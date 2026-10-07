// @vitest-environment jsdom
//
// The queued tail. An import whose 300 s budget leaves repos queued for the worker ends its stream with
// a `result` frame carrying queued > 0. The wizard used to drop that count, say "Scan complete" and
// label the tail "not scanned" (or a credit skip) - the repos were neither: they are still scanning in
// the background. The done screen must say so and must not claim completion.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, render, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { ScanStep } from "./OnboardingScanStep";
import { runImportScan } from "./importScan";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const REPOS = ["vercel/a", "vercel/b", "vercel/c"].map((fullName) => ({
  fullName, private: false, language: "TS", stars: 1, pushedAt: null,
}));
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function sse(frames: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    }),
    { status: 200 },
  );
}

describe("a result frame with queued > 0", () => {
  it("reaches the callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([frame("result", { runId: "r1", queued: 2 })])));
    const onResult = vi.fn();
    await runImportScan({ org: "acme", repos: ["acme/a"] }, new AbortController(), { onRepo: vi.fn(), onResult, onError: vi.fn() });
    expect(onResult).toHaveBeenCalledWith({ runId: "r1", queued: 2 });
  });

  it("is not 'Scan complete', and the tail is 'still scanning', never 'not scanned'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/org/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
        return sse([
          frame("queued", { runId: "r1", queued: 3, total: 3 }),
          frame("repo", { repo: "vercel/a", level: "l2", overall: 40 }),
          frame("queued", { runId: "r1", queued: 2, total: 3 }),
          frame("result", { runId: "r1", scanned: 1, total: 3, queued: 2 }),
        ]);
      }),
    );
    const hook = renderHook(() => useOnboardingFlow());
    await act(async () => {
      await hook.result.current.loadRepos(undefined, "vercel");
    });
    await waitFor(() => expect(hook.result.current.repos).toHaveLength(3));
    await act(async () => {
      await hook.result.current.startScan();
    });
    expect(hook.result.current.phase).toBe("done");

    const { rows } = hook.result.current;
    const view = render(
      <ScanStep phase="done" rows={rows} error={null} announce="" onCancel={() => {}} onViewDashboard={() => {}} onScanAnother={() => {}} />,
    );
    const text = view.container.textContent ?? "";
    expect(text).not.toMatch(/scan complete/i);
    expect(text).not.toMatch(/not scanned/i);
    expect(text).not.toMatch(/out of credits/i);
    expect(text).toMatch(/still scanning in the background/i);
    expect(text).toMatch(/2 repositories are still scanning/i);
    hook.unmount();
  });
});
