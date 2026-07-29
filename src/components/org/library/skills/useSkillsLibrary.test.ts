// @vitest-environment jsdom
//
// useSkillsLibrary was extracted out of SkillsPanel.tsx (200-LOC .tsx cap) with no test coverage of its
// own — the catalog's state/effects lived undertested inside a client component. Pins: archive is
// optimistic and ROLLS BACK on a rejected DELETE (an admin-only mutation must never make a skill vanish
// from the UI while it survives in the DB), and the search filter triggers exactly one debounced refetch.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSkillsLibrary } from "./useSkillsLibrary";
import type { SkillRow } from "@/lib/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function skill(id: string): SkillRow {
  return {
    id,
    name: id,
    category: "workflow",
    description: "",
    content: "content",
    tags: [],
    version: 1,
    adoptionCount: 0,
    downloadCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as SkillRow;
}

describe("useSkillsLibrary — archive", () => {
  it("removes the skill optimistically, then restores it and surfaces an error when the DELETE is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Admins only." }) }),
    );
    const initial = [skill("a"), skill("b")];
    const { result } = renderHook(() => useSkillsLibrary({ slug: "acme", initial }));

    expect(result.current.skills.map((s) => s.id)).toEqual(["a", "b"]);

    await act(async () => {
      await result.current.archive("a");
    });

    // Rolled back — the rejected skill is back in the list, not silently dropped.
    expect(result.current.skills.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.current.error).toMatch(/admins only/i);
  });

  it("keeps the optimistic removal when the DELETE succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const initial = [skill("a"), skill("b")];
    const { result } = renderHook(() => useSkillsLibrary({ slug: "acme", initial }));

    await act(async () => {
      await result.current.archive("a");
    });

    expect(result.current.skills.map((s) => s.id)).toEqual(["b"]);
    expect(result.current.error).toBeNull();
  });
});

describe("useSkillsLibrary — filter debounce", () => {
  it("skips refetching on the initial render (the server-rendered `initial` isn't immediately refetched)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skills: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useSkillsLibrary({ slug: "acme", initial: [skill("a")] }));

    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches once, debounced, after a search term changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skills: [skill("x")] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSkillsLibrary({ slug: "acme", initial: [skill("a")] }));

    act(() => result.current.setSearch("dup"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("search=dup");
    await waitFor(() => expect(result.current.skills.map((s) => s.id)).toEqual(["x"]));
  });
});
