// The matrix fold, pinned: chronological columns, repo groups led by the latest run's repos, titles
// from BOTH sources (recs moved to done + closed follow-up ids resolved to titles) deduped, and the
// attribution rule holding — a within-noise cell is a word, never a number, and never summed.

import { describe, expect, it } from "vitest";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";
import { groupDeliverables } from "./outcomeDeliverables";
import { shortTitle, takeaway, verdictWord } from "./outcomeText";

const scan = (p: Partial<ComparableScan> & { id: string }): ComparableScan => ({
  scannedAt: "2026-08-22T10:00:00.000Z",
  overallScore: 50,
  level: "L3",
  levelName: "Augmented",
  archetype: "org",
  adoptionScore: 50,
  rigorScore: 50,
  posture: "manual",
  confidence: 0.8,
  engineProvider: "anthropic",
  engineModel: "claude",
  engineDegraded: false,
  headSha: null,
  dimensions: DIMENSIONS.map((d) => ({ dimId: d.id, name: d.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
  recommendations: [],
  ...p,
});

const lane = (o: Partial<LoopLaneRecord>): LoopLaneRecord => ({
  id: "l", runId: "r", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
  commits: 2, beforeScanId: "b", afterScanId: "a", stage: null, log: [], error: null, startedAt: null, endedAt: null, deliverables: [], ...o,
});

const rec = (id: string, title: string, status = "open") => ({ id, title, dimId: "D2", status });
const before = scan({ id: "b", overallScore: 40, recommendations: [rec("rec-1", "Add a coverage gate to CI"), rec("rec-2", "Write CONTRIBUTING.md")] });
const after = scan({ id: "a", overallScore: 52, recommendations: [rec("rec-1", "Add a coverage gate to CI", "done"), rec("rec-2", "Write CONTRIBUTING.md")] });

const outcome = (o: Partial<LoopLaneOutcome> & { lane: LoopLaneRecord }): LoopLaneOutcome => ({
  kind: "backlog", before, after, diff: diffScans(before, after), closedFollowUpIds: ["rec-1", "rec-2"], commits: 2,
  deliverables: [{ headline: "Added a coverage gate to CI", dimId: "D2", kind: "closed", covers: ["rec-1"], evidence: "Add a coverage gate to CI" }], ...o,
});

const detail = (id: string, startedAt: string, outcomes: LoopLaneOutcome[], phase: LoopRunDetail["run"]["phase"] = "done"): LoopRunDetail => ({
  run: {
    id, orgId: "o", createdBy: null, phase, repos: outcomes.map((o) => o.lane.repoFullName), targets: [], concurrency: 2, maxCycles: 3,
    cycle: 1, curated: true, model: "sonnet", effort: null, startedAt, endedAt: null, error: null, createdAt: startedAt,
  },
  lanes: outcomes.map((o) => o.lane),
  outcomes,
});

const run1 = detail("run-1", "2026-08-20T10:00:00Z", [outcome({ lane: lane({ id: "l1", runId: "run-1", repoFullName: "acme/two" }) })]);
const run2 = detail("run-2", "2026-08-22T10:00:00Z", [
  outcome({ lane: lane({ id: "l2", runId: "run-2" }) }),
  outcome({
    lane: lane({ id: "l3", runId: "run-2", repoFullName: "acme/noise" }),
    after: scan({ id: "an", overallScore: 41 }),
    diff: diffScans(before, scan({ id: "an", overallScore: 41 })),
    closedFollowUpIds: [],
  }),
]);

describe("buildOutcomeMatrix", () => {
  const m = buildOutcomeMatrix([run2, run1]);

  it("orders columns chronologically and names the latest", () => {
    expect(m.columns.map((c) => c.id)).toEqual(["run-1", "run-2"]);
    expect(m.latestId).toBe("run-2");
    expect(m.columns[1]!.agentConfig).toBe("sonnet");
  });

  it("leads with the repos the latest run touched, then the rest alphabetically", () => {
    expect(m.groups.map((g) => g.repo)).toEqual(["acme/noise", "acme/one", "acme/two"]);
  });

  it("lists deliverable titles from the diff and the closed follow-ups, deduped", () => {
    const cell = m.groups.find((g) => g.repo === "acme/one")!.cells["run-2"]!;
    expect(cell.titles).toEqual(["Add a coverage gate to CI", "Write CONTRIBUTING.md"]);
    expect(cell.verdict).toEqual({ kind: "attributable", delta: 12 });
    expect(cell.commits).toBe(2);
    expect(cell.installed).toBeNull();
  });

  it("holds a within-noise lane out of every sum and gives it a word instead", () => {
    const noise = m.groups.find((g) => g.repo === "acme/noise")!;
    expect(noise.cells["run-2"]!.verdict.kind).toBe("within-noise");
    expect(verdictWord(noise.cells["run-2"]!.verdict)).toBe("within noise");
    expect(noise.lift).toBeNull();
    expect(m.columns[1]!.lift).toBe(12);
    expect(m.totals.lift).toBe(24);
  });

  it("names a deterministic lane's install as its first deliverable", () => {
    const f = buildOutcomeMatrix([detail("r", "2026-08-23T10:00:00Z", [outcome({ lane: lane({ id: "lf" }), kind: "foundation" })])]);
    expect(f.groups[0]!.cells["r"]!.installed).toBe(".ai/ foundation installed");
  });

  it("marks a running run's column live", () => {
    const live = detail("r-live", "2026-08-24T10:00:00Z", [outcome({ lane: lane({ id: "ll", phase: "rescanning", stage: "files" }), after: null, diff: null })], "running");
    const lm = buildOutcomeMatrix([run1, live]);
    expect(lm.columns[1]!.live).toBe(true);
    expect(lm.groups[0]!.cells["r-live"]!.stage).toBe("files");
  });
});

describe("mergeRunDetails", () => {
  it("lets a later detail replace the snapshot of the same run", () => {
    const fresh = { ...run2, run: { ...run2.run, phase: "stopped" as const } };
    expect(mergeRunDetails([run1, run2], null, fresh).map((d) => d.run.phase)).toEqual(["done", "stopped"]);
  });
});

describe("outcomeText", () => {
  it("writes the takeaway from the attributable total only", () => {
    expect(takeaway(buildOutcomeMatrix([run1, run2]))).toBe("Fleet climbed ▲+24 across 2 runs");
    expect(takeaway(buildOutcomeMatrix([]))).toBe("No runs yet");
  });
  it("clips a title at ~24 characters with an ellipsis", () => {
    expect(shortTitle("Add a coverage gate to CI")).toBe("Add a coverage gate to…");
    expect(shortTitle("Short")).toBe("Short");
  });
});

describe("deliverables - the cell rows", () => {
  const m = buildOutcomeMatrix([run2, run1]);

  it("lists each lane's headlines and keeps the follow-up titles only as evidence", () => {
    const cell = m.groups.find((g) => g.repo === "acme/one")!.cells["run-2"]!;
    expect(cell.deliverables.map((d) => d.headline)).toEqual(["Added a coverage gate to CI"]);
    expect(cell.deliverables[0]!.covers).toEqual(["rec-1"]);
    expect(cell.titles).toEqual(["Add a coverage gate to CI", "Write CONTRIBUTING.md"]);
  });

  it("orders by kind (closed, installed, hardened, regressed) then dimension, merging duplicates", () => {
    const a = outcome({
      lane: lane({ id: "x1" }),
      deliverables: [
        { headline: "Hardened CI/CD security", dimId: "D9", kind: "hardened", covers: ["SAST"], evidence: null },
        { headline: "Installed the .ai/ foundation", dimId: null, kind: "installed", covers: [], evidence: null },
        { headline: "Added agent-readable docs", dimId: "D8", kind: "hardened", covers: [], evidence: null },
      ],
    });
    const b = outcome({
      lane: lane({ id: "x2", cycle: 2 }),
      deliverables: [
        { headline: "Hardened CI/CD security", dimId: "D9", kind: "hardened", covers: ["token permissions"], evidence: "D9 +20 · gained token permissions" },
        { headline: "Added permissions scope to workflows", dimId: "D9", kind: "closed", covers: ["rec-9"], evidence: null },
      ],
    });
    const rows = groupDeliverables([a, b]);
    expect(rows.map((d) => `${d.kind}:${d.headline}`)).toEqual([
      "closed:Added permissions scope to workflows",
      "installed:Installed the .ai/ foundation",
      "hardened:Added agent-readable docs",
      "hardened:Hardened CI/CD security",
    ]);
    const d9 = rows.find((d) => d.headline === "Hardened CI/CD security")!;
    expect(d9.covers).toEqual(["SAST", "token permissions"]);
    expect(d9.evidence).toBe("D9 +20 · gained token permissions");
  });

  it("prints NO movement prose under a refused verdict - the words answer to the number's rule", () => {
    const noise = m.groups.find((g) => g.repo === "acme/noise")!.cells["run-2"]!;
    expect(noise.verdict.kind).toBe("within-noise");
    expect(noise.movements).toEqual([]);
    const lost = buildOutcomeMatrix([detail("r0", "2026-08-25T10:00:00Z", [outcome({ lane: lane({ id: "l0", commits: 0 }), commits: 0 })])]);
    const cell = lost.groups[0]!.cells["r0"]!;
    expect(cell.verdict.kind).toBe("undelivered");
    expect(cell.movements).toEqual([]);
    // ...while an attributable cell keeps its (humanised) lines.
    const moved = scan({
      id: "am",
      overallScore: 52,
      dimensions: DIMENSIONS.map((d) => ({ dimId: d.id, name: d.name, score: d.id === "D9" ? 70 : 50, signalScore: d.id === "D9" ? 70 : 50, evidence: d.id === "D9" ? ["SAST [posture/medium]: 10/10 — SAST runs on PR/push."] : [], gaps: [] })),
    });
    const okRun = buildOutcomeMatrix([detail("r1", "2026-08-25T10:00:00Z", [outcome({ lane: lane({ id: "l1" }), after: moved, diff: diffScans(before, moved) })])]);
    expect(okRun.groups[0]!.cells["r1"]!.movements).toEqual(["D9 +20 · gained SAST"]);
  });
});

