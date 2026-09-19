// @vitest-environment jsdom
//
// The context rows behind a folded cell: a judged cell shows its count; a picked cell unfolds its
// contexts in the composer with the subject's revision and a `judged at r` reading; a repo whose map
// is behind its context map carries the badge in its column and the line in the composer, and that
// line's brief targets the `map` stage; the subject reader totals the contexts and names them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { KnowledgeLoom } from "./KnowledgeLoom";
import { STATE_GLYPH, STATE_LABEL, readJudged } from "./knowledgeModel";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=knowledge"),
}));

const view = fixtureKnowledgeView("acme");
const mapped = view.repos.filter((r) => r.hasMap);
const repoOf = (id: string) => view.repos.find((r) => r.repositoryId === id)!;
const cellTitle = (repositoryId: string, subject: string) => `${repoOf(repositoryId).fullName} · ${subject} — `;
const byTitlePrefix = (prefix: string) => document.querySelector(`[title^="${prefix}"]`) as HTMLElement | null;

beforeEach(() => {
  replace.mockClear();
  vi.restoreAllMocks();
});

describe("the fixture's context rows", () => {
  it("are dense on judged cells only, consistent with the fold, and reach stale, legacy and arrived", () => {
    for (const c of view.cells) expect(c.contextRows.length, `${c.subject}×${c.repositoryId}`).toBe(c.contexts);
    const judged = view.cells.filter((c) => c.contexts > 0);
    for (const c of judged) expect(c.contextRows[0]!.state).toBe(c.state);
    expect(judged.some((c) => c.contextRows.some((r) => r.stale && r.judgedRevision == null))).toBe(true);
    expect(judged.some((c) => c.contextRows.some((r) => r.arrived))).toBe(true);
    expect(view.subjects.some((s) => s.revision == null && s.changedAt == null)).toBe(true);
    expect(view.repos.some((r) => r.mapBehind && r.contextMapRevision && r.repoContextMapRevision)).toBe(true);
  });
});

describe("KnowledgeLoom context rows", () => {
  it("renders a judged cell as glyph + count and an absence as glyph only, keeping the state label in the title", () => {
    render(<KnowledgeLoom view={view} slug="acme" />);
    const judged = view.cells.find((c) => c.contexts > 1 && mapped.some((r) => r.repositoryId === c.repositoryId))!;
    const el = byTitlePrefix(cellTitle(judged.repositoryId, judged.subject))!;
    expect(el.textContent).toBe(`${STATE_GLYPH[judged.state]}${judged.contexts}`);
    expect(el.getAttribute("title")).toContain(`— ${STATE_LABEL[judged.state]}`);
    const absence = view.cells.find((c) => c.state === "candidate" && mapped.some((r) => r.repositoryId === c.repositoryId))!;
    expect(byTitlePrefix(cellTitle(absence.repositoryId, absence.subject))!.textContent).toBe("+");
  });

  it("unfolds a picked cell's contexts in the composer under the subject's revision header", () => {
    render(<KnowledgeLoom view={view} slug="acme" />);
    const target = view.cells.find(
      (c) =>
        c.state === "deviation" && !c.stale && mapped.some((r) => r.repositoryId === c.repositoryId) && c.contextRows.some((r) => r.judgedRevision != null) &&
        view.subjects.find((s) => s.slug === c.subject)?.revision != null,
    )!;
    const subject = view.subjects.find((s) => s.slug === target.subject)!;
    fireEvent.click(byTitlePrefix(cellTitle(target.repositoryId, target.subject))!);
    const composer = within(screen.getByRole("region", { name: "Dispatch composer" }));
    expect(composer.getByText(`· r${subject.revision} · ${subject.changedAt}`)).toBeTruthy();
    for (const row of target.contextRows) expect(composer.getByText(row.name)).toBeTruthy();
    expect(composer.getAllByText(/judged at r\d+/).length).toBeGreaterThan(0);
    const current = target.contextRows.find((r) => r.judgedRevision === subject.revision)!;
    expect(readJudged(current, subject.revision)).toBe(`judged at r${subject.revision}`);
  });

  it("reads a legacy stale row as `judged at ? (stale)` and an arrived row as `new`", () => {
    expect(readJudged({ name: "x", group: null, state: "conformant", stale: true, judgedRevision: null, arrived: false }, 9)).toBe("judged at ? (stale)");
    expect(readJudged({ name: "x", group: null, state: "conformant", stale: true, judgedRevision: 6, arrived: false }, 9)).toBe("judged at r6, 3 behind");
    expect(readJudged({ name: "x", group: null, state: "unknown", stale: false, judgedRevision: null, arrived: true }, 9)).toBe("new");
  });

  it("badges a map-behind column and lets the composer brief the map stage", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ dispatch: view.dispatches[0], brief: "# map brief" }), { status: 201 }));
    render(<KnowledgeLoom view={view} slug="acme" />);
    const behind = view.repos.find((r) => r.mapBehind)!;
    const headers = screen.getAllByRole("columnheader").filter((h) => h.getAttribute("title")?.startsWith(behind.fullName));
    expect(headers).toHaveLength(1);
    expect(within(headers[0]!).getByText("map behind")).toBeTruthy();
    const orphaned = view.repos.find((r) => r.orphaned > 0)!;
    expect(screen.getByText(`${orphaned.orphaned} orphaned`)).toBeTruthy();
    fireEvent.click(within(headers[0]!).getByRole("button"));
    const composer = within(screen.getByRole("region", { name: "Dispatch composer" }));
    expect(composer.getByText(`map behind the context map (${behind.contextMapRevision} → ${behind.repoContextMapRevision})`)).toBeTruthy();
    fireEvent.click(composer.getByRole("button", { name: "Compose map brief" }));
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ repositoryId: behind.repositoryId, stage: "map", subjects: [], mode: "brief" });
  });

  it("totals a subject's contexts across repos in the reader and names them", () => {
    render(<KnowledgeLoom view={view} slug="acme" />);
    const subject = view.subjects.find((s) => s.slug === "agent-memory")!;
    const mine = view.cells.filter((c) => c.subject === subject.slug && c.contextRows.length > 0);
    const total = mine.reduce((n, c) => n + c.contextRows.length, 0);
    fireEvent.click(screen.getByRole("button", { name: "agent-memory" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(new RegExp(`^r${subject.revision} · ${subject.changedAt} · ${total} contexts across ${mine.length} repos · \\d+ stale$`))).toBeTruthy();
    for (const row of mine[0]!.contextRows) expect(dialog.getAllByText(row.name).length).toBeGreaterThan(0);
  });
});
