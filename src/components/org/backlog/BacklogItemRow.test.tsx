// @vitest-environment jsdom
//
// Pins two backlog-management a11y fixes at the row level:
//  #6 — the status <select> must NOT force the status accent as inline text colour; the dark accents on
//       the near-black field fell below WCAG AA. Status is cued by the row's left-edge bar instead.
//  #3 — editing an inline control signals the parent (onEditField) with a stable `${id}:field` key so
//       the parent can restore keyboard focus after the edit re-groups the row into a different Card and
//       remounts it (the remount otherwise strands focus on <body>). The controls carry data-focus-key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { BacklogItem } from "@/lib/db";
import { BacklogItemRow } from "./BacklogItemRow";

afterEach(() => vi.restoreAllMocks());

function item(over: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "b1",
    title: "Add tests",
    dimId: "D1",
    dimLabel: "Testing",
    impact: "high",
    effort: "low",
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    dueBucket: "no_date",
    dueInDays: null,
    overdue: false,
    repo: "acme/web",
    repoName: "web",
    lastActivityAt: "2026-01-01T00:00:00Z",
    projectedPoints: null,
    unlocks: null,
    rationale: "",
    explore: [],
    ...over,
  };
}

function renderRow(over: Partial<Parameters<typeof BacklogItemRow>[0]> = {}) {
  const onEditField = vi.fn();
  const onPatch = vi.fn().mockResolvedValue({ patched: true, refreshed: true });
  render(
    <BacklogItemRow
      org="acme"
      item={item()}
      assignees={["alice"]}
      saving={false}
      onState={() => {}}
      onPatch={onPatch}
      onEditField={onEditField}
      {...over}
    />,
  );
  return { onEditField, onPatch };
}

describe("BacklogItemRow accessibility", () => {
  it("#6: renders the status select without the low-contrast inline accent colour", () => {
    renderRow();
    const status = screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
    // No forced inline text colour (the accent fell below WCAG AA on the dark field); slate token via class.
    expect(status.style.color).toBe("");
    expect(status).toHaveAttribute("data-focus-key", "b1:status");
  });

  it("#3: exposes a stable data-focus-key on every inline control for focus restore", () => {
    renderRow();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveAttribute("data-focus-key", "b1:status");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveAttribute("data-focus-key", "b1:owner");
    expect(screen.getByLabelText("Due date")).toHaveAttribute("data-focus-key", "b1:due");
  });

  it("#3: signals the parent which control was edited so focus can be restored after a remount", () => {
    const { onEditField } = renderRow();
    fireEvent.change(screen.getByRole("combobox", { name: "Owner" }), { target: { value: "alice" } });
    expect(onEditField).toHaveBeenCalledWith("b1:owner");
  });

  it("#4: truncates a long title (within a min-w-0 flex item) with the full text on hover", () => {
    const long = "A".repeat(200);
    renderRow({ item: item({ title: long }) });
    const title = screen.getByText(long);
    // truncate on the block + min-w-0 on the flex ancestor is what stops a long title forcing the row wide.
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", long);
    expect(title.parentElement).toHaveClass("min-w-0");
  });
});

describe("BacklogItemRow gap-exploration (companion-voice parity)", () => {
  it("surfaces the gap's rationale and explore questions in a collapsed disclosure", () => {
    renderRow({
      item: item({
        rationale: "Tests are the guardrail that makes AI-generated code safe to merge.",
        explore: ["What would catch a regression before it merged?", "Which behaviors have no test?"],
      }),
    });
    // The companion-voice disclosure summary + its content (present in the DOM inside the <details>).
    expect(screen.getByText("Why this gap matters")).toBeInTheDocument();
    expect(screen.getByText("Tests are the guardrail that makes AI-generated code safe to merge.")).toBeInTheDocument();
    expect(screen.getByText("What would catch a regression before it merged?")).toBeInTheDocument();
    // Kept collapsed by default so the row stays lean.
    expect(screen.getByText("Why this gap matters").closest("details")).not.toHaveAttribute("open");
  });

  it("renders no disclosure for a legacy row with no rationale or questions", () => {
    renderRow(); // default item has rationale "" and explore []
    expect(screen.queryByText("Why this gap matters")).not.toBeInTheDocument();
  });
});
