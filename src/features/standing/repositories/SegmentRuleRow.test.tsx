// @vitest-environment jsdom
//
// Acceptance case 5 of "Segments keep a rule, not a snapshot": the drift a declared segment carries
// has to be VISIBLE. A segment whose rule matches repos nobody tagged looks complete today, which is
// the defect — the tagged set scopes segment scans and cadence writes, so silence there spends credits
// on last month's fleet.
//
// Two states are pinned, and they must look different: a segment with drift (a count plus an Apply
// control) and a segment with no rule at all (nothing, not an "in sync" claim about a rule it has not
// got).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SegmentRuleRow } from "@/features/standing/repositories/SegmentRuleRow";
import { SegmentCard } from "@/features/standing/repositories/SegmentCard";
import type { SegmentSummary } from "@/lib/db";

const RULE = { kind: "language" as const, values: ["Python"] };

const summary = (over: Partial<SegmentSummary> = {}): SegmentSummary => ({
  id: "seg-1",
  name: "Python services",
  repoCount: 4,
  scannedCount: 2,
  avgOverall: 61,
  avgAdoption: 55,
  avgRigor: 67,
  posture: "scaling",
  dimAverages: [],
  rule: null,
  drift: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true, added: 2, removed: 0 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SegmentRuleRow", () => {
  it("names the untagged matches and offers Apply", () => {
    render(<SegmentRuleRow org="acme" segmentId="seg-1" rule={RULE} drift={{ toAdd: 2, toRemove: 0 }} />);
    expect(screen.getByText(/2 repos match this rule and are not tagged/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /apply rule/i })).toBeTruthy();
  });

  it("states the declared rule itself, so the segment is readable without opening the editor", () => {
    render(<SegmentRuleRow org="acme" segmentId="seg-1" rule={RULE} drift={{ toAdd: 0, toRemove: 0 }} />);
    expect(screen.getByText(/language is Python/i)).toBeTruthy();
  });

  it("drops the drift line and the Apply control once the rule is in sync (after Apply + refresh)", () => {
    render(<SegmentRuleRow org="acme" segmentId="seg-1" rule={RULE} drift={{ toAdd: 0, toRemove: 0 }} />);
    expect(screen.queryByText(/match this rule and are not tagged/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /apply rule/i })).toBeNull();
  });

  it("also surfaces rule-owned rows that no longer match, since the apply will reap them", () => {
    render(<SegmentRuleRow org="acme" segmentId="seg-1" rule={RULE} drift={{ toAdd: 0, toRemove: 3 }} />);
    expect(screen.getByText(/3 tagged by this rule no longer match/i)).toBeTruthy();
  });

  it("Apply posts to the segment's rule endpoint and refreshes the view", async () => {
    render(<SegmentRuleRow org="acme" segmentId="seg-1" rule={RULE} drift={{ toAdd: 2, toRemove: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: /apply rule/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("/api/org/segments/seg-1/rule");
    expect(init.method).toBe("POST");
  });
});

describe("SegmentCard — drift is shown only for a DECLARED segment", () => {
  it("renders the rule row when the segment carries a rule with drift", () => {
    render(<SegmentCard s={summary({ rule: RULE, drift: { toAdd: 2, toRemove: 0 } })} org="acme" repos={[]} taggedCount={2} />);
    expect(screen.getByText(/2 repos match this rule and are not tagged/i)).toBeTruthy();
  });

  it("renders NO drift line at all for a segment with no rule", () => {
    render(<SegmentCard s={summary()} org="acme" repos={[]} taggedCount={2} />);
    expect(screen.queryByText(/match this rule/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /apply rule/i })).toBeNull();
  });
});
