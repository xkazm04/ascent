// @vitest-environment jsdom
//
// THE RUNNER BRANCH CARD and its one door. "Merge runner into <base>" is owner-only, confirmed, and its
// three answers render as what they are: the base moved (`fast-forward`), the checkout was
// fast-forwarded (`merged`), or the exact commands plus the sentence saying why (`commands`). A failed
// request says nothing merged. A commits-ahead count git could not produce is "unknown", never 0.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, repoState, runnerDrive } from "./ledgerFixture";
import { RunnerCard, type RunnerCardProps } from "./RunnerCard";

vi.mock("./ledgerClient", () => ({ mergeRunner: vi.fn() }));
const { mergeRunner } = await import("./ledgerClient");

const props = (over: Partial<RunnerCardProps> = {}): RunnerCardProps => ({
  slug: "acme",
  runner: runnerDrive(),
  live: true,
  ahead: { "acme/kp": 3 },
  now: NOW,
  isOwner: true,
  selfHosted: true,
  cockpitHref: "?tab=live&view=cockpit",
  onMerged: vi.fn(),
  ...over,
});

const confirmMerge = () => {
  fireEvent.click(screen.getByRole("button", { name: "Merge runner into main" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
};

beforeEach(() => vi.clearAllMocks());

describe("RunnerCard", () => {
  it("shows the base, the commits ahead, the last landing and the streaks", () => {
    render(<RunnerCard {...props({ runner: runnerDrive({ repoState: [repoState("acme/kp", { failureStreak: 2, dryStreak: 1 })] }) })} />);
    const row = screen.getByTestId("runner-repo");
    expect(row).toHaveTextContent("kp → main");
    expect(within(row).getByTestId("runner-ahead")).toHaveTextContent("3 commits ahead");
    expect(row).toHaveTextContent("last landed abcdef12");
    expect(row).toHaveTextContent("2 failures in a row");
    expect(row).toHaveTextContent("1 dry run in a row");
  });

  it("prints an unreadable count as unknown — never zero", () => {
    render(<RunnerCard {...props({ ahead: {} })} />);
    expect(screen.getByTestId("runner-ahead")).toHaveTextContent("ahead: unknown");
    render(<RunnerCard {...props({ ahead: { "acme/kp": null } })} />);
    expect(screen.getAllByTestId("runner-ahead")[1]).toHaveTextContent("ahead: unknown");
  });

  it("asks before it merges, and a cancel sends nothing", () => {
    render(<RunnerCard {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Merge runner into main" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mergeRunner).not.toHaveBeenCalled();
  });

  it("renders a fast-forward of an unchecked-out base", async () => {
    const res = { ok: true as const, outcome: "fast-forward" as const, mergedSha: "1234567890abcdef", note: "Fast-forwarded main.", base: "main" };
    vi.mocked(mergeRunner).mockResolvedValue(res);
    const p = props();
    render(<RunnerCard {...p} />);
    confirmMerge();
    const out = await screen.findByTestId("merge-outcome");
    expect(out).toHaveAttribute("data-outcome", "fast-forward");
    expect(out).toHaveTextContent("Fast-forwarded main to 12345678 — no working copy was touched.");
    expect(mergeRunner).toHaveBeenCalledWith("acme", "acme/kp");
    expect(p.onMerged).toHaveBeenCalledWith("acme/kp", res);
  });

  it("renders a merge made in the clean checkout that has the base", async () => {
    vi.mocked(mergeRunner).mockResolvedValue({ ok: true, outcome: "merged", mergedSha: "feedface00", note: "In C:/code/kp.", base: "main" });
    render(<RunnerCard {...props()} />);
    confirmMerge();
    const out = await screen.findByTestId("merge-outcome");
    expect(out).toHaveAttribute("data-outcome", "merged");
    expect(out).toHaveTextContent("Merged into main in your checkout (feedface).");
  });

  it("hands back the commands, with the sentence of why, when it will not merge for you", async () => {
    vi.mocked(mergeRunner).mockResolvedValue({
      ok: false,
      outcome: "commands",
      commands: ['cd "C:/code/kp"', "git status", "git merge --ff-only ascent/runner"],
      note: "main is checked out at C:/code/kp with uncommitted changes — commit or set them aside yourself, then fast-forward. Nothing was touched.",
      base: "main",
    });
    render(<RunnerCard {...props()} />);
    confirmMerge();
    const out = await screen.findByTestId("merge-outcome");
    expect(out).toHaveAttribute("data-outcome", "commands");
    expect(out).toHaveTextContent("with uncommitted changes");
    expect(within(out).getByTestId("copy-command").textContent).toBe('cd "C:/code/kp"\ngit status\ngit merge --ff-only ascent/runner');
  });

  it("says nothing merged when the request itself fails", async () => {
    vi.mocked(mergeRunner).mockRejectedValue(new Error("Pairing broken: path missing"));
    const p = props();
    render(<RunnerCard {...p} />);
    confirmMerge();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Pairing broken: path missing Nothing was merged."));
    expect(screen.queryByTestId("merge-outcome")).not.toBeInTheDocument();
    expect(p.onMerged).not.toHaveBeenCalled();
  });

  it("offers no merge to a viewer, nor off a self-hosted checkout, and nothing when nothing is ahead", () => {
    const { unmount } = render(<RunnerCard {...props({ isOwner: false })} />);
    expect(screen.queryByTestId("runner-merge")).not.toBeInTheDocument();
    expect(screen.getByText("An owner merges the runner branch.")).toBeInTheDocument();
    unmount();
    render(<RunnerCard {...props({ ahead: { "acme/kp": 0 } })} />);
    expect(screen.getByRole("button", { name: "Merge runner into main" })).toBeDisabled();
  });

  it("designs the no-runner state with the way to start one", () => {
    render(<RunnerCard {...props({ runner: null, live: false })} />);
    expect(screen.getByText(/No runner has worked here yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start one from the Cockpit" })).toHaveAttribute("href", "?tab=live&view=cockpit");
  });
});
