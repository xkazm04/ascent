// MC-B13 — the three authored catalogue contracts get their consumers, and the read window states
// its own truncation. Sibling of controlTimeline.test.ts (200-LOC cap under src/features).
//
// `failMeans`, `descriptor` and `stateTone` were written, documented and unit-tested in the
// catalogue, and read by nothing. The consequence was a screenshot: "Published advisories · not
// operating", in red, without the catalogue's own "NOT a statement that the repo is insecure" — which
// reads to a CISO as nine repositories failing a security control. They did not.

import { describe, expect, it } from "vitest";
import { coverageSentence, groupTimeline, timelineDisclosure, truncationSentence } from "./controlTimeline";
import type { ControlCoverage, ControlObservationRow } from "@/lib/db/control-observations";

const obs = (over: Partial<ControlObservationRow> = {}): ControlObservationRow => ({
  id: `o${Math.random()}`,
  orgId: "org_1",
  repoId: "r1",
  repoFullName: "acme/api",
  controlId: "branch-protection",
  state: "pass",
  value: "true",
  prevState: null,
  prevValue: null,
  evidenceJson: "{}",
  source: "probe",
  actorLogin: null,
  transition: false,
  occurredAt: "2026-08-20T00:00:00.000Z",
  observedAt: "2026-08-20T00:00:00.000Z",
  scanId: null,
  jobId: null,
  deliveryId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  ...over,
});

const cov = (over: Partial<ControlCoverage> = {}): ControlCoverage => ({
  repoFullName: "acme/api",
  controlId: "branch-protection",
  firstObservedAt: "2026-08-01T00:00:00.000Z",
  lastObservedAt: "2026-08-20T00:00:00.000Z",
  observations: 4,
  sources: ["probe"],
  maxGapDays: 1,
  lastState: "pass",
  windowTruncated: false,
  ...over,
});

describe("catalogue contracts reach the row", () => {
  it("carries failMeans on a FAILING row — the disclaimer ships with the red state", () => {
    const row = groupTimeline([obs({ controlId: "advisories", state: "fail", value: null })])[0]!;
    expect(row.failMeans).toContain("NOT a statement that the repo is insecure");
    expect(row.tone).toBe("bad");
  });

  it("carries NO failMeans on a passing or unmeasurable row — it says what a FAIL means", () => {
    expect(groupTimeline([obs({ controlId: "advisories", state: "pass" })])[0]!.failMeans).toBeNull();
    expect(groupTimeline([obs({ controlId: "advisories", state: "unmeasurable" })])[0]!.failMeans).toBeNull();
  });

  it("flags the descriptor control, so a surface renders its VALUE and not a verdict", () => {
    const vis = groupTimeline([obs({ controlId: "repo-visibility", state: "pass", value: "public" })])[0]!;
    expect(vis.descriptor).toBe(true);
    expect(vis.value).toBe("public");
    // A bar is not a descriptor: the distinction is the whole point of the flag.
    expect(groupTimeline([obs({ controlId: "branch-protection" })])[0]!.descriptor).toBe(false);
  });

  it("takes the tone from stateTone — unmeasurable is 'unknown', never a colour word", () => {
    expect(groupTimeline([obs({ state: "unmeasurable" })])[0]!.tone).toBe("unknown");
    expect(groupTimeline([obs({ state: "pass" })])[0]!.tone).toBe("good");
  });

  it("says the coverage count is a FLOOR when the read window was capped", () => {
    expect(coverageSentence(cov({ observations: 2000, windowTruncated: true }))).toContain("at least");
    expect(coverageSentence(cov())).not.toContain("at least");
  });
});

// The route computed `truncated`/`limit` and the card never called the route, so the surface a
// compliance reader screenshots was the one with no completeness disclosure on it at all.
describe("the read window states its own truncation", () => {
  it("is truncated when the page came back at the effective limit", () => {
    expect(timelineDisclosure(400, 400, 2000)).toEqual({ truncated: true, limit: 400 });
  });

  it("clamps the requested limit to the cap, so the disclosure states what was really applied", () => {
    expect(timelineDisclosure(2000, 9999, 2000)).toEqual({ truncated: true, limit: 2000 });
  });

  it("is not truncated on a short page, and says nothing rather than 'showing N of N'", () => {
    expect(timelineDisclosure(12, 400, 2000).truncated).toBe(false);
    expect(truncationSentence(timelineDisclosure(12, 400, 2000))).toBeNull();
  });

  it("names the limit, and refuses to let a slice read as a fleet total", () => {
    const s = truncationSentence(timelineDisclosure(400, 400, 2000))!;
    expect(s).toContain("400");
    expect(s).toContain("NOT the org's complete ledger");
  });
});
