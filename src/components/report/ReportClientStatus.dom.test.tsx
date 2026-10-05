// @vitest-environment jsdom
//
// Empty-state action primacy (repo-report-shell-tabs #4): for a permanent failure (404 / private,
// `connect: true`) a retry with the same input can't succeed — the `connect` prop's own doc says so —
// so "Connect GitHub" must be the primary action and the retry loop must not be offered. For a
// transient failure (no `connect`), "Try again" stays the primary.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProviderName } from "@/lib/types";
import { Empty, Loading } from "./ReportClientStatus";
import { CTA_PRIMARY } from "@/lib/ui";

describe("Empty action primacy (permanent vs transient failure)", () => {
  it("connect: 'Connect GitHub' is primary, retry-same-input is not offered", () => {
    render(<Empty title="Repository not found" message="…" repo="acme/private" connect />);
    const connectLink = screen.getByRole("link", { name: /connect github/i });
    expect(connectLink.className).toBe(CTA_PRIMARY);
    // The dead-end loop is gone; a productive alternative replaces it.
    expect(screen.queryByRole("link", { name: /^try again$/i })).toBeNull();
    expect(screen.getByRole("link", { name: /scan a different repo/i })).toHaveAttribute("href", "/?scan=1");
    expect(screen.getByRole("link", { name: /back home/i })).toBeInTheDocument();
  });

  it("transient (no connect): 'Try again' with the same repo stays the primary action", () => {
    render(<Empty title="Scan timed out" message="…" repo="acme/app" />);
    const retry = screen.getByRole("link", { name: /^try again$/i });
    expect(retry.className).toBe(CTA_PRIMARY);
    // `fresh=1` is what makes the button actually try again: without it the href is the URL the
    // user is already on (same search params → the scan effect never re-runs), so the primary
    // action of the transient-failure state did nothing.
    expect(retry).toHaveAttribute("href", `/report?repo=${encodeURIComponent("acme/app")}&fresh=1`);
    expect(screen.queryByRole("link", { name: /connect github/i })).toBeNull();
  });
});

// UAT `SAM-L1-08` (recurrence 2, WIDENED — 4-of-6 uncovered-by-2 → 5-of-8 uncovered-by-3). The score
// step is the longest wait in the product, and three of the eight selectable providers — including
// `local`, the self-hosted path and typically the slowest — fell through to generic copy, which reads
// as a hung spinner rather than as work. A `switch` with a `default` is why the gap widened silently.
describe("the score step names the provider being queried — every provider", () => {
  const scoreStepText = (provider: ProviderName, region?: string) => {
    const { unmount } = render(
      <Loading repo="acme/web" progress={{ stage: "score", provider, ...(region ? { region } : {}) }} />,
    );
    const text = document.body.textContent ?? "";
    unmount();
    return text;
  };

  const ALL: ProviderName[] = ["gemini", "bedrock", "openai", "openrouter", "local", "mock", "claude-cli", "codex-cli", "gateway"];

  it.each(ALL)("names %s rather than falling through to the generic label", (provider) => {
    expect(scoreStepText(provider)).not.toContain("Scoring against the rubric");
  });

  it("names the self-hosted local model AND says it is the slow path", () => {
    expect(scoreStepText("local")).toMatch(/local model/i);
    expect(scoreStepText("local")).toMatch(/slowest/i);
  });

  it("keeps Bedrock's region in the label", () => {
    expect(scoreStepText("bedrock", "eu-west-1")).toContain("Querying Bedrock in eu-west-1");
    expect(scoreStepText("bedrock")).toContain("us-east-1"); // the documented default, never a blank
  });

  it("falls back to the generic label only when no provider has been reported yet", () => {
    render(<Loading repo="acme/web" progress={{ stage: "score" }} />);
    expect(document.body.textContent).toContain("Scoring against the rubric");
  });
});

// RESTORED WORK (repo-report-shell-tabs #4). When a reloaded tab rejoins the scan it started, the
// loading view must SAY so — session-resume's resume-affordances rule: work that restores itself
// without being asked carries a visible start-over exit, or the user cannot tell a rejoined six-minute
// scan from a stuck one and has no way out of it. The elapsed clock must also count from the scan's
// real start, not from this mount, or a rejoin under-reports the wait it is explaining.
describe("Loading — the restored-work line for a rejoined scan", () => {
  it("names the repo and the elapsed-since-start, and offers a start-over control", () => {
    const onStartFresh = vi.fn();
    render(
      <Loading
        repo="acme/web"
        progress={{ stage: "score", message: "…", pct: 40, provider: "claude-cli" }}
        resumed
        startedAt={Date.now() - 125_000}
        onStartFresh={onStartFresh}
      />,
    );

    const notice = screen.getByTestId("scan-resumed");
    expect(notice.textContent).toContain("acme/web");
    // 125s in: the clock is anchored on the SCAN, not on this mount (which would read 0:00).
    expect(notice.textContent).toMatch(/2m 5s|2:05/);

    const fresh = screen.getByRole("button", { name: /start a fresh scan/i });
    fireEvent.click(fresh);
    expect(onStartFresh).toHaveBeenCalledTimes(1);
  });

  it("renders neither the line nor the control for an ordinary first scan", () => {
    render(<Loading repo="acme/web" progress={{ stage: "score", message: "…", pct: 40 }} />);
    expect(screen.queryByTestId("scan-resumed")).toBeNull();
    expect(screen.queryByRole("button", { name: /start a fresh scan/i })).toBeNull();
  });
});
