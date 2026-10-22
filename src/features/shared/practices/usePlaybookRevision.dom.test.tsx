// @vitest-environment jsdom
//
// playbooks-1: the revision rollout's state. It loads who is behind, preselects exactly the behind
// repos (an unversioned repo is listed but not preselected), gates the run behind a typed confirm that
// names the org and the exact repos, and moves every repo whose PR opened to in-flight.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlaybookRevision } from "./usePlaybookRevision";

afterEach(() => vi.unstubAllGlobals());

const SETS = {
  version: 3,
  behind: [
    { repo: "acme/a", appliedVersion: 1 },
    { repo: "acme/b", appliedVersion: 2 },
  ],
  diverged: [{ repo: "acme/c", state: "drifted" }],
  unversioned: [{ repo: "acme/d", appliedVersion: null, revisable: true }],
  current: [],
  inFlight: [],
};

function stub() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init || init.method !== "POST") return new Response(JSON.stringify(SETS), { status: 200 });
    return new Response(
      JSON.stringify({
        results: [
          { repo: "acme/a", ok: true, url: "https://github.com/acme/a/pull/1" },
          { repo: "acme/b", ok: false, error: "changed" },
        ],
        attempted: 2,
        skipped: 0,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("usePlaybookRevision", () => {
  it("enters ready with behind preselected and a confirm naming the org and the exact repos", async () => {
    stub();
    const { result } = renderHook(() => usePlaybookRevision({ playbookId: "pb1", org: "acme" }));
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.selectedRepos).toEqual(["acme/a", "acme/b"]);
    expect(result.current.confirm.org).toBe("acme");
    expect(result.current.confirm.repos).toEqual(["acme/a", "acme/b"]);
    expect(result.current.confirm.body).toContain("acme/a");
    expect(result.current.confirm.ready).toBe(false);
    act(() => result.current.setTyped("acme"));
    expect(result.current.confirm.ready).toBe(true);
  });

  it("refuses to run before the typed confirm, then moves succeeded repos to in-flight", async () => {
    const fetchMock = stub();
    const { result } = renderHook(() => usePlaybookRevision({ playbookId: "pb1", org: "acme" }));
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      await result.current.run();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.setTyped("acme"));
    await act(async () => {
      await result.current.run();
    });
    const body = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body));
    expect(body.repos).toEqual(["acme/a", "acme/b"]);
    expect(result.current.phase).toBe("done");
    expect(result.current.sets?.inFlight).toEqual(["acme/a"]);
    expect(result.current.sets?.behind.map((b) => b.repo)).toEqual(["acme/b"]);
    expect(result.current.results).toHaveLength(2);
  });
});
