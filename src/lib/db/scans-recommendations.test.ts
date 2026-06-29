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

import { updateRecommendation, getRecommendationEvents } from "./scans-recommendations";
import { toPersistedRec } from "./scans-shared";

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
