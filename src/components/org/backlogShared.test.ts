import { describe, expect, it } from "vitest";
import { dueLabel, eventValue, STATUS_LABEL } from "@/components/org/backlogShared";
import type { BacklogItem } from "@/lib/db";

// Pure, table-driven display helpers shared by every backlog row + history entry. No DOM needed.
// The invariants pinned here: dueLabel uses the singular noun ONLY at ±1 day, returns null for an
// undated item, and never emits "Invalid Date"/NaN/undefined; eventValue maps a status id to its
// human label, echoes any unknown value unchanged, and renders null as the em-dash "—".

// dueLabel only reads `item.dueInDays`, but its signature takes a full BacklogItem; this factory
// builds a type-valid item so the assertions exercise the real production signature (not a cast).
function item(dueInDays: number | null): BacklogItem {
  return {
    id: "rec_1",
    title: "Add CI gate",
    dimId: "rigor",
    dimLabel: "Rigor",
    impact: "high",
    effort: "low",
    status: "open",
    assigneeLogin: null,
    targetDate: dueInDays == null ? null : "2026-06-19",
    dueBucket: "this_week",
    dueInDays,
    overdue: dueInDays != null && dueInDays < 0,
    repo: "acme/web",
    repoName: "web",
    lastActivityAt: "2026-06-19T00:00:00.000Z",
    projectedPoints: null,
    unlocks: null,
  };
}

describe("dueLabel", () => {
  it("returns null when the item has no due date", () => {
    expect(dueLabel(item(null))).toBeNull();
  });

  it("renders the exact-today case as 'due today' (no day count)", () => {
    expect(dueLabel(item(0))).toBe("due today");
  });

  // ---- future side: singular "day" ONLY at exactly +1, plural everywhere else.
  it("uses the singular noun at exactly +1 day", () => {
    expect(dueLabel(item(1))).toBe("due in 1 day");
  });

  it("pluralizes at +2 and beyond", () => {
    expect(dueLabel(item(2))).toBe("due in 2 days");
    expect(dueLabel(item(7))).toBe("due in 7 days");
    expect(dueLabel(item(30))).toBe("due in 30 days");
  });

  // ---- overdue side: the count is the absolute (positive) magnitude; singular ONLY at -1.
  it("uses the singular noun at exactly -1 day overdue", () => {
    expect(dueLabel(item(-1))).toBe("1 day overdue");
  });

  it("pluralizes overdue at -2 and beyond, reporting the positive magnitude", () => {
    expect(dueLabel(item(-2))).toBe("2 days overdue");
    expect(dueLabel(item(-10))).toBe("10 days overdue");
  });

  // ---- safety: no "-1 days overdue", no "Invalid Date", no NaN/undefined in any branch.
  it("never leaks a negative count, NaN, undefined, or 'Invalid Date' in its output", () => {
    for (const d of [null, 0, 1, 2, -1, -2, 5, -5, 100, -100]) {
      const out = dueLabel(item(d as number | null));
      if (out == null) {
        expect(d).toBeNull();
        continue;
      }
      expect(out).not.toContain("-");
      expect(out).not.toMatch(/NaN|undefined|Invalid Date/);
    }
  });
});

describe("eventValue", () => {
  it("renders a null value as the em-dash '—' regardless of kind", () => {
    expect(eventValue("status", null)).toBe("—");
    expect(eventValue("assignee", null)).toBe("—");
    expect(eventValue("target_date", null)).toBe("—");
  });

  it("maps every known status id to its human label", () => {
    expect(eventValue("status", "open")).toBe("Open");
    expect(eventValue("status", "in_progress")).toBe("In progress");
    expect(eventValue("status", "done")).toBe("Done");
    expect(eventValue("status", "dismissed")).toBe("Dismissed");
  });

  it("stays in sync with STATUS_LABEL for every status id", () => {
    for (const [id, label] of Object.entries(STATUS_LABEL)) {
      expect(eventValue("status", id)).toBe(label);
    }
  });

  it("echoes an unknown status id unchanged (fallthrough, no crash)", () => {
    expect(eventValue("status", "weird")).toBe("weird");
    expect(eventValue("status", "")).toBe("");
  });

  it("echoes non-status kinds verbatim (no label remapping)", () => {
    expect(eventValue("assignee", "octocat")).toBe("octocat");
    expect(eventValue("target_date", "2026-06-19")).toBe("2026-06-19");
    // a value that happens to match a status id is NOT relabeled for a non-status kind.
    expect(eventValue("assignee", "in_progress")).toBe("in_progress");
  });
});
