// @vitest-environment jsdom
//
// The lesson inbox. Two things are load-bearing: the panel must SAY a candidate is not in memory (a
// reader who assumes the loop already wrote it has no reason to review anything), and Keep must post
// exactly once and take the row out of the pending queue.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LoopLessonRow } from "./loopTypes";

const fetchLoopLessons = vi.fn<(slug: string) => Promise<LoopLessonRow[]>>();
const settleLoopLesson = vi.fn<(slug: string, id: string, action: "keep" | "discard") => Promise<LoopLessonRow>>();
vi.mock("./loopClient", () => ({
  fetchLoopLessons: (slug: string) => fetchLoopLessons(slug),
  settleLoopLesson: (slug: string, id: string, action: "keep" | "discard") => settleLoopLesson(slug, id, action),
}));

import { CockpitLessons } from "./CockpitLessons";

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
  fetchLoopLessons.mockReset();
  settleLoopLesson.mockReset();
  settleLoopLesson.mockResolvedValue(lesson({ status: "kept" }));
});

describe("CockpitLessons", () => {
  it("labels a candidate as NOT in memory until a human keeps it", () => {
    render(<CockpitLessons slug="acme" initial={[lesson()]} />);
    expect(screen.getByText(/not in memory until you keep one/i)).toBeInTheDocument();
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("posts Keep once and drops the row out of the pending queue", async () => {
    render(<CockpitLessons slug="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledTimes(1));
    expect(settleLoopLesson).toHaveBeenCalledWith("acme", "c1", "keep");
    await waitFor(() => expect(screen.queryByText(/pins every GitHub Action by sha/)).toBeNull());
    expect(screen.getByText(/No lessons are waiting for review/i)).toBeInTheDocument();
  });

  it("posts Discard with the discard action, never a delete of its own", async () => {
    render(<CockpitLessons slug="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Discard"));
    await waitFor(() => expect(settleLoopLesson).toHaveBeenCalledWith("acme", "c1", "discard"));
  });

  it("surfaces a refusal instead of pretending the candidate was settled", async () => {
    settleLoopLesson.mockRejectedValueOnce(new Error("This candidate was already kept."));
    render(<CockpitLessons slug="acme" initial={[lesson()]} />);
    fireEvent.click(screen.getByText("Keep"));
    expect(await screen.findByText("This candidate was already kept.")).toBeInTheDocument();
    // The row stays: nothing was settled, so nothing leaves the queue.
    expect(screen.getByText(/pins every GitHub Action by sha/)).toBeInTheDocument();
  });

  it("fetches its own pending candidates when none were handed in", async () => {
    fetchLoopLessons.mockResolvedValueOnce([lesson({ id: "c2", content: "Fetched candidate." })]);
    render(<CockpitLessons slug="acme" />);
    expect(await screen.findByText("Fetched candidate.")).toBeInTheDocument();
    expect(fetchLoopLessons).toHaveBeenCalledWith("acme");
  });
});
