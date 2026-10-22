// In-memory prisma for the purge-ledger tests (retention-ledgers / retention-counters). Unlike the
// id-list fakes in retention.test.ts, this one EVALUATES the `where` it is handed - strict `lt`,
// `in`, `not`, `OR` and one level of relation filter - so a test can seed rows on both sides of a
// cutoff and see which survive. A predicate that drifts (`lte` for `lt`, a dropped survivor
// exclusion) then changes WHICH rows die, not only the shape of an argument.
//
// Every delegate call is logged in `calls`, so a test can also pin the literal predicate today's
// code passes. `failOn(table, op, nth)` throws on the nth call of one operation (1-based).

export type FakeRow = { id: string } & Record<string, unknown>;
export type FakeCall = { table: string; op: string; args: Record<string, unknown> };

/** relation field -> [related table, foreign key on this row] */
const RELATIONS: Record<string, Record<string, [string, string]>> = {
  conformanceFinding: { report: ["conformanceReport", "reportId"] },
  scan: { repo: ["repository", "repoId"] },
  recommendationEvent: { recommendation: ["recommendation", "recommendationId"] },
};

const toCmp = (v: unknown) => (v instanceof Date ? v.getTime() : v);
const eq = (a: unknown, b: unknown) => toCmp(a) === toCmp(b);

function isOperatorObject(c: unknown): c is Record<string, unknown> {
  return c !== null && typeof c === "object" && !(c instanceof Date) && !Array.isArray(c);
}

export function createPurgeStore(seed: Record<string, FakeRow[]> = {}) {
  const tables: Record<string, FakeRow[]> = {};
  for (const [k, rows] of Object.entries(seed)) tables[k] = rows.map((r) => ({ ...r }));
  const calls: FakeCall[] = [];
  const faults: Array<{ table: string; op: string; nth: number; seen: number; error: Error }> = [];
  const table = (name: string) => (tables[name] ??= []);

  function matchField(v: unknown, cond: unknown): boolean {
    if (!isOperatorObject(cond)) return eq(v, cond);
    if ("lt" in cond && !((toCmp(v) as number) < (toCmp(cond.lt) as number))) return false;
    if ("in" in cond && !(cond.in as unknown[]).some((x) => eq(x, v))) return false;
    if ("not" in cond && eq(v, cond.not)) return false;
    return true;
  }

  function matches(name: string, row: FakeRow, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (key === "OR") {
        if (!(cond as Record<string, unknown>[]).some((w) => matches(name, row, w))) return false;
        continue;
      }
      const rel = RELATIONS[name]?.[key];
      if (rel) {
        const parent = table(rel[0]).find((p) => p.id === row[rel[1]]);
        if (!parent || !matches(rel[0], parent, cond as Record<string, unknown>)) return false;
        continue;
      }
      if (!matchField(row[key], cond)) return false;
    }
    return true;
  }

  function sorted(rows: FakeRow[], orderBy: unknown): FakeRow[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, string>[];
    return [...rows].sort((a, b) => {
      for (const o of keys) {
        const [f, dir] = Object.entries(o)[0]!;
        const x = toCmp(a[f]) as number | string;
        const y = toCmp(b[f]) as number | string;
        if (x === y) continue;
        return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
      }
      return 0;
    });
  }

  function project(row: FakeRow, select: unknown): Record<string, unknown> {
    if (!isOperatorObject(select) || Object.values(select).some((v) => v !== true)) return { ...row };
    return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
  }

  function log(name: string, op: string, args: Record<string, unknown> = {}) {
    calls.push({ table: name, op, args });
    for (const f of faults) {
      if (f.table === name && f.op === op && ++f.seen === f.nth) throw f.error;
    }
  }

  function delegate(name: string) {
    const select = (args: Record<string, unknown>) => {
      let rows = sorted(table(name).filter((r) => matches(name, r, args.where as never)), args.orderBy);
      const cursor = args.cursor as { id: string } | undefined;
      if (cursor) rows = rows.slice(Math.max(0, rows.findIndex((r) => r.id === cursor.id)));
      rows = rows.slice((args.skip as number) ?? 0);
      if (args.take != null) rows = rows.slice(0, args.take as number);
      return rows;
    };
    return {
      findMany: async (args: Record<string, unknown> = {}) => {
        log(name, "findMany", args);
        return select(args).map((r) => project(r, args.select));
      },
      findFirst: async (args: Record<string, unknown> = {}) => {
        log(name, "findFirst", args);
        const r = select({ ...args, take: 1 })[0];
        return r ? project(r, args.select) : null;
      },
      findUnique: async (args: Record<string, unknown> = {}) => {
        log(name, "findUnique", args);
        const r = table(name).find((x) => matches(name, x, args.where as never));
        return r ? project(r, args.select) : null;
      },
      count: async (args: Record<string, unknown> = {}) => {
        log(name, "count", args);
        return table(name).filter((r) => matches(name, r, args.where as never)).length;
      },
      groupBy: async (args: Record<string, unknown> = {}) => {
        log(name, "groupBy", args);
        const by = args.by as string[];
        const groups = new Map<string, { key: Record<string, unknown>; n: number }>();
        for (const r of table(name).filter((x) => matches(name, x, args.where as never))) {
          const key = Object.fromEntries(by.map((f) => [f, r[f]]));
          const k = JSON.stringify(key);
          const g = groups.get(k) ?? { key, n: 0 };
          g.n++;
          groups.set(k, g);
        }
        return [...groups.values()].map((g) => ({ ...g.key, _count: { _all: g.n } }));
      },
      deleteMany: async (args: Record<string, unknown> = {}) => {
        log(name, "deleteMany", args);
        const before = table(name).length;
        tables[name] = table(name).filter((r) => !matches(name, r, args.where as never));
        return { count: before - tables[name]!.length };
      },
      update: async (args: Record<string, unknown> = {}) => {
        log(name, "update", args);
        return {};
      },
      updateMany: async (args: Record<string, unknown> = {}) => {
        log(name, "updateMany", args);
        return { count: 0 };
      },
    };
  }

  const delegates = new Map<string, ReturnType<typeof delegate>>();
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return undefined;
        if (prop === "$transaction") {
          return async (fn: (tx: unknown) => unknown) => {
            log("$", "transaction");
            return fn(prisma);
          };
        }
        if (!delegates.has(prop)) delegates.set(prop, delegate(prop));
        return delegates.get(prop);
      },
    },
  );

  return {
    prisma,
    tables,
    calls,
    rows: (name: string) => table(name),
    ids: (name: string) => table(name).map((r) => r.id).sort(),
    /** Throw `error` on the nth (1-based) `op` call against `name`. */
    failOn: (name: string, op: string, nth: number, error = new Error(`${name}.${op} outage`)) => {
      faults.push({ table: name, op, nth, seen: 0, error });
    },
    callsTo: (name: string, op: string) => calls.filter((c) => c.table === name && c.op === op),
  };
}

// The aged-ledger seed: rows on both sides of a 30-day cutoff, one row of every ledger exactly AT it.
export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 1);
export const CUTOFF = new Date(NOW - 30 * DAY);
export const before = (days: number) => new Date(CUTOFF.getTime() - days * DAY);
const AFTER = new Date(CUTOFF.getTime() + DAY);

/** The ledger rows straddling the cutoff, one org of interest and one bystander. */
export function straddlingSeed(): Record<string, FakeRow[]> {
  return {
    organization: [
      { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30, retentionCompact: null, retentionDigestMonths: null, createdAt: before(900) },
      { id: "org_2", slug: "other", retentionMaxScans: 0, retentionAuditDays: 30, retentionCompact: null, retentionDigestMonths: null, createdAt: before(800) },
    ],
    usageEvent: [
      { id: "ue_old", orgId: "org_1", createdAt: before(1) },
      { id: "ue_at", orgId: "org_1", createdAt: CUTOFF },
      { id: "ue_new", orgId: "org_1", createdAt: AFTER },
      { id: "ue_other", orgId: "org_2", createdAt: before(5) },
    ],
    conformanceReport: [
      { id: "cr_old", orgId: "org_1", reportedAt: before(2) },
      { id: "cr_at", orgId: "org_1", reportedAt: CUTOFF },
    ],
    conformanceFinding: [
      { id: "cf_1", reportId: "cr_old" },
      { id: "cf_2", reportId: "cr_old" },
      { id: "cf_3", reportId: "cr_at" },
    ],
    orgMemoryCitation: [
      { id: "mc_old", orgId: "org_1", createdAt: before(3) },
      { id: "mc_at", orgId: "org_1", createdAt: CUTOFF },
      { id: "mc_new", orgId: "org_1", createdAt: AFTER },
    ],
    controlObservation: [
      // Pair A: the newest row sits exactly AT the cutoff - the older one dies, it survives.
      { id: "co_a1", orgId: "org_1", repoFullName: "acme/api", controlId: "bp", observedAt: before(10) },
      { id: "co_a2", orgId: "org_1", repoFullName: "acme/api", controlId: "bp", observedAt: CUTOFF },
      // Pair B: every row is past the cutoff - the newest survives anyway (keep-newest-per-pair).
      { id: "co_b1", orgId: "org_1", repoFullName: "acme/web", controlId: "rr", observedAt: before(20) },
      { id: "co_b2", orgId: "org_1", repoFullName: "acme/web", controlId: "rr", observedAt: before(1) },
    ],
    auditLog: [
      { id: "al_old", orgId: "org_1", at: before(4) },
      { id: "al_at", orgId: "org_1", at: CUTOFF },
    ],
  };
}

