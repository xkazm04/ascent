// @vitest-environment jsdom
//
// "Correct" on the Memory card (challenge-2026-09-23b, org-memory#B). A correction is a supersede aimed
// at the row being read, so the card offers it where the reader is looking: on a hosted row the viewer
// can write. A registry mirror keeps "Open in registry" instead (its change path is a pull request),
// and a reader without write access gets no action they would only be refused.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryCard } from "./MemoryCard";
import type { MemoryRow } from "@/lib/db";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function row(over: Partial<MemoryRow> = {}): MemoryRow {
  return {
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
    ...over,
  };
}

function card(memory: MemoryRow, canWrite: boolean, onCorrect = vi.fn()) {
  render(
    <MemoryCard
      memory={memory}
      viewerLogin="bob"
      canArchive={false}
      onArchive={() => {}}
      canWrite={canWrite}
      onCorrect={onCorrect}
      registryBase="https://github.com/acme/registry/blob/main/"
    />,
  );
  return onCorrect;
}

describe("MemoryCard: the Correct action", () => {
  it("offers Correct on a hosted row the viewer can write, and hands the row to onCorrect", () => {
    const onCorrect = card(row(), true);
    fireEvent.click(screen.getByRole("button", { name: /correct/i }));
    expect(onCorrect).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });

  it("offers no Correct on a registry mirror; Open in registry stays", () => {
    card(row({ origin: "registry", registryPath: "memory/procedural/ci.md" }), true);
    expect(screen.queryByRole("button", { name: /correct/i })).toBeNull();
    expect(screen.getByRole("link", { name: /open in registry/i })).toBeTruthy();
  });

  it("offers no Correct to a reader without write access", () => {
    card(row(), false);
    expect(screen.queryByRole("button", { name: /correct/i })).toBeNull();
  });
});

describe("MemoryCard: what a corrected memory replaced", () => {
  it("reads the lineage on demand and lists the earlier versions, counting hidden ones", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        memory: row({ id: "m3", version: 3 }),
        lineage: [row({ id: "m2", content: "CI runs on Node 16", createdBy: "carol" })],
        lineageHidden: 1,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    card(row({ id: "m3", version: 3 }), true);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /earlier version/i }));
    expect(await screen.findByText("CI runs on Node 16")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/org/memory/m3?lineage=1");
    expect(screen.getByText(/1 earlier version you cannot see/i)).toBeTruthy();
  });

  it("offers no history on a first version", () => {
    card(row(), true);
    expect(screen.queryByRole("button", { name: /earlier version/i })).toBeNull();
  });
});
