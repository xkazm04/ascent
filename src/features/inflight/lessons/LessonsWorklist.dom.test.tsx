// @vitest-environment jsdom
//
// The lesson ledger (migrated from the cockpit's CockpitLessons panel, 2026-09-15). Load-bearing: the
// surface must SAY a candidate is not in memory, Keep must post exactly once and move the row out of
// the review queue, and a refusal must leave the row where it was.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";

const settleLoopLesson = vi.fn<(slug: string, id: string, action: "keep" | "discard") => Promise<LoopLessonRow>>();
vi.mock("@/features/inflight/live/cockpit/loopClient", () => ({
  settleLoopLesson: (slug: string, id: string, action: "keep" | "discard") => settleLoopLesson(slug, id, action),
}));

import { LessonsWorklist } from "./LessonsWorklist";

const lesson = (over: Partial<LoopLessonRow> = {}): LoopLessonRow => ({
  id: "c1",
  namespace: "acme/web",
  content: "This repo pins every GitHub Action by sha.",
  kind: "procedural",
  source: "loop-lesson",
  laneId: "lane-1",
  status: "pending",
  promotedMemoryId: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  settleLoopLesson.mockReset();
  settleLoopLesson.mockImplementation(async (_s, id, action) => lesson({ id, status: action === "keep" ? "kept" : "discarded" }));
});

describe("LessonsWorklist", () => {
  it("labels a candidate as NOT in memory until a human keeps it", () => {
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    expect(screen.getByText(/not in memory until you keep one/i)).toBeInTheDocument();
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("posts Keep once and moves the row out of the review queue", async () => {
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledTimes(1));
    expect(settleLoopLesson).toHaveBeenCalledWith("acme", "c1", "keep");
    await waitFor(() => expect(screen.queryByText(/pins every GitHub Action by sha/)).toBeNull());
    expect(screen.getByText(/No lessons are waiting for review/i)).toBeInTheDocument();
    // …and the settled archive still holds it.
    fireEvent.click(screen.getByText("settled archive"));
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("posts Discard with the discard action, never a delete of its own", async () => {
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Discard"));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledWith("acme", "c1", "discard"));
  });

  it("surfaces a refusal instead of pretending the candidate was settled", async () => {
    settleLoopLesson.mockRejectedValueOnce(new Error("This candidate was already kept."));
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    expect(await screen.findByText("This candidate was already kept.")).toBeInTheDocument();
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("keeps a ticked batch from the bulk bar, one POST per candidate", async () => {
    render(<LessonsWorklist org="acme" initial={[lesson(), lesson({ id: "c2", content: "Second candidate." })]} />);
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.click(screen.getByRole("button", { name: "Keep 2" }));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/No lessons are waiting for review/i)).toBeInTheDocument());
  });
});
