// @vitest-environment jsdom
//
// The mechanisms of the diff-comparison scene, one case per technique: keyed alignment finds the move
// and positional manufactures spurious changes; the line level manufactures phantom edits; a stale
// response is dropped by identity and a dead kernel is failure, not an empty diff; the summary count
// carries the detail's predicate; the cut marker is quantified; the self-pair is labelled; whitespace
// suppression is counted and carried by the reference; drift findings keep identity across re-runs.

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import { SURFACE_VOLUMES } from "@/lib/org/surface-catalog";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";
import { diffFields, diffLines } from "./kernel";
import { serialize, signalsFor } from "./fixtures";

const { Scene } = body;
const mount = () =>
  render(
    <MotionScope reduced={false}>
      <Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

describe("kernel", () => {
  const base = signalsFor(50, "scan-1191");
  const cand = signalsFor(50, "scan-1204");

  it("keyed alignment survives the head insertions and reports the move as a move", () => {
    const keyed = diffFields(base, cand, "keyed", 50);
    const positional = diffFields(base, cand, "positional", 50);
    expect(keyed.counts.moved).toBe(1);
    expect(keyed.rows.find((r) => r.kind === "moved")?.key).toBe("sig-8");
    expect(keyed.counts["not-compared"]).toBe(2); // the blob and the volatile stamp
    expect(positional.differences).toBeGreaterThan(keyed.differences * 3);
  });

  it("the line level turns formatting churn into phantom edits, and declines past its budget", () => {
    const lines = diffLines(serialize(base, "a"), serialize(cand, "b"), diffFields(base, cand, "keyed", 0).differences, 24);
    expect(lines.spurious).toBeGreaterThan(50);
    const big = diffLines("x\n".repeat(3000), "y\n".repeat(3000), 0, 24);
    expect(big.rung).toBe("too-large");
    expect(big.remainderKnown).toBe(false);
  });
});

describe("diff-comparison mechanisms", () => {
  it("offload: a stale response is dropped by identity; a dead kernel renders as failure with a retry", async () => {
    vi.useFakeTimers();
    try {
      const { container } = mount();
      const offload = region(container, "computation-offload");
      fireEvent.click(within(offload).getByLabelText("Race a stale response"));
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(offload.textContent).toMatch(/stale responses dropped\s*1/);
      fireEvent.click(within(offload).getByText("kill the kernel"));
      await act(async () => { vi.advanceTimersByTime(700); });
      expect(container.querySelector("[data-diff-state]")?.getAttribute("data-diff-state")).toBe("failed");
      expect(region(container, "diff-honesty").querySelector("[data-honesty-failure]")).toBeTruthy();
      fireEvent.click(within(offload).getByText("revive the kernel"));
      await act(async () => { vi.advanceTimersByTime(700); });
      expect(container.querySelector("[data-diff-state]")?.getAttribute("data-diff-state")).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("modes: summary carries the predicate and escalates to detail on the same pair; the cut is quantified", () => {
    const { container } = mount();
    const modes = region(container, "presentation-modes");
    fireEvent.click(within(modes).getByLabelText("Show summary"));
    const count = modes.querySelector("[data-summary-count]");
    expect(count?.textContent).toMatch(/field level · keyed alignment · ledger v2/);
    const total = Number(count?.getAttribute("data-summary-count"));
    fireEvent.click(within(modes).getByText(/open detail/));
    expect(modes.querySelector("[data-mode]")?.getAttribute("data-mode")).toBe("side-by-side");
    fireEvent.click(within(region(container, "diff-honesty")).getByLabelText("Cut after 4 rows"));
    const cut = modes.querySelector("[data-cut]");
    expect(cut?.getAttribute("data-cut")).toBe("counted");
    expect(cut?.textContent).toContain(`and ${total - 4} more`);
    expect(modes.querySelectorAll("tbody [data-row]")).toHaveLength(4);
    expect(modes.querySelector("[data-unchanged]")).toBeTruthy(); // collapsed, not hidden
  });

  it("pair: the self-pair is labelled, never rendered as an empty finding; a pruned baseline falls back loudly", () => {
    const { container } = mount();
    const pair = region(container, "pair-and-baseline-selection");
    fireEvent.click(within(pair).getByText("select the same scan on both sides"));
    expect(pair.querySelector("[data-pair-notice]")?.getAttribute("data-pair-notice")).toBe("self");
    expect(container.querySelector("[data-diff-state]")?.getAttribute("data-diff-state")).toBe("degenerate");
    fireEvent.click(within(pair).getByText("pick two different scans"));
    fireEvent.click(within(pair).getByLabelText("Baseline species lifecycle"));
    fireEvent.click(within(pair).getByText("retire the remembered baseline"));
    expect(pair.querySelector("[data-pair-notice]")?.getAttribute("data-pair-notice")).toBe("pruned");
    expect(pair.querySelector("[data-pair]")?.getAttribute("data-pair")).toBe("scan-1191 → scan-1204");
  });

  it("level: positional alignment is counted as the trap it is; the ledger has one version", () => {
    const { container } = mount();
    const level = region(container, "semantic-level-selection");
    expect(level.querySelector("[data-ledger-version]")?.getAttribute("data-ledger-version")).toBe("2");
    fireEvent.click(within(level).getByLabelText("Level lines"));
    expect(level.textContent).toMatch(/line level · positional/);
    fireEvent.click(within(level).getByLabelText("Level fields"));
    fireEvent.click(within(level).getByLabelText("Alignment positional"));
    expect(level.textContent).toMatch(/field level · positional alignment/);
  });

  it("invisible: suppression is counted and carried by the reference; the homoglyph drops with a declared repertoire", () => {
    const { container } = mount();
    const inv = region(container, "invisible-differences");
    expect(inv.querySelectorAll("[data-row]")).toHaveLength(7);
    expect(inv.querySelector('[data-row="inv-7"] [data-klass="impersonating"]')).toBeTruthy();
    fireEvent.click(within(inv).getByLabelText("Ignore whitespace"));
    expect(inv.querySelector("table")?.getAttribute("data-suppressed")).toBe("4");
    expect(inv.querySelectorAll("[data-row]")).toHaveLength(3);
    expect(inv.textContent).toContain("ws=ignore");
    fireEvent.click(within(inv).getByLabelText("Declare Cyrillic expected"));
    expect(inv.querySelector('[data-row="inv-7"] [data-klass="impersonating"]')).toBeNull();
  });

  it("drift: findings keep identity across re-runs; amend is attributed and bumps the version; coverage is stated", () => {
    const { container } = mount();
    const drift = region(container, "drift-against-declared");
    expect(drift.textContent).toMatch(/5 of 6 clauses evaluated · 1 unevaluated/);
    expect(drift.querySelector('[data-finding="coverage.min@harbor/lumen-api"]')?.getAttribute("data-drift")).toBe("deviating");
    expect(drift.querySelector('[data-drift="undeclared"]')).toBeTruthy();
    fireEvent.click(within(drift).getByLabelText("Re-run the drift check"));
    fireEvent.click(within(drift).getByLabelText("Re-run the drift check"));
    expect(drift.querySelectorAll('[data-drift="deviating"]')).toHaveLength(2); // still two, not six
    expect(drift.querySelector('[data-finding="coverage.min@harbor/lumen-api"]')?.textContent).toContain("seen 3×");
    fireEvent.click(within(drift).getByLabelText("Amend the promise for line coverage"));
    expect(drift.textContent).toContain("readiness passport v4");
    expect(drift.querySelector("[data-amendments]")?.getAttribute("data-amendments")).toBe("1");
    expect(drift.querySelector('[data-finding="coverage.min@harbor/lumen-api"]')?.getAttribute("data-resolved")).toBe("promise amended");
    fireEvent.click(within(drift).getByLabelText("Fix reality for secrets scanner"));
    expect(drift.querySelector('[data-finding="secrets.scanner@harbor/lumen-api"]')?.getAttribute("data-resolved")).toBe("reality fixed");
  });
});
