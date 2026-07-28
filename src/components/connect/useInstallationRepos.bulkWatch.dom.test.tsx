// @vitest-environment jsdom
//
// G6-14: `summarizeBulkWatch` (watchState.ts) already computed which rows to revert on a partial
// bulk-watch failure, but `watchAllFiltered` only reverted the local `watched` flag — it never called
// `setRowError` for the failed subset, unlike the per-row toggle path. The user saw an aggregate
// "N watched · M failed" banner with no way to tell WHICH repos failed. This pins that each reverted
// row now carries its own per-row error (the same shape RepoRow renders via `errors[fullName]`), and
// that a row's stale error clears once a later attempt actually saves it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useInstallationRepos } from "./useInstallationRepos";

afterEach(() => {
  vi.restoreAllMocks();
});

function repoPayload(fullName: string) {
  const name = fullName.split("/")[1];
  return {
    fullName,
    owner: "acme",
    name,
    private: false,
    url: `https://github.com/${fullName}`,
    language: "TypeScript",
    stars: 0,
    pushedAt: null,
    state: { watched: false, scanSchedule: "off", level: null, overall: null },
  };
}

const REPOS = [repoPayload("acme/alpha"), repoPayload("acme/bravo"), repoPayload("acme/charlie")];

function stubFetch(watchResponse: { ok: boolean; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/app/repos")) return { ok: true, json: async () => ({ repos: REPOS }) };
      if (url.includes("/api/org/credits")) return { ok: false, json: async () => ({}) };
      if (url.includes("/api/org/segments")) return { ok: false, json: async () => ({}) };
      if (url.includes("/api/org/watch") && init?.method === "POST") {
        return { ok: watchResponse.ok, json: async () => watchResponse.body };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
}

describe("useInstallationRepos — bulk-watch partial failure marks the failed rows (G6-14)", () => {
  it("reverts AND surfaces a per-row error on exactly the failed subset, leaving succeeded rows clean", async () => {
    stubFetch({ ok: true, body: { count: 2, failed: ["acme/charlie"] } });
    const { result } = renderHook(() => useInstallationRepos({ org: "acme", installationId: "1" }));

    await waitFor(() => expect(result.current.view.status).toBe("done"));

    await act(async () => {
      await result.current.watchAllFiltered();
    });

    // The aggregate banner still exists (not replaced)...
    expect(result.current.bulkMsg).toEqual({ kind: "note", text: "Now watching 2 repos · 1 failed." });

    // ...but now EVERY failed row also carries its own visible reason, not just the aggregate count.
    expect(result.current.errors["acme/charlie"]).toBe("Couldn't watch — not saved. Try again.");
    // The two rows that actually saved must NOT be marked as failed.
    expect(result.current.errors["acme/alpha"]).toBeUndefined();
    expect(result.current.errors["acme/bravo"]).toBeUndefined();

    // The failed row's optimistic watch was rolled back; the successful rows kept it.
    const byName = Object.fromEntries(result.current.view.status === "done" ? result.current.view.repos.map((r) => [r.fullName, r]) : []);
    expect(byName["acme/charlie"].state?.watched).toBe(false);
    expect(byName["acme/alpha"].state?.watched).toBe(true);
    expect(byName["acme/bravo"].state?.watched).toBe(true);
  });

  it("a 2xx where every row failed marks every row, not just the aggregate", async () => {
    stubFetch({ ok: true, body: { count: 0, failed: ["acme/alpha", "acme/bravo", "acme/charlie"] } });
    const { result } = renderHook(() => useInstallationRepos({ org: "acme", installationId: "1" }));
    await waitFor(() => expect(result.current.view.status).toBe("done"));

    await act(async () => {
      await result.current.watchAllFiltered();
    });

    expect(result.current.bulkMsg?.kind).toBe("error");
    for (const fn of ["acme/alpha", "acme/bravo", "acme/charlie"]) {
      expect(result.current.errors[fn]).toBe("Couldn't watch — not saved. Try again.");
    }
  });

  it("clears a row's stale error once a later bulk attempt actually saves it", async () => {
    stubFetch({ ok: true, body: { count: 2, failed: ["acme/charlie"] } });
    const { result } = renderHook(() => useInstallationRepos({ org: "acme", installationId: "1" }));
    await waitFor(() => expect(result.current.view.status).toBe("done"));

    await act(async () => {
      await result.current.watchAllFiltered();
    });
    expect(result.current.errors["acme/charlie"]).toBeDefined();

    // Retry the bulk action; this time everything saves.
    stubFetch({ ok: true, body: { count: 1, failed: [] } });
    await act(async () => {
      await result.current.watchAllFiltered();
    });
    expect(result.current.errors["acme/charlie"]).toBeUndefined();
  });
});
