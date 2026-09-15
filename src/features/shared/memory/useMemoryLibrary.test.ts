// @vitest-environment jsdom
//
// useMemoryLibrary was extracted out of MemoryPanel.tsx (200-LOC .tsx cap) with no test coverage of its
// own. Pins: archive is optimistic and ROLLS BACK on a rejected DELETE (mirrors useSkillsLibrary —
// an admin-only mutation must never make a memory vanish from the UI while it survives in the DB), and
// dismissVerdict clears BOTH the verdict and any pre-armed supersede selection (a stale supersedeId
// left over from a dismissed verdict would silently retire the wrong memory on the next Save).

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMemoryLibrary } from "./useMemoryLibrary";
import type { MemoryRow } from "@/lib/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function memory(id: string): MemoryRow {
  return {
    id,
    namespace: "",
    content: "content",
    kind: "semantic",
    visibility: "shared",
    source: "",
    confidence: 1,
    tags: [],
    supersededBy: null,
    version: 1,
    accessCount: 0,
    expiresAt: null,
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("useMemoryLibrary — archive", () => {
  it("removes the memory optimistically, then restores it and surfaces an error when the DELETE is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Admins only." }) }),
    );
    const initial = [memory("a"), memory("b")];
    const { result } = renderHook(() =>
      useMemoryLibrary({ slug: "acme", initial, initialNamespaces: [] }),
    );

    await act(async () => {
      await result.current.archive("a");
    });

    expect(result.current.memories.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.current.error).toMatch(/admins only/i);
  });

  it("keeps the optimistic removal when the DELETE succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const initial = [memory("a"), memory("b")];
    const { result } = renderHook(() =>
      useMemoryLibrary({ slug: "acme", initial, initialNamespaces: [] }),
    );

    await act(async () => {
      await result.current.archive("a");
    });

    expect(result.current.memories.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("useMemoryLibrary — write-form defaults and verdict dismissal", () => {
  it("seeds the write form's visibility from defaultVisibility (private for personal workspaces)", () => {
    const { result } = renderHook(() =>
      useMemoryLibrary({ slug: "acme", initial: [], initialNamespaces: [], defaultVisibility: "private" }),
    );
    expect(result.current.form.visibility).toBe("private");
  });

  it("dismissVerdict clears both the verdict and any pre-armed supersedeId", () => {
    const { result } = renderHook(() =>
      useMemoryLibrary({ slug: "acme", initial: [], initialNamespaces: [] }),
    );

    act(() => {
      result.current.setSupersedeId("mem-1");
    });
    expect(result.current.supersedeId).toBe("mem-1");

    act(() => {
      result.current.dismissVerdict();
    });
    expect(result.current.supersedeId).toBeNull();
    expect(result.current.verdict).toBeNull();
  });
});

describe("useMemoryLibrary — the debounced refresh cannot be overtaken", () => {
  // REGRESSION (explorer, 2026-08-29): the effect debounced the TIMER but the request it started was
  // unguarded, so changing a filter twice left two reads in flight and the SLOWER one won setState —
  // the list showed rows for a filter the user had already moved off. The request now carries the
  // AbortSignal of the filter state that asked for it.
  it("passes an AbortSignal and aborts it when the filter changes again", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal);
      return { ok: true, json: async () => ({ memories: [], namespaces: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useMemoryLibrary({ slug: "acme", initial: [memory("m1")], initialNamespaces: [] }),
    );

    // First filter change → its timer fires → one read, carrying a live signal.
    act(() => result.current.setSearch("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);

    // Second change supersedes it: the first read's signal is aborted, a new one is issued.
    act(() => result.current.setSearch("ab"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(signals[0]!.aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);

    vi.useRealTimers();
  });
});
