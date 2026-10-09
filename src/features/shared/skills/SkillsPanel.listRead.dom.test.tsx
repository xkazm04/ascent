// @vitest-environment jsdom
//
// Both skills panels: a failed list read renders its error IN PLACE of the list and of the empty
// state, and the page-size line shows only when the list is truncated.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SkillRow } from "@/lib/db";
import { SkillsPanel } from "./SkillsPanel";
import { SkillsPanelV2 } from "./SkillsPanel.v2";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = {
  id: "s1",
  name: "review-change",
  description: "Review a change",
  content: "body",
  category: "workflow",
  tags: [],
  frontmatter: { name: "review-change", description: "d", category: "workflow", tags: [], cadenceDays: null },
  version: 1,
  contentHash: "sha256-n1:aa",
  downloadCount: 0,
  adoptionCount: 0,
  origin: "hosted",
  registryPath: null,
  registryVersion: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
} as SkillRow;

const props = {
  slug: "kiro",
  initial: [row],
  categories: ["workflow"],
  adoption: {},
  usage: {},
  outcomes: {},
  repoOptions: ["acme/app"],
  isAdmin: false,
  registryBase: null,
};

const PANELS = [
  ["v1", SkillsPanel, () => screen.getByLabelText("Search skills")],
  ["v2", SkillsPanelV2, () => document.getElementById("skill-filter-search") as HTMLElement],
] as const;

describe.each(PANELS)("skills panel %s — list read", (_name, Panel, searchInput) => {
  it("renders the list-read error instead of the list and the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Service down." }) }));
    render(<Panel {...props} />);
    expect(screen.getAllByText(/review-change/).length).toBeGreaterThan(0);
    fireEvent.change(searchInput(), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Service down."));
    expect(screen.queryByText(/match your filters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/review-change/)).not.toBeInTheDocument();
  });

  it("shows the page-size line only when the list is truncated", () => {
    render(<Panel {...props} />);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
    cleanup();
    render(<Panel {...props} initialTruncated />);
    expect(
      screen.getByText("Showing the first 1 skills. Search or pick a category to narrow the list."),
    ).toBeInTheDocument();
  });
});
