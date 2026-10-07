// buildScanScoreInput reads two best-effort lists for a scoped scan — the org's standing decisions on
// the repo (decisionsForRepo) and the craft rungs it already built (getCraftBuilt). An unreachable
// store must never fail a scan: each read degrades to [] and the field is then OMITTED from the score
// input (so the prompt is byte-identical to a first scan's). The door sweep kept that and gave each
// catch a door (degradeTo → console.warn + telemetry naming the read). Pinned: one failed read leaves
// its field out, its sibling still lands (independent catches inside one Promise.all), and the door
// fired with the original error.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RepoSnapshot } from "@/lib/types";
import type { DecisionNote } from "@/lib/db/org-decisions";
import type { CraftBuiltEntry } from "@/lib/llm/provider";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  decisionsForRepo: vi.fn(),
}));
vi.mock("@/lib/db/org-insights-craft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/org-insights-craft")>()),
  getCraftBuilt: vi.fn(),
}));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { buildScanScoreInput } from "./scan-score-input";
import { decisionsForRepo } from "@/lib/db";
import { getCraftBuilt } from "@/lib/db/org-insights-craft";
import { reportHandledError } from "@/lib/api/respond";

const mockDecisions = vi.mocked(decisionsForRepo);
const mockCraft = vi.mocked(getCraftBuilt);
const mockReport = vi.mocked(reportHandledError);

const NOW = "2026-10-05T00:00:00.000Z";
const DECISION: DecisionNote = { module: "security", title: "No CI", status: "dismissed", rationale: "docs-only mirror" };
const RUNG: CraftBuiltEntry = { title: "Agent guide", dimId: "D1", axis: null };

function snap(): RepoSnapshot {
  const files = [{ path: "README.md", content: "# r\n" }];
  return {
    meta: { owner: "acme", name: "api", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  };
}

const build = () =>
  buildScanScoreInput({
    snapshot: snap(),
    prStats: null,
    governance: null,
    securityPosture: null,
    securityExposure: null,
    now: NOW,
    decisionSlug: "acme",
  });

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockDecisions.mockReset().mockResolvedValue([DECISION]);
  mockCraft.mockReset().mockResolvedValue([RUNG]);
  mockReport.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("buildScanScoreInput — decisionsForRepo door", () => {
  it("a thrown decision read omits orgDecisions, keeps craftBuilt, and reaches the door", async () => {
    const boom = new Error("decision store down");
    mockDecisions.mockRejectedValueOnce(boom);

    const { scoreInput } = await build();

    expect(mockDecisions).toHaveBeenCalledWith("acme", "acme/api");
    expect("orgDecisions" in scoreInput).toBe(false);
    expect(scoreInput.craftBuilt).toEqual([RUNG]); // the sibling read is independent

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("scan score input: decisionsForRepo"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan score input: decisionsForRepo"), boom);
  });
});

describe("buildScanScoreInput — getCraftBuilt door", () => {
  it("a thrown craft read omits craftBuilt, keeps orgDecisions, and reaches the door", async () => {
    const boom = new Error("craft ledger down");
    mockCraft.mockRejectedValueOnce(boom);

    const { scoreInput } = await build();

    expect(mockCraft).toHaveBeenCalledWith("acme", "acme/api");
    expect("craftBuilt" in scoreInput).toBe(false);
    expect(scoreInput.orgDecisions).toEqual([DECISION]);

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("scan score input: getCraftBuilt"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan score input: getCraftBuilt"), boom);
  });
});

describe("buildScanScoreInput — both reads", () => {
  it("both failing omit both fields and open two doors, one per read", async () => {
    const d = new Error("d");
    const c = new Error("c");
    mockDecisions.mockRejectedValueOnce(d);
    mockCraft.mockRejectedValueOnce(c);

    const { scoreInput } = await build();

    expect("orgDecisions" in scoreInput).toBe(false);
    expect("craftBuilt" in scoreInput).toBe(false);
    expect(mockReport).toHaveBeenCalledTimes(2);
    expect(mockReport).toHaveBeenCalledWith(d, { message: expect.stringContaining("decisionsForRepo") });
    expect(mockReport).toHaveBeenCalledWith(c, { message: expect.stringContaining("getCraftBuilt") });
  });

  it("both healthy carry both fields and keep the doors shut", async () => {
    const { scoreInput } = await build();

    expect(scoreInput.orgDecisions).toEqual([DECISION]);
    expect(scoreInput.craftBuilt).toEqual([RUNG]);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
