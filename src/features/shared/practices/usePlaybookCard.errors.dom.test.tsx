// @vitest-environment jsdom
//
// "Open draft PR" reads its answer through readApiResponse (council r3 pre-pass): a non-JSON error
// body shows the control's copy, a JSON error shows its text, success is unchanged.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePlaybookCard } from "./usePlaybookCard";
import type { PlaybookRow } from "@/lib/db";

afterEach(() => vi.unstubAllGlobals());

const playbook: PlaybookRow = {
  id: "p1",
  title: "Adopt CI",
  dimId: "D1",
  summary: "",
  steps: [],
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  version: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};

async function openWith(res: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => res));
  const { result } = renderHook(() => usePlaybookCard({ playbook, adoption: undefined }));
  act(() => result.current.setPick("acme/web"));
  await act(async () => {
    await result.current.openPr();
  });
  return result.current;
}

describe("usePlaybookCard.openPr: the error read", () => {
  it("a non-JSON 504 shows the fallback copy, not a SyntaxError", async () => {
    const c = await openWith(new Response("<html>Gateway Timeout</html>", { status: 504 }));
    expect(c.prError).toBe("Failed to open PR.");
    expect(c.proposed).toEqual([]);
  });

  it("shows the server's JSON error text", async () => {
    const c = await openWith(new Response(JSON.stringify({ error: "Repo must belong to acme." }), { status: 403 }));
    expect(c.prError).toBe("Repo must belong to acme.");
  });

  it("success is unchanged", async () => {
    const c = await openWith(new Response(JSON.stringify({ url: "https://github.com/acme/web/pull/7", reused: true }), { status: 200 }));
    expect(c.prError).toBeNull();
    expect(c.prResult).toEqual({ url: "https://github.com/acme/web/pull/7", reused: true });
    expect(c.proposed).toEqual(["acme/web"]);
  });
});
