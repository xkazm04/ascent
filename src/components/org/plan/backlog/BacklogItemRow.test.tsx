// @vitest-environment jsdom
//
// Pins two backlog-management a11y fixes at the row level:
//  #6 — the status <select> must NOT force the status accent as inline text colour; the dark accents on
//       the near-black field fell below WCAG AA. Status is cued by the row's left-edge bar instead.
//  #3 — editing an inline control signals the parent (onEditField) with a stable `${id}:field` key so
//       the parent can restore keyboard focus after the edit re-groups the row into a different Card and
//       remounts it (the remount otherwise strands focus on <body>). The controls carry data-focus-key.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  // ambiguity-ui 07-16 backlog #3: a failed history fetch must be an ERROR state, never the confident
  // "No changes recorded yet." empty-copy (a false statement on a network blip / 500).
  it("history #3: a failed fetch reports history:'error' to the parent, not an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const onState = vi.fn();
    renderRow({ onState });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(onState).toHaveBeenCalledWith({ history: "error" }));
    expect(onState).not.toHaveBeenCalledWith({ history: [] });
  });

  it("history #3: the error state renders a retry affordance instead of the empty-copy", () => {
    renderRow({ state: { history: "error" } });
    expect(screen.getByText(/Couldn’t load history/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No changes recorded yet.")).not.toBeInTheDocument();
  });

  // ambiguity-ui 07-16 backlog #5: standard disclosure ARIA on the History toggle.
  it("history #5: the History button exposes aria-expanded and points at the revealed region", () => {
    renderRow({ state: { history: [] } });
    const btn = screen.getByRole("button", { name: "Hide history" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveAttribute("aria-controls", "history-b1");
    expect(document.getElementById("history-b1")).not.toBeNull();
  });

  it("history #5: collapsed, the button reads aria-expanded=false with no dangling aria-controls", () => {
    renderRow();
    const btn = screen.getByRole("button", { name: "History" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).not.toHaveAttribute("aria-controls");
  });

  it("#5: async outcomes (save/PR errors, PR link) render inside a polite live region", () => {
    renderRow({ error: "Couldn’t save that change.", state: { prResult: { url: "https://x/pr/1", reused: false } } });
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Couldn’t save that change.");
    expect(region).toHaveTextContent("Draft PR opened:");
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

// ── G6-28: an undated item gets an explicit due-date affordance, not an empty slot ────────────────
describe("BacklogItemRow due-date chip (G6-28)", () => {
  it("renders a 'no due date' control for an undated item instead of nothing", () => {
    renderRow(); // default item: targetDate null, dueInDays null
    const chip = screen.getByRole("button", { name: "no due date" });
    expect(chip).toHaveAttribute("title", "No due date set. Click to set one");
  });

  it("the 'no due date' control focuses this row's due input so a date can be added", () => {
    renderRow();
    screen.getByRole("button", { name: "no due date" }).click();
    expect(document.activeElement).toBe(screen.getByLabelText("Due date"));
  });

  it("a dated item still shows its relative label, with the stored date literal on hover", () => {
    renderRow({ item: item({ targetDate: "2026-02-01", dueInDays: 3, dueBucket: "this_week" }) });
    expect(screen.queryByRole("button", { name: "no due date" })).toBeNull();
    // The literal `yyyy-mm-dd` is shown verbatim — never re-parsed into an instant in the browser's
    // zone, which is how a date-only column reads back as the previous day (timezone policy note 5).
    expect(screen.getByText("due in 3 days")).toHaveAttribute("title", "Due 2026-02-01");
  });

  it("an overdue item keeps the orange treatment", () => {
    renderRow({ item: item({ targetDate: "2026-01-01", dueInDays: -2, overdue: true, dueBucket: "overdue" }) });
    expect(screen.getByText("2 days overdue")).toHaveClass("text-orange-300");
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
