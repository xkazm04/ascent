// @vitest-environment jsdom
//
// It must say a
// candidate is not in memory, Keep posts once and moves the row out of the queue, a batch posts per candidate.

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

  it("posts Keep once and moves the row to the settled archive", async () => {
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledWith("acme", "c1", "keep"));
    await waitFor(() => expect(screen.getByText(/No lessons are waiting for review/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Settled archive"));
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("keeps a ticked batch from the bar, one POST per candidate", async () => {
    render(<LessonsWorklist org="acme" initial={[lesson(), lesson({ id: "c2", content: "Second candidate." })]} />);
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.click(screen.getByRole("button", { name: "Keep 2" }));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledTimes(2));
  });

  it("surfaces a refusal and leaves the row in the queue", async () => {
    settleLoopLesson.mockRejectedValueOnce(new Error("This candidate was already kept."));
    render(<LessonsWorklist org="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    expect(await screen.findByText(/This candidate was already kept\./)).toBeInTheDocument();
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });
});
