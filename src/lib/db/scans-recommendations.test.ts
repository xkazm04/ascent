// Pins updateRecommendation — the backlog's only mutation + audit path. The load-bearing invariant:
// a committed field change and its audit row are written TOGETHER inside one $transaction, so a
// refactor that pulls auditLog.create back outside the tx (a documented prior regression) can never
// commit a status/owner/due-date change with no audit row. Also pins audit tenant-scope (orgId
// resolved onto the row so it's readable) and change-detection (a no-op patch writes nothing).
//
// Harness mirrors src/lib/db/credits.test.ts: mock @/lib/db/client, model $transaction(fn) as
// running fn(tx) against a tx whose update / createMany / auditLog.create are vi.fn()s, so we can
// assert WHAT was invoked ON THE TX OBJECT (atomicity) rather than coupling to call order.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { updateRecommendation, getRecommendationEvents, handoffRecommendations, REC_EVENTS_LIMIT } from "./scans-recommendations";
import { toPersistedRec } from "./scans-shared";
import { verifyAudit } from "./audit-integrity";

/** A minimal Recommendation row that satisfies toPersistedRec's field reads. */
function recRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec_1",
    title: "Add CI gate",
    dimId: "automation",
    impact: "high",
    effort: "medium",
    rationale: "because",
    explore: "[]",
    levelUnlock: null,
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...overrides,
  };
}

/**
 * Fake prisma for updateRecommendation. The top-level client serves ONE pre-transaction read:
 *   - findUnique(where:{id}, include:{...org}) -> the current row WITH its scan->repo->orgId chain
 *     merged in (or null to force P2025)
 * $transaction(fn) runs fn(tx) against a tx whose update / event-createMany / auditLog.create are
 * spies, so a test can assert all three landed on the SAME tx object (one atomic commit).
 *
 * `orgId` controls the resolved rec->scan->repo->org chain (null models a missing chain).
 */
function fakePrisma(
  current: ReturnType<typeof recRow> | null,
  opts: { orgId?: string | null; conflict?: boolean } = {},
) {
  const orgId = opts.orgId === undefined ? "org_1" : opts.orgId;

  // The optimistic-lock update is now a conditional updateMany (keyed on the pre-image) followed by a
  // findUniqueOrThrow re-read. updateMany returns count:0 when `conflict` is set (a concurrent write
  // landed first → updateRecommendation throws REC_CONFLICT and the tx rolls back).
  let appliedData: Record<string, unknown> = {};
  const tx = {
    recommendation: {
      updateMany: vi.fn(async ({ data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        appliedData = data;
        return { count: opts.conflict ? 0 : 1 };
      }),
      // Re-read returns the post-update row so toPersistedRec maps the committed state.
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        ...current,
        ...appliedData,
        id: where.id,
      })),
    },
    recommendationEvent: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    auditLog: {
      create: vi.fn(async () => ({ id: "audit_1" })),
    },
  };

  const orgChain = { scan: { repo: { orgId } } };

  // ONE findUnique({ where, include: {...org} }) now serves both the row scalars AND the org chain,
  // so the mock returns the current row with its scan->repo->orgId merged in (null -> P2025).
  const findUnique = vi.fn(async (_args: { where: { id: string }; include?: unknown }) =>
    current ? { ...current, ...orgChain } : null,
  );

  const prisma = {
    recommendation: { findUnique },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, tx };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("updateRecommendation — atomic mutation + audit", () => {
  it("writes the row update AND the audit row inside the SAME $transaction on a real change", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
    mockGetPrisma.mockReturnValue(prisma);

    await updateRecommendation("rec_1", { status: "in_progress" }, { actor: "alice", note: "starting" });

    // Atomicity: the field change AND its audit row are both invoked on the tx object handed to the
    // transaction callback — never on the top-level client. No committed change without its audit row.
    expect(tx.recommendation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.recommendationEvent.createMany).toHaveBeenCalledTimes(1);

    // The bare client must NOT carry the audit write (that would be a non-atomic post-tx regression).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // The conditional update applies only the changed field AND keys the optimistic lock on the read
    // pre-image of ONLY the fields this patch writes (here: status) — NOT the whole editable tuple,
    // so a concurrent edit to an UNTOUCHED field (assignee/due-date) doesn't raise a false conflict.
    expect(tx.recommendation.updateMany).toHaveBeenCalledWith({
      where: { id: "rec_1", status: "open" },
      data: { status: "in_progress" },
    });
  });

  it("stamps the audit row with the resolved org scope and the actual change (old -> new)", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
    mockGetPrisma.mockReturnValue(prisma);

    await updateRecommendation("rec_1", { status: "done" }, { actor: "bob" });

    const auditArg = tx.auditLog.create.mock.calls[0][0] as {
      data: { action: string; orgId: string | null; actorId: string | null; meta: string };
    };
    expect(auditArg.data.action).toBe("recommendation.updated");
    expect(auditArg.data.orgId).toBe("org_42"); // readable in the audit viewer (getAuditLog filters by orgId)
    expect(auditArg.data.actorId).toBeNull();

    const meta = JSON.parse(auditArg.data.meta);
    expect(meta).toMatchObject({
      id: "rec_1",
      actor: "bob",
      changes: [{ kind: "status", from: "open", to: "done" }],
    });
  });

  it("records exactly one event per actually-changed field across a multi-field patch", async () => {
    const { prisma, tx } = fakePrisma(
      recRow({ status: "open", assigneeLogin: "old", targetDate: new Date("2026-01-01") }),
    );
    mockGetPrisma.mockReturnValue(prisma);

    // status changes, assignee changes, but targetDate resolves to the SAME calendar day -> no event.
    await updateRecommendation(
      "rec_1",
      { status: "in_progress", assigneeLogin: "new", targetDate: "2026-01-01" },
      { actor: "carol" },
    );

    const events = tx.recommendationEvent.createMany.mock.calls[0][0].data as Array<{
      kind: string;
      fromValue: string | null;
      toValue: string | null;
    }>;
    expect(events.map((e) => e.kind).sort()).toEqual(["assignee", "status"]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "status", fromValue: "open", toValue: "in_progress" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "assignee", fromValue: "old", toValue: "new" }),
    );

    // The audit meta lists exactly the two real changes — its change count equals the event count.
    const auditArg = tx.auditLog.create.mock.calls[0][0] as { data: { meta: string } };
    expect(JSON.parse(auditArg.data.meta).changes).toHaveLength(2);
  });

  // --- note contract (roadmap-recommendation-tracking 07-16 #1) ---
  it("attaches the note to the FIRST change event only — one comment must not read as N comments", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open", assigneeLogin: "old" }));
    mockGetPrisma.mockReturnValue(prisma);

    await updateRecommendation(
      "rec_1",
      { status: "in_progress", assigneeLogin: "new" },
      { actor: "carol", note: "blocked on infra" },
    );

    const events = tx.recommendationEvent.createMany.mock.calls[0][0].data as Array<{ note: string | null }>;
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.note === "blocked on infra")).toHaveLength(1);
    expect(events[0].note).toBe("blocked on infra");
    expect(events[1].note).toBeNull();
  });

  it("a note on a no-op patch is NOT discarded: writes a dedicated 'note' event (no row update, audit kept)", async () => {
    // Previously updateRecommendation returned at events.length === 0 and the note vanished with a 200.
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }));
    mockGetPrisma.mockReturnValue(prisma);

    const result = await updateRecommendation("rec_1", { status: "open" }, { actor: "dave", note: "still relevant" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // No field changed -> no row write, and therefore no optimistic-lock conflict surface.
    expect(tx.recommendation.updateMany).not.toHaveBeenCalled();
    const events = tx.recommendationEvent.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(events).toEqual([
      expect.objectContaining({ kind: "note", fromValue: null, toValue: null, note: "still relevant", actor: "dave" }),
    ]);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: "rec_1", status: "open" });
  });

  it("change-detection: a no-op patch writes NO row update, NO event, NO audit row", async () => {
    const { prisma, tx } = fakePrisma(recRow({ status: "open", assigneeLogin: "alice" }));
    mockGetPrisma.mockReturnValue(prisma);

    // Same status and same (trimmed) assignee -> nothing actually changed.
    const result = await updateRecommendation("rec_1", { status: "open", assigneeLogin: "  alice  " });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendation.updateMany).not.toHaveBeenCalled();
    expect(tx.recommendationEvent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    // Returns the current rec, mapped to the persisted shape.
    expect(result).toMatchObject({ id: "rec_1", status: "open", assigneeLogin: "alice" });
  });

  it("returns null and touches nothing when the DB is disabled", async () => {
    const { prisma, tx } = fakePrisma(recRow());
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(prisma);

    const result = await updateRecommendation("rec_1", { status: "done" });

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("throws P2025 (not-found) for a missing id, before any transaction runs", async () => {
    const { prisma, tx } = fakePrisma(null);
    mockGetPrisma.mockReturnValue(prisma);

    await expect(updateRecommendation("missing", { status: "done" })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendation.updateMany).not.toHaveBeenCalled();
  });

  it("throws REC_CONFLICT and writes NO event/audit when the pre-image no longer matches (lost-update guard)", async () => {
    // updateMany matches 0 rows = a concurrent edit changed the row since we read it. The whole tx must
    // roll back (no event, no audit) and the error must be tagged so the route returns 409, not 500.
    const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { conflict: true });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(updateRecommendation("rec_1", { status: "done" }, { actor: "alice" })).rejects.toMatchObject({
      code: "REC_CONFLICT",
    });
    expect(tx.recommendation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.recommendationEvent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

// ── getRecommendationEvents — the activity timeline read order (newest-first + stable tiebreak) ──
// The timeline is the audit narrative "who changed what, when". Its ordering is deliberate
// (roadmap-recommendation-tracking #5a): orderBy [{createdAt:"desc"},{id:"desc"}] — newest first,
// with id desc as a STABLE tiebreak so two events written in the same millisecond (a multi-field
// patch writes several rows in one createMany) return in a deterministic order rather than arbitrary.
// We assert the orderBy is pinned at the query layer AND that the mapped result preserves that order
// and ISO-formats `at` — so a refactor that drops the tiebreak (a quietly-wrong narrative) is caught.

describe("getRecommendationEvents — newest-first timeline order + ISO mapping", () => {
  function fakePrismaForEvents(rows: Array<Record<string, unknown>>) {
    const findMany = vi.fn(async () => rows);
    return { prisma: { recommendationEvent: { findMany } }, findMany };
  }

  it("queries with the documented newest-first + stable id tiebreak orderBy", async () => {
    const { prisma, findMany } = fakePrismaForEvents([]);
    mockGetPrisma.mockReturnValue(prisma);

    await getRecommendationEvents("rec_1");

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: { recommendationId: string }; orderBy: unknown };
    expect(args.where).toEqual({ recommendationId: "rec_1" });
    // The exact, order-sensitive tiebreak: createdAt desc FIRST, then id desc. Dropping the id
    // tiebreak lets same-millisecond events return in arbitrary order — a wrong audit narrative.
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("preserves the DB row order in the mapped result and ISO-formats `at`", async () => {
    // Rows as the DB returns them under the desc orderBy (newest first). The mapper must NOT re-sort.
    const newer = new Date("2026-06-09T12:00:00.000Z");
    const older = new Date("2026-06-08T09:30:00.000Z");
    const { prisma } = fakePrismaForEvents([
      { id: "ev_2", actor: "alice", kind: "status", fromValue: "open", toValue: "done", note: null, createdAt: newer },
      { id: "ev_1", actor: "bob", kind: "assignee", fromValue: null, toValue: "octocat", note: "n", createdAt: older },
    ]);
    mockGetPrisma.mockReturnValue(prisma);

    const events = await getRecommendationEvents("rec_1");

    expect(events!.map((e) => e.id)).toEqual(["ev_2", "ev_1"]); // newest-first order preserved
    expect(events![0]).toEqual({
      id: "ev_2",
      actor: "alice",
      kind: "status",
      from: "open",
      to: "done",
      note: null,
      at: "2026-06-09T12:00:00.000Z", // createdAt -> ISO string
    });
    expect(events![1].at).toBe("2026-06-08T09:30:00.000Z");
  });

  it("returns null without querying when persistence is disabled", async () => {
    const { prisma, findMany } = fakePrismaForEvents([]);
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(prisma);

    expect(await getRecommendationEvents("rec_1")).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  // D11: the read is BOUNDED. RecommendationEvent is append-only and grows with every status flip,
  // behind a route any org reader can call, so an unbounded findMany let a caller grow the page by
  // toggling a status. The bound is on the query, and the order stays newest-first so what is dropped
  // is the oldest history, never the current state.
  it("bounds the read at REC_EVENTS_LIMIT, newest-first", async () => {
    const { prisma, findMany } = fakePrismaForEvents([]);
    mockGetPrisma.mockReturnValue(prisma);

    await getRecommendationEvents("rec_1");

    const args = findMany.mock.calls[0][0] as { take: number; orderBy: unknown };
    expect(args.take).toBe(REC_EVENTS_LIMIT);
    expect(REC_EVENTS_LIMIT).toBe(200);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("honours an explicit smaller bound", async () => {
    const { prisma, findMany } = fakePrismaForEvents([]);
    mockGetPrisma.mockReturnValue(prisma);

    await getRecommendationEvents("rec_1", 5);

    expect((findMany.mock.calls[0][0] as { take: number }).take).toBe(5);
  });
});

// ── toPersistedRec — the corrupt-data firewall on every recommendation read ──────────────────
// toPersistedRec is the SINGLE normalization choke point shared by the read path
// (getLatestRecommendations) and this module's write path (updateRecommendation's return mapping).
// Its whole reason to exist is to tolerate a corrupt persisted row — malformed/`null`/object/
// mixed-type `explore` JSON, a stray Date — WITHOUT throwing and WITHOUT shipping a non-string
// `explore` entry into the report UI. One bad row would otherwise blank the backlog list and break
// every edit on that scan. These pure cases pin that firewall (no mocks needed — toPersistedRec is
// a pure mapper). Imported from scans-shared.ts, the file the finding targets.

/** The non-`explore` fields of a well-formed row, so each case isolates the `explore` behavior. */
function baseRecFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec_1",
    title: "Add CI gate",
    dimId: "automation",
    impact: "high",
    effort: "medium",
    rationale: "because",
    levelUnlock: null as string | null,
    status: "open",
    assigneeLogin: null as string | null,
    targetDate: null as Date | null,
    ...overrides,
  };
}

describe("toPersistedRec — corrupt-data firewall", () => {
  it("maps a fully well-formed row to the correct persisted shape, verbatim", () => {
    const out = toPersistedRec({
      ...baseRecFields({
        levelUnlock: "level-3",
        status: "in_progress",
        assigneeLogin: "octocat",
        targetDate: new Date("2026-06-09T13:45:00.000Z"),
      }),
      explore: JSON.stringify(["What blocks the gate?", "Who owns CI?"]),
    });

    // status / owner / level survive a valid row verbatim; targetDate is sliced to YYYY-MM-DD.
    expect(out).toEqual({
      id: "rec_1",
      title: "Add CI gate",
      dimension: "automation",
      impact: "high",
      effort: "medium",
      rationale: "because",
      explore: ["What blocks the gate?", "Who owns CI?"],
      levelUnlock: "level-3",
      status: "in_progress",
      assigneeLogin: "octocat",
      targetDate: "2026-06-09",
    });
  });

  // ── explore JSON: corrupt input degrades to a SAFE string[] — never throws, never non-string ──
  it.each<[string, string | undefined, string[]]>([
    ["empty JSON array", "[]", []],
    ["valid string array", '["a","b"]', ["a", "b"]],
    ["malformed JSON", "{not json", []],
    ["JSON object (not an array)", '{"a":1}', []],
    ["array with mixed non-string entries", '["ok", 1, null, true, "two"]', ["ok", "two"]],
    ["JSON null", "null", []],
    ["JSON number", "42", []],
    ["nested arrays/objects as entries", '[["x"], {"y":1}, "keep"]', ["keep"]],
    ["undefined column (absent)", undefined, []],
  ])("explore: %s -> string-only array, no throw", (_label, explore, expected) => {
    let out: ReturnType<typeof toPersistedRec> | undefined;
    expect(() => {
      out = toPersistedRec({ ...baseRecFields(), explore });
    }).not.toThrow();
    expect(out!.explore).toEqual(expected);
    // The firewall invariant: every surviving entry is a string (never a number/null/object that
    // would crash the report UI consumer).
    expect(out!.explore.every((x) => typeof x === "string")).toBe(true);
  });

  it("targetDate: a Date maps to YYYY-MM-DD and null maps to null", () => {
    expect(
      toPersistedRec({ ...baseRecFields({ targetDate: new Date("2026-12-31T23:59:59Z") }) }).targetDate,
    ).toBe("2026-12-31");
    expect(toPersistedRec({ ...baseRecFields({ targetDate: null }) }).targetDate).toBeNull();
  });

  it("nullable fields normalize: levelUnlock null -> undefined, assigneeLogin null -> null", () => {
    const out = toPersistedRec({ ...baseRecFields({ levelUnlock: null, assigneeLogin: null }) });
    expect(out.levelUnlock).toBeUndefined();
    expect(out.assigneeLogin).toBeNull();
  });

  it("never throws on a row whose explore is the worst-case corrupt blob", () => {
    // A single bad row used to blank the whole list + break every edit on that scan. Prove the
    // mapper absorbs it and still returns a usable object the consumer can render.
    let out: ReturnType<typeof toPersistedRec> | undefined;
    expect(() => {
      out = toPersistedRec({ ...baseRecFields(), explore: '["good", {"bad":1}, 7, null, "also-good"' });
    }).not.toThrow();
    // Malformed (unterminated) JSON -> caught -> safe empty default, not a partial/garbage array.
    expect(out!.explore).toEqual([]);
    expect(out!.id).toBe("rec_1"); // rest of the object still maps — no crash mid-map.
  });

  // ── ADVERSARIAL stored explore JSON: deeply-nested, huge, and prototype-pollution-shaped ─────
  // The firewall sits on UNTRUSTED stored bytes (a prior bug, a manual DB edit, a hostile import).
  // Beyond merely-corrupt, prove it absorbs *adversarial* shapes — without throwing, polluting the
  // prototype chain, or shipping a single non-string into the report-UI consumer.

  it("deeply-nested array entries are dropped, not flattened, and never throw (no stack blowup)", () => {
    // A pathologically deep nested array as a single entry — JSON.parse handles the depth; the
    // top-level filter sees one non-string element and drops it. A "keep" sibling still survives.
    const depth = 5000;
    const deep = `${"[".repeat(depth)}1${"]".repeat(depth)}`;
    let out: ReturnType<typeof toPersistedRec> | undefined;
    expect(() => {
      out = toPersistedRec({ ...baseRecFields(), explore: `[${deep}, "keep"]` });
    }).not.toThrow();
    // Only the top-level string survives; the nested array is a non-string entry -> dropped.
    expect(out!.explore).toEqual(["keep"]);
    expect(out!.explore.every((x) => typeof x === "string")).toBe(true);
  });

  it("a huge array degrades to only its string members and never ships a non-string", () => {
    // 20k entries alternating string / number — a payload-size attack. The mapper must keep every
    // string, drop every number, and never let a non-string through to the consumer.
    const entries: unknown[] = [];
    for (let i = 0; i < 20_000; i++) entries.push(i % 2 === 0 ? `s${i}` : i);
    let out: ReturnType<typeof toPersistedRec> | undefined;
    expect(() => {
      out = toPersistedRec({ ...baseRecFields(), explore: JSON.stringify(entries) });
    }).not.toThrow();
    expect(out!.explore).toHaveLength(10_000);
    expect(out!.explore.every((x) => typeof x === "string")).toBe(true);
    expect(out!.explore[0]).toBe("s0");
    expect(out!.explore.at(-1)).toBe("s19998");
  });

  it("a prototype-pollution-shaped object is non-array -> drops to [] and does NOT pollute Object.prototype", () => {
    // The classic __proto__ / constructor.prototype payload. explore is an OBJECT (not an array),
    // so the Array.isArray guard rejects it wholesale -> []. Crucially, parsing + mapping must not
    // mutate the global prototype: ({}).polluted stays undefined for every prototype-shaped key.
    const payloads = [
      '{"__proto__":{"polluted":true}}',
      '{"constructor":{"prototype":{"polluted":true}}}',
    ];
    for (const explore of payloads) {
      let out: ReturnType<typeof toPersistedRec> | undefined;
      expect(() => {
        out = toPersistedRec({ ...baseRecFields(), explore });
      }).not.toThrow();
      expect(out!.explore).toEqual([]); // object, not array -> rejected wholesale
    }
    // No write reached the prototype chain.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("prototype-pollution-shaped KEYS appearing as array string entries are kept as plain strings", () => {
    // When __proto__ / constructor arrive as string *elements* (the realistic stored shape — they
    // were authored as suggestion text), they're legitimate strings and pass through verbatim. They
    // are inert data, never applied as object keys, so they still can't pollute anything.
    let out: ReturnType<typeof toPersistedRec> | undefined;
    expect(() => {
      out = toPersistedRec({
        ...baseRecFields(),
        explore: '["__proto__", "constructor", "prototype", {"__proto__":1}, "keep"]',
      });
    }).not.toThrow();
    // String entries (incl. the prototype-named ones) survive; the embedded object is dropped.
    expect(out!.explore).toEqual(["__proto__", "constructor", "prototype", "keep"]);
    expect(out!.explore.every((x) => typeof x === "string")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// ── handoffRecommendations — batch hand-off: one membership read, CAS writes ─────────────────────
// Pins the Wave-3 item-8 shape (docs/specs/2026-08-30-followups-handoff-batch.md): ownership +
// status answered by ONE batched findMany; the writes are per-row conditional updates whose WHERE
// carries `status: "open"` + the org scope; events + audit land on the SAME tx as the updates; and
// a CAS that returns count:0 (row moved between read and write) is reported skipped — the
// reopen-race the old read-then-unguarded-write allowed.

describe("handoffRecommendations — membership-scoped batch read + CAS-guarded transactional writes", () => {
  /** Rows keyed by id: { status, slug, orgId } describe what the batch read returns; ids absent
   *  from the map are unknown. `casLosers` lists ids whose CAS update returns count:0, with the
   *  status the in-tx re-read then reports. */
  function fakeHandoffPrisma(
    rowsById: Record<string, { status: string; slug?: string; orgId?: string | null }>,
    casLosers: Record<string, string> = {},
  ) {
    const findMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in
        .filter((id) => rowsById[id])
        .map((id) => ({
          id,
          status: rowsById[id]!.status,
          scan: {
            repo: {
              orgId: rowsById[id]!.orgId === undefined ? "org_42" : rowsById[id]!.orgId,
              org: { slug: rowsById[id]!.slug ?? "acme" },
            },
          },
        })),
    );
    const tx = {
      recommendation: {
        updateMany: vi.fn(async ({ where }: { where: { id: string } }) => ({
          count: where.id in casLosers ? 0 : 1,
        })),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          status: casLosers[where.id] ?? rowsById[where.id]?.status ?? "unknown",
        })),
      },
      recommendationEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
      auditLog: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      recommendation: { findMany },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { prisma, tx, findMany };
  }

  it("marks open rows via per-row CAS (status + org scope in the WHERE) with events + audit on the SAME tx", async () => {
    const { prisma, tx, findMany } = fakeHandoffPrisma({
      a: { status: "open" },
      b: { status: "open" },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await handoffRecommendations("Acme", ["a", "b"], { actor: "alice", note: "handed off" });

    expect(out).toEqual({ ok: true, marked: ["a", "b"], skipped: [] });
    // ONE membership-scoped batch read — not a per-id ownership loop.
    expect(findMany).toHaveBeenCalledTimes(1);
    // The CAS predicate carries the expected state AND the owning org.
    expect(tx.recommendation.updateMany).toHaveBeenCalledWith({
      where: { id: "a", status: "open", scan: { repo: { orgId: "org_42" } } },
      data: { status: "in_progress" },
    });
    // Timeline events + audit rows commit atomically with the updates (same tx object).
    expect(tx.recommendationEvent.createMany).toHaveBeenCalledTimes(1);
    const events = tx.recommendationEvent.createMany.mock.calls[0][0].data;
    expect(events).toEqual([
      { recommendationId: "a", actor: "alice", kind: "status", fromValue: "open", toValue: "in_progress", note: "handed off" },
      { recommendationId: "b", actor: "alice", kind: "status", fromValue: "open", toValue: "in_progress", note: "handed off" },
    ]);
    const audits = tx.auditLog.createMany.mock.calls[0][0].data;
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ action: "recommendation.updated", orgId: "org_42", actorId: null });
    expect(JSON.parse(audits[0].meta)).toEqual({
      id: "a",
      actor: "alice",
      changes: [{ kind: "status", from: "open", to: "in_progress" }],
    });
  });

  it("refuses the WHOLE request for an unknown id — and opens no transaction", async () => {
    const { prisma, tx } = fakeHandoffPrisma({ a: { status: "open" } });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await handoffRecommendations("acme", ["a", "ghost"]);

    expect(out).toEqual({ ok: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the WHOLE request for a foreign id (same refusal as unknown — no existence oracle)", async () => {
    const { prisma } = fakeHandoffPrisma({
      a: { status: "open" },
      z: { status: "open", slug: "other-org" },
    });
    mockGetPrisma.mockReturnValue(prisma);

    expect(await handoffRecommendations("acme", ["a", "z"])).toEqual({ ok: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("skips non-open rows without touching them, and writes nothing when no row is open", async () => {
    const { prisma, tx } = fakeHandoffPrisma({
      d: { status: "done" },
      p: { status: "in_progress" },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await handoffRecommendations("acme", ["d", "p"]);

    expect(out).toEqual({
      ok: true,
      marked: [],
      skipped: [
        { id: "d", status: "done" },
        { id: "p", status: "in_progress" },
      ],
    });
    // No candidates → no transaction, no writes at all.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.recommendationEvent.createMany).not.toHaveBeenCalled();
  });

  it("reports a CAS loser (row moved between read and write) as skipped with its current status — never reopened, no event", async () => {
    const { prisma, tx } = fakeHandoffPrisma(
      { a: { status: "open" }, b: { status: "open" } },
      { b: "done" }, // b's CAS returns count:0; the in-tx re-read says it's now done
    );
    mockGetPrisma.mockReturnValue(prisma);

    const out = await handoffRecommendations("acme", ["a", "b"], { actor: "alice" });

    expect(out).toEqual({ ok: true, marked: ["a"], skipped: [{ id: "b", status: "done" }] });
    // Only the winner gets a timeline event and an audit row.
    expect(tx.recommendationEvent.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(tx.recommendationEvent.createMany.mock.calls[0][0].data[0].recommendationId).toBe("a");
    expect(tx.auditLog.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("returns null when the DB is unconfigured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await handoffRecommendations("acme", ["a"])).toBeNull();
  });

  it("SIGNS every batch audit row, each over the shared instant it stores", async () => {
    // The batch path was a third unsigned site the earlier audit missed: it wrote unsigned rows for
    // the SAME action the per-item path next to it signed. One `at` is shared by the batch (they
    // commit in one transaction, so one instant is the truthful timestamp) and each row is signed
    // over that same instant.
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    try {
      const { prisma, tx } = fakeHandoffPrisma({ a: { status: "open" }, b: { status: "open" } });
      mockGetPrisma.mockReturnValue(prisma);

      await handoffRecommendations("acme", ["a", "b"], { actor: "alice" });

      const rows = tx.auditLog.createMany.mock.calls[0][0].data as Array<{
        action: string;
        at: Date;
        orgId: string | null;
        actorId: string | null;
        meta: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.at.getTime()).toBe(rows[1]!.at.getTime()); // one shared instant for the batch
      for (const row of rows) {
        const meta = JSON.parse(row.meta) as Record<string, unknown>;
        expect(typeof meta._sig).toBe("string");
        expect(
          verifyAudit({
            action: row.action,
            orgId: row.orgId,
            actorId: row.actorId,
            createdAt: row.at.toISOString(),
            meta,
          }),
        ).toBe("ok");
      }
      // Each row still signs its OWN id, so swapping two rows' meta is detectable.
      expect(JSON.parse(rows[0]!.meta).id).toBe("a");
      expect(JSON.parse(rows[1]!.meta).id).toBe("b");
    } finally {
      delete process.env.AUDIT_SIGNING_SECRET;
    }
  });
});

// ── Audit tamper-evidence: both recommendation.updated writers are SIGNED ────────────────────────
//
// `recommendation.updated` is the product's most-edited record, and BOTH of its in-transaction
// writers (the per-item updateRecommendation create, and the handoffRecommendations createMany)
// used to JSON.stringify their meta directly — bypassing withAuditSignature — so every backlog
// mutation landed with no `_sig` and read as "unsigned" in the audit viewer's Integrity column.
// The signature covers `createdAt`, so `at` must be stamped explicitly and match what was signed;
// a DB-defaulted timestamp would sign a different instant than the row stores and verify as
// `tampered` forever. Exemplar: recordConformance in src/lib/db/org-watch.ts.
describe("recommendation.updated audit rows are signed", () => {
  it("updateRecommendation SIGNS its row over the timestamp it stores (verifies ok)", async () => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    try {
      const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
      mockGetPrisma.mockReturnValue(prisma);

      await updateRecommendation("rec_1", { status: "done" }, { actor: "bob" });

      const { data } = tx.auditLog.create.mock.calls[0][0] as {
        data: { action: string; at: Date; orgId: string | null; actorId: string | null; meta: string };
      };
      const meta = JSON.parse(data.meta) as Record<string, unknown>;
      expect(data.at).toBeInstanceOf(Date); // stamped explicitly — never DB-defaulted
      expect(typeof meta._sig).toBe("string"); // signed at all — the regression this pins
      // Signing leaves the payload the viewer's Details column reads untouched.
      expect(meta).toMatchObject({ id: "rec_1", actor: "bob", changes: [{ kind: "status", from: "open", to: "done" }] });

      expect(
        verifyAudit({
          action: data.action,
          orgId: data.orgId,
          actorId: data.actorId,
          createdAt: data.at.toISOString(),
          meta,
        }),
      ).toBe("ok");
    } finally {
      delete process.env.AUDIT_SIGNING_SECRET;
    }
  });

  it("an edited meta field no longer verifies (the tamper-evidence is real, not decorative)", async () => {
    process.env.AUDIT_SIGNING_SECRET = "test-secret";
    try {
      const { prisma, tx } = fakePrisma(recRow({ status: "open" }), { orgId: "org_42" });
      mockGetPrisma.mockReturnValue(prisma);

      await updateRecommendation("rec_1", { status: "done" }, { actor: "bob" });

      const { data } = tx.auditLog.create.mock.calls[0][0] as {
        data: { action: string; at: Date; orgId: string | null; actorId: string | null; meta: string };
      };
      const meta = JSON.parse(data.meta) as Record<string, unknown>;
      expect(
        verifyAudit({
          action: data.action,
          orgId: data.orgId,
          actorId: data.actorId,
          createdAt: data.at.toISOString(),
          meta: { ...meta, actor: "mallory" }, // someone rewrites who did it, at rest
        }),
      ).toBe("tampered");
    } finally {
      delete process.env.AUDIT_SIGNING_SECRET;
    }
  });
});
