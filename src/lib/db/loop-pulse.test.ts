// THE PULSE READ against a mocked Prisma: that it is ONE lean round (the live columns only, never the
// detail read), and that what comes out is the passive screen's whole answer — lanes with a derived phase,
// who is waiting, what needs the operator, today's counts, and the latest rail.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  run: null as Record<string, unknown> | null,
  drive: null as Record<string, unknown> | null,
  pendingCount: 0,
  pending: [] as Record<string, unknown>[],
  held: [] as { laneId: string | null }[],
  recent: [] as Record<string, unknown>[],
  spend: 0 as number | null,
  calls: {} as Record<string, unknown[]>,
}));
const record = (name: string, args: unknown) => ((db.calls[name] ??= []).push(args), undefined);

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    loopRun: { findFirst: vi.fn(async (a: unknown) => (record("run", a), db.run)) },
    loopDrive: { findFirst: vi.fn(async (a: unknown) => (record("drive", a), db.drive)) },
    loopPlan: {
      count: vi.fn(async () => db.pendingCount),
      findMany: vi.fn(async (a: { where: { status: string } }) => (record(`plans:${a.where.status}`, a), a.where.status === "held" ? db.held : db.pending)),
    },
    loopRunLane: {
      findMany: vi.fn(async (a: unknown) => {
        record("recent", a);
        if (!db.recent) throw new Error("db down");
        return db.recent;
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (s: string) => (s === "acme" ? { id: "org-acme", slug: "acme" } : null)) }));
vi.mock("@/lib/db/runner-spend", () => ({ orgLaneSpendSince: vi.fn(async () => db.spend) }));

import { getLoopPulse, startOfLocalDay } from "@/lib/db/loop-pulse";
import { orgLaneSpendSince } from "@/lib/db/runner-spend";

// 15:00 LOCAL on the machine running the suite, so "since local midnight" means the same thing in every
// timezone the suite runs in.
const NOW = new Date(startOfLocalDay(new Date("2026-09-18T12:00:00.000Z")).getTime() + 15 * 3_600_000);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const act = (kind: string, path: string | null, min: number) => ({ at: ago(min).toISOString(), kind, path, tool: null, note: null });

const lane = (o: Record<string, unknown>) => ({
  id: "lane-x",
  repoFullName: "acme/api",
  cycle: 2,
  phase: "dispatching",
  stage: null,
  stageAt: ago(10),
  heartbeatAt: null,
  startedAt: ago(12),
  deadlineAt: ago(-60),
  activityJson: null,
  diffStatJson: null,
  turns: null,
  costMicros: null,
  planId: null,
  commits: 0,
  armId: null,
  ...o,
});

// The run's arms as stored: TEXT, never jsonb (DSQL has none). Two, so the join has to pick.
const ARMS_JSON = JSON.stringify([
  { id: "claude-1", label: "Claude", transport: "claude", model: "sonnet" },
  { id: "local-2", label: "claude:sonnet plan → pi:qwen3.8:27b", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } },
]);

beforeEach(() => {
  db.calls = {};
  db.run = {
    id: "run-7",
    seq: 7,
    phase: "running",
    cycle: 2,
    maxCycles: 3,
    startedAt: ago(90),
    reposJson: JSON.stringify(["acme/api", "acme/web", "acme/cli", "acme/docs"]),
    armsJson: null,
    lanes: [
      lane({ id: "l-api-1", cycle: 1, phase: "done", commits: 2 }),
      lane({ id: "l-web-1", repoFullName: "acme/web", cycle: 1, phase: "done", commits: 1 }),
      lane({ id: "l-cli-1", repoFullName: "acme/cli", cycle: 1, phase: "done", commits: 0 }),
      lane({ id: "l-docs-1", repoFullName: "acme/docs", cycle: 1, phase: "done", commits: 3 }),
      lane({
        id: "l-api-2",
        activityJson: JSON.stringify([act("read", "src/a.ts", 3), act("read", "src/b.ts", 2), act("read", "src/a.ts", 1.5), act("edit", "src/a.ts", 1)]),
        diffStatJson: JSON.stringify({ files: 1, plus: 4, minus: 1 }),
        planId: "plan-1",
      }),
      lane({ id: "l-web-2", repoFullName: "acme/web", stage: "verifying", activityJson: JSON.stringify([act("read", "x.ts", 8), act("result", null, 7)]), planId: "plan-2" }),
    ],
  };
  db.drive = {
    id: "drive-1",
    phase: "paused",
    pausedReason: "session-limit",
    pausedUntil: ago(-30),
    startedAt: ago(600),
    lastBeatAt: ago(2),
    runsJson: JSON.stringify([{ runId: "r1", endedAt: "x" }, { runId: "r2", endedAt: null }]),
    runsBefore: 0,
    spendCeilingMicros: 100_000_000,
    repoStateJson: JSON.stringify([
      { repo: "acme/api", paused: null },
      { repo: "acme/cli", paused: "dry-backoff" },
      { repo: "acme/web", paused: "branch-conflict" },
    ]),
  };
  db.pendingCount = 3;
  db.pending = [{ repo: "acme/web", planJson: JSON.stringify({ v: 1, intent: "Split the billing module" }), createdAt: ago(40) }];
  db.held = [];
  db.recent = [
    { repoFullName: "acme/api", cycle: 1, phase: "done", closedIdsJson: JSON.stringify(["r1", "r2"]), endedAt: ago(30), landedAt: ago(29), deliverablesJson: JSON.stringify([{ headline: "Added a coverage gate", dimId: "D2", kind: "closed", covers: ["r1"], evidence: null }]), verifyVerdict: "verified", error: null },
    { repoFullName: "acme/docs", cycle: 1, phase: "error", closedIdsJson: "[]", endedAt: ago(20), landedAt: null, deliverablesJson: null, verifyVerdict: null, error: "Agent session exceeded 20 min\nand was stopped." },
    // Yesterday (inside the 24 h rail, outside "today" for this server's clock): rail yes, counts no.
    { repoFullName: "acme/cli", cycle: 3, phase: "done", closedIdsJson: JSON.stringify(["r9"]), endedAt: new Date(startOfLocalDay(NOW).getTime() - 60_000), landedAt: null, deliverablesJson: null, verifyVerdict: "rejected", error: null },
  ];
  db.spend = 4_200_000;
});

describe("getLoopPulse — quiet is the ARM's, not the build default's", () => {
  it("a local arm's 5 m band keeps a lane mid-stream three minutes after its last event", async () => {
    db.run!.armsJson = ARMS_JSON;
    (db.run!.lanes as Record<string, unknown>[])[4]!.armId = "local-2";
    const p = (await getLoopPulse("acme", NOW))!;
    // Three minutes of silence beats the hosted 90 s ceiling by a mile, but a `pi` arm is local, so
    // its band's own 5 m quiet ceiling still counts it as mid-stream.
    expect(p.lanes.find((l) => l.laneId === "l-api-2")!.phase).toBe("agent-editing");
  });

  it("a subscription-seat arm goes quiet", async () => {
    db.run!.armsJson = ARMS_JSON;
    // The same three minutes of silence on the hosted seat (claude:sonnet) is past its 90 s ceiling.
    db.run!.lanes.push(lane({ id: "l-api-3", armId: "claude-1", activityJson: JSON.stringify([act("edit", "src/a.ts", 3)]) }));
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.lanes.find((l) => l.laneId === "l-api-3")!.phase).toBe("agent-quiet");
  });
});

describe("getLoopPulse — the read", () => {
  it("is null without an org to report on", async () => {
    expect(await getLoopPulse("nobody", NOW)).toBeNull();
  });

  it("selects the lanes' LIVE columns only — never the log, the scans, the brief or the report", async () => {
    await getLoopPulse("acme", NOW);
    const select = (db.calls.run![0] as { select: { lanes: { select: Record<string, boolean> } } }).select.lanes.select;
    for (const col of ["phase", "stage", "stageAt", "heartbeatAt", "deadlineAt", "activityJson", "diffStatJson", "turns", "costMicros", "armId"]) {
      expect(select[col]).toBe(true);
    }
    for (const col of ["log", "beforeScanId", "afterScanId", "briefJson", "reportJson"]) expect(select).not.toHaveProperty(col);
    // THE OTHER HALF OF THE JOIN. A selected-but-unpopulated field is a field that does not exist,
    // however carefully the wire type declares it — which is exactly how the theater's arm label
    // rendered nothing for a day. Both columns are pinned here because one without the other is a
    // lane that knows its arm's id and can never name it.
    expect((db.calls.run![0] as { select: Record<string, unknown> }).select.armsJson).toBe(true);
    expect(db.calls.drive![0]).toMatchObject({ where: { orgId: "org-acme", mode: "continuous", endedAt: null } });
    expect(orgLaneSpendSince).toHaveBeenCalledWith("acme", startOfLocalDay(NOW));
  });
});

describe("getLoopPulse — what a passive screen gets", () => {
  it("names the run and shows the current cycle's lanes, each with a derived phase", async () => {
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.org).toBe("acme");
    expect(p.at).toBe(NOW.toISOString());
    expect(p.run).toEqual({ id: "run-7", seq: 7, phase: "running", cycle: 2, maxCycles: 3, startedAt: ago(90).toISOString() });
    expect(p.lanes.map((l) => [l.laneId, l.phase])).toEqual([
      ["l-api-2", "agent-editing"],
      // A planned lane at `verifying` with only its planning session behind it is the BASELINE.
      ["l-web-2", "baseline"],
    ]);
    const api = p.lanes[0]!;
    expect(api.filesRead).toEqual(["src/a.ts", "src/b.ts"]);
    expect(api.filesEdited).toEqual(["src/a.ts"]);
    expect(api.diffStat).toEqual({ files: 1, plus: 4, minus: 1 });
    expect(api.phaseSince).toBe(ago(10).toISOString());
    expect(api.planStep).toBeNull();
    expect(api.tail).toHaveLength(4);
  });

  it("lists the repos waiting for a pool slot — not the one the engine dropped for making no progress", async () => {
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.waiting).toEqual(["acme/docs"]);
  });

  it("projects the continuous drive, and counts what needs the operator — never a timed dry backoff", async () => {
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.runner).toMatchObject({
      driveId: "drive-1",
      phase: "paused",
      pausedReason: "session-limit",
      runsDone: 1,
      spendTodayMicros: 4_200_000,
      spendCeilingMicros: 100_000_000,
    });
    expect(p.runner!.repos).toHaveLength(3);
    expect(p.needsYou).toEqual({ plans: 3, pausedRepos: 1, runnerPaused: true });
  });

  it("counts today since LOCAL midnight — closes, landings and spend — and leaves lift uncomputed", async () => {
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.today).toEqual({ verifiedCloses: 2, landed: 1, liftPoints: null, spendMicros: 4_200_000 });
  });

  it("builds the latest rail newest first: landings, closes, failures, rejections, pending plans, the pause", async () => {
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.latest.map((e) => [e.kind, e.repo, e.headline])).toEqual([
      ["paused", "", "Runner paused — the account hit its session limit"],
      ["failed", "acme/docs", "Agent session exceeded 20 min"],
      ["landed", "acme/api", "Added a coverage gate"],
      ["verified-close", "acme/api", "2 follow-ups verified closed"],
      ["plan-pending", "acme/web", "Split the billing module"],
      ["verified-close", "acme/cli", "1 follow-up verified closed"],
      ["rejected", "acme/cli", "Discarded — repository checks regressed"],
    ]);
  });

  it("reads a lane whose plan was held as held", async () => {
    db.held = [{ laneId: "l-api-2" }];
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.lanes[0]!.phase).toBe("held");
  });

  it("joins each lane to the ARM it is a sample of, and reports an unjoinable one as unknown", async () => {
    db.run!.armsJson = ARMS_JSON;
    (db.run!.lanes as Record<string, unknown>[])[4]!.armId = "local-2";
    (db.run!.lanes as Record<string, unknown>[])[5]!.armId = "gone-9";
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p.lanes[0]!.arm).toMatchObject({ id: "local-2", label: "claude:sonnet plan → pi:qwen3.8:27b", transport: "pi", model: "qwen3.8:27b" });
    // An armId naming no arm of this run is NULL, never a guess and never the first arm.
    expect(p.lanes[1]!.arm).toBeNull();
  });

  it("reports a PRE-ARMS run's lanes as unknown — never as one default arm", async () => {
    (db.run!.lanes as Record<string, unknown>[])[4]!.armId = "claude-1";
    const p = (await getLoopPulse("acme", NOW))!;
    expect(db.run!.armsJson).toBeNull();
    expect(p.lanes.every((l) => l.arm === null)).toBe(true);
  });

  it("reports no run, no lanes and nobody waiting when nothing is armed", async () => {
    db.run = null;
    db.drive = null;
    const p = (await getLoopPulse("acme", NOW))!;
    expect(p).toMatchObject({ run: null, lanes: [], waiting: [], runner: null, needsYou: { plans: 3, pausedRepos: 0, runnerPaused: false } });
  });

  it("throws when a read fails — a screen told nothing says 'reconnecting', it never renders an empty day", async () => {
    db.recent = null as unknown as Record<string, unknown>[];
    await expect(getLoopPulse("acme", NOW)).rejects.toThrow();
  });
});
