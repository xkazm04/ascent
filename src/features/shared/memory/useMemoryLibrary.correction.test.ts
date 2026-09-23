// @vitest-environment jsdom
//
// "Correct" on a Memory card (challenge-2026-09-23b, org-memory#B). Before this, the only way to arm
// `supersedeId` was a check verdict's duplicates[0]: a row outside the 50 newest in its namespace, or
// reworded past the overlap floor, could not be corrected from the product at all. startCorrection arms
// the target directly, so a correction is one POST and no model call. The check-then-save path is
// pinned unchanged beside it (guards).

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMemoryLibrary } from "./useMemoryLibrary";
import { EMPTY_FORM } from "./memoryLibraryApi";
import type { MemoryRow } from "@/lib/db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const M1: MemoryRow = {
  id: "m1",
  namespace: "acme/api",
  content: "CI runs on Node 18",
  kind: "procedural",
  visibility: "shared",
  source: "",
  confidence: 0.6,
  tags: ["ci"],
  supersededBy: null,
  version: 1,
  accessCount: 0,
  citedCount: 0,
  notUsefulCount: 0,
  expiresAt: null,
  origin: "hosted",
  registryPath: null,
  createdBy: "alice",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type Call = { url: string; body: Record<string, unknown> | null };

function stubFetch(checkVerdict?: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null });
      if (url === "/api/org/memory/check") return { ok: true, json: async () => checkVerdict };
      if (url === "/api/org/memory") return { ok: true, json: async () => ({ id: "m2" }) };
      return { ok: true, json: async () => ({ memories: [], namespaces: [] }) };
    }),
  );
  return calls;
}

const lib = () => renderHook(() => useMemoryLibrary({ slug: "acme", initial: [M1], initialNamespaces: [] }));

describe("useMemoryLibrary: correct a memory from its card", () => {
  it("startCorrection then save posts ONE write carrying supersedeId, and never calls the check", async () => {
    const calls = stubFetch();
    const { result } = lib();

    act(() => result.current.startCorrection(M1));
    expect(result.current.correcting?.id).toBe("m1");
    expect(result.current.supersedeId).toBe("m1");
    act(() => result.current.setForm({ content: "CI runs on Node 22" }));
    await act(async () => {
      await result.current.save();
    });

    const posts = calls.filter((c) => c.url === "/api/org/memory");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ content: "CI runs on Node 22", supersedeId: "m1" });
    expect(calls.filter((c) => c.url === "/api/org/memory/check")).toHaveLength(0);
    expect(result.current.correcting).toBeNull();
  });

  it("cancelCorrection restores the empty form and disarms the target; a later save supersedes nothing", async () => {
    const calls = stubFetch();
    const { result } = lib();

    act(() => result.current.startCorrection(M1));
    act(() => result.current.cancelCorrection());
    expect(result.current.form).toEqual(EMPTY_FORM);
    expect(result.current.supersedeId).toBeNull();
    expect(result.current.correcting).toBeNull();

    act(() => result.current.setForm({ content: "an unrelated note" }));
    await act(async () => {
      await result.current.save();
    });
    const posts = calls.filter((c) => c.url === "/api/org/memory");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body!.supersedeId).toBeUndefined();
  });

  it("a check run during a correction keeps the correction's target armed", async () => {
    stubFetch({ recommendation: "supersede", duplicates: [{ id: "other" }], llmUnavailable: false });
    const { result } = lib();

    act(() => result.current.startCorrection(M1));
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.supersedeId).toBe("m1");
  });
});

describe("useMemoryLibrary: the check-then-save path is unchanged (guards)", () => {
  it("guard: a supersede verdict still pre-selects duplicates[0], and Keep both still clears it", async () => {
    stubFetch({ recommendation: "supersede", duplicates: [{ id: "dup1" }], llmUnavailable: false });
    const { result } = lib();

    act(() => result.current.setForm({ content: "CI runs on Node 22" }));
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.supersedeId).toBe("dup1");

    // "Keep both" in MemoryCheckVerdict is setSupersedeId(null).
    act(() => result.current.setSupersedeId(null));
    expect(result.current.supersedeId).toBeNull();
  });
});
