// @vitest-environment jsdom
//
// The Loom end to end over the shaped fixture: the fixture is dense and reaches every state and
// stage; every mapped repo is a column; a picked cell threads into the composer and composing a brief
// posts the contract's body and renders the returned text; the reader opens; the preview shell keeps
// the real notice as its default and neuters actions.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { KNOWLEDGE_CELL_STATES } from "@/lib/org/knowledge-shape";
import { KnowledgeLoom } from "./KnowledgeLoom";
import { KnowledgePreviewShell } from "./KnowledgePreviewShell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=knowledge"),
}));

const view = fixtureKnowledgeView("acme");

beforeEach(() => {
  replace.mockClear();
  vi.restoreAllMocks();
});

describe("the shaped fixture", () => {
  it("is dense — one cell per subject × swept repo — and reaches every state and stage", () => {
    expect(view.cells).toHaveLength(view.subjects.length * view.repos.length);
    const states = new Set(view.cells.map((c) => c.state));
    for (const s of KNOWLEDGE_CELL_STATES) expect(states.has(s), `state ${s} never reached`).toBe(true);
    expect(new Set(view.repos.map((r) => r.stage))).toEqual(new Set(["populate", "map", "conform", "current"]));
    expect(view.cells.some((c) => c.stale)).toBe(true);
  });
});

describe("KnowledgeLoom", () => {
  it("renders every mapped repo as a column and opens the reader from a row label", () => {
    render(<KnowledgeLoom view={view} slug="acme" />);
    const mapped = view.repos.filter((r) => r.hasMap);
    expect(screen.getAllByRole("columnheader")).toHaveLength(mapped.length + 1);
    fireEvent.click(screen.getByRole("button", { name: "agent-memory" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Consulted when/)).toBeTruthy();
    // The focused subject is deep-linked, off the React-tracked search string.
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("subject=agent-memory"), { scroll: false });
  });

  it("threads a picked cell into the composer and composes a brief through the dispatch route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ dispatch: view.dispatches[0], brief: "# Ascent · registry hand-off\n/conform --subject x" }), { status: 201 }),
    );
    render(<KnowledgeLoom view={view} slug="acme" />);
    const pickable = screen.getAllByRole("button", { pressed: false }).filter((b) => b.getAttribute("title")?.includes("Unjudged"));
    expect(pickable.length).toBeGreaterThan(0);
    fireEvent.click(pickable[0]!);
    expect(screen.getAllByTitle("Remove from the brief")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Compose brief" }));
    await waitFor(() => expect(screen.getByText(/registry hand-off/)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/org/acme/registry/dispatch");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.mode).toBe("brief");
    expect(body.stage).toBe("conform");
    expect(body.subjects).toHaveLength(1);
  });

  it("says loudly when the fleet was never swept and offers the sweep", () => {
    const never = { ...view, sweep: { ...view.sweep, lastAt: null } };
    render(<KnowledgeLoom view={never} slug="acme" />);
    expect(screen.getByText("never run")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sweep fleet" })).toBeTruthy();
  });
});

describe("KnowledgePreviewShell", () => {
  it("shows the real notice by default and the shaped fleet on demand, with actions inert", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(
      <KnowledgePreviewShell slug="acme" fixture={view}>
        <p>real notice</p>
      </KnowledgePreviewShell>,
    );
    expect(screen.getByText("real notice")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Shaped fleet" }));
    expect(screen.queryByText("real notice")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sweep fleet" }));
    await waitFor(() => expect(screen.getByText(/Preview — nothing was sent/)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
