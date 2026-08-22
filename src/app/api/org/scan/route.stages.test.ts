// The fleet stream's SUB-STAGE contract (WP1 item 5).
//
// The stream used to fall silent for the whole duration of a repo's scan — minutes on a live LLM run,
// which reads as a hung wall. It now forwards the scanner's own stages. The risk that introduces is
// arithmetic: four consumers derive "N of M repos" from these frames, and a sub-stage counted as a
// repo would overrun the denominator. So this pins BOTH halves — the stages are emitted, and every
// one of them carries the same index/total as the repo boundary that preceded it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { ScanProgress } from "@/lib/types";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/db", () => ({
  CREDIT_REASON: { SCAN: "scan", GRANT: "grant", ADJUSTMENT: "adjustment", REFUND: "refund", POLAR_REFUND: "polar-refund" },
  consumeScanCredit: vi.fn(async () => ({ ok: true, balance: 9, unlimited: false, charged: true })),
  getInstallationIdForOwner: vi.fn(async () => "inst1"),
  grantCredits: vi.fn(async () => 5),
  isByomActive: vi.fn(async () => false),
  isDbConfigured: () => true,
  listWatchedRepos: vi.fn(),
  persistScanReport: vi.fn(async () => ({ scanId: "s1", deduped: false, headSha: null })),
  persistTeamStandings: vi.fn(async () => false),
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(async () => "tok"), isAppConfigured: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireFleetOrg: vi.fn(async () => null) }));
vi.mock("@/lib/entitlement", () => ({
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: true, balance: 99, allowanceRemaining: 99 })),
  paymentRequired: vi.fn(),
}));

import { POST } from "./route";
import { scanRepository } from "@/lib/scan";
import { listWatchedRepos } from "@/lib/db";
import { SCAN_SUBSTAGES, foldProgressFrame, type ScanProgressState } from "@/lib/scan-stage";
import { parseSSE } from "@/lib/sse";

const report = () =>
  ({
    engine: { provider: "gemini", model: "m" },
    level: { id: "l2" },
    posture: { id: "balanced" },
    overallScore: 50,
    adoptionScore: 50,
    rigorScore: 50,
  }) as unknown as ScanReport;

/** Every stage the scanner emits, in order, ending with the terminal "done". */
const ALL_STAGES: ScanProgress["stage"][] = [...SCAN_SUBSTAGES, "done"];

async function runScan(repos: string[]): Promise<{ event: string | null; data: Record<string, unknown> | null }[]> {
  vi.mocked(listWatchedRepos).mockResolvedValue(
    repos.map((fullName) => ({ fullName, lastScanAt: null })) as unknown as Awaited<ReturnType<typeof listWatchedRepos>>,
  );
  vi.mocked(scanRepository).mockImplementation(async (_repo, opts) => {
    for (const [i, stage] of ALL_STAGES.entries()) {
      opts?.onProgress?.({ stage, message: stage, pct: (i + 1) * 12 });
    }
    return report();
  });
  const res = await POST(
    new Request("http://localhost/api/org/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme" }),
    }),
  );
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map(parseSSE);
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/scan — per-repo scan stages", () => {
  it("emits every scanner sub-stage between the repo's boundary frame and its result", async () => {
    const frames = await runScan(["acme/web"]);
    const names = frames.map((f) => `${f.event}:${String(f.data?.stage ?? f.data?.repo ?? "")}`);
    // boundary → sub-stages → the repo's result → the next boundary
    expect(names).toEqual([
      "progress:scan",
      ...SCAN_SUBSTAGES.map((s) => `progress:${s}`),
      "repo:acme/web",
      "progress:scan",
      "result:",
    ]);
  });

  it("never emits the terminal `done` stage — the `repo` frame is the end of a repo", async () => {
    const frames = await runScan(["acme/web"]);
    expect(frames.some((f) => f.data?.stage === "done")).toBe(false);
  });

  it("sub-stage frames repeat the boundary's index/total, so `done` can never be inflated", async () => {
    const frames = await runScan(["acme/web", "acme/api"]);
    let state: ScanProgressState = { done: 0, total: 2, current: "", stage: null };
    const seen: number[] = [];
    for (const f of frames) {
      if (f.event !== "progress" || !f.data) continue;
      state = foldProgressFrame(state, f.data);
      seen.push(state.done);
    }
    // Per repo: one boundary before the scan, six sub-stages, one boundary after it. Sixteen
    // progress frames for two repos — and `done` still only ever reaches 2.
    expect(seen).toHaveLength(2 * (2 + SCAN_SUBSTAGES.length));
    expect(Math.max(...seen)).toBe(2);
    expect(state.done).toBe(2);
    expect(state.total).toBe(2);
  });

  it("each sub-stage frame names the repo it belongs to", async () => {
    const frames = await runScan(["acme/web", "acme/api"]);
    for (const f of frames) {
      if (f.event === "progress" && f.data && f.data.stage !== "scan") {
        expect(["acme/web", "acme/api"]).toContain(f.data.repo);
        expect(typeof f.data.pct).toBe("number");
      }
    }
  });
});
