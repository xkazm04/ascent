// @vitest-environment jsdom
//
// Both memory panels: a failed list read renders its error IN PLACE of the list and of the empty
// state, never the previous rows and never "No memories match your filters".

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MemoryRow } from "@/lib/db";
import { MemoryPanel } from "./MemoryPanel";
import { MemoryPanelV2 } from "./MemoryPanel.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = {
  id: "m1",
  namespace: "acme/api",
  content: "CI runs on Node 18",
  kind: "procedural",
  visibility: "shared",
  source: "",
  confidence: 0.6,
  tags: [],
  supersededBy: null,
  version: 1,
  accessCount: 2,
  citedCount: 0,
  notUsefulCount: 0,
  expiresAt: null,
  origin: "hosted",
  registryPath: null,
  createdBy: "alice",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
} as MemoryRow;

const props = {
  slug: "kiro",
  initial: [row],
  kinds: ["procedural", "semantic"],
  namespaces: ["acme/api"],
  viewerLogin: "alice",
  canWrite: false,
  isAdmin: false,
  planAllowed: true,
  registryBase: null,
};

describe.each([
  ["v1", MemoryPanel],
  ["v2", MemoryPanelV2],
] as const)("memory panel %s — list read", (_name, Panel) => {
  it("renders the list-read error instead of the list and the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Service down." }) }));
    render(<Panel {...props} />);
    expect(screen.getAllByText(/CI runs on Node 18/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Service down."));
    expect(screen.queryByText(/match your filters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CI runs on Node 18/)).not.toBeInTheDocument();
  });
});
