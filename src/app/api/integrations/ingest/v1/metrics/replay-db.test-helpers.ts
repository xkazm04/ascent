// In-memory Prisma double for route.replay.test.ts: the three tables the OTLP ingest writes, the
// receipt table's (orgId, sink, pointKey) unique constraint, and an interactive $transaction that
// restores every table when its callback throws (the rollback the route relies on).

type Row = Record<string, unknown>;

function apply(row: Row, update: Row): Row {
  const next = { ...row };
  for (const [k, v] of Object.entries(update)) {
    next[k] = v && typeof v === "object" && "increment" in v ? Number(row[k] ?? 0) + Number((v as { increment: number }).increment) : v;
  }
  return next;
}

export const db = {
  aiUsageRecord: new Map<string, Row>(),
  agentSession: new Map<string, Row>(),
  otlpPointReceipt: new Map<string, Row>(),
  transactions: 0,
  usageUpserts: 0,
  /** Throw on this (1-based) aiUsageRecord.upsert call, once. */
  failUsageUpsertOnCall: 0,
  seq: 0,
  seedReceipt(orgId: string, pointKey: string, createdAt: Date, sink = "usage") {
    const id = `r${++db.seq}`;
    db.otlpPointReceipt.set(`${orgId}|${sink}|${pointKey}`, { id, orgId, sink, pointKey, createdAt });
  },
};

export function resetDb() {
  db.aiUsageRecord.clear();
  db.agentSession.clear();
  db.otlpPointReceipt.clear();
  db.transactions = 0;
  db.usageUpserts = 0;
  db.failUsageUpsertOnCall = 0;
}

function upsertModel(table: Map<string, Row>, onCall?: () => void) {
  return {
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      onCall?.();
      const key = JSON.stringify(where);
      const cur = table.get(key);
      table.set(key, cur ? apply(cur, update) : { ...create });
    },
  };
}

const prisma = {
  aiUsageRecord: upsertModel(db.aiUsageRecord, () => {
    db.usageUpserts += 1;
    if (db.failUsageUpsertOnCall && db.usageUpserts === db.failUsageUpsertOnCall) {
      db.failUsageUpsertOnCall = 0;
      throw new Error("simulated bucket upsert failure");
    }
  }),
  agentSession: upsertModel(db.agentSession),
  otlpPointReceipt: {
    createManyAndReturn: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      const out: Row[] = [];
      for (const d of data) {
        const key = `${d.orgId}|${d.sink}|${d.pointKey}`;
        if (db.otlpPointReceipt.has(key)) {
          if (skipDuplicates) continue;
          throw new Error("unique constraint failed");
        }
        const row = { id: `r${++db.seq}`, createdAt: new Date(), ...d };
        db.otlpPointReceipt.set(key, row);
        out.push(row);
      }
      return out;
    },
    findMany: async ({ where, take }: { where: { orgId: string; createdAt: { lt: Date } }; take?: number }) => {
      const rows = [...db.otlpPointReceipt.values()].filter(
        (r) => r.orgId === where.orgId && (r.createdAt as Date).getTime() < where.createdAt.lt.getTime(),
      );
      return rows.slice(0, take ?? rows.length).map((r) => ({ id: r.id }));
    },
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      const ids = new Set(where.id.in);
      let count = 0;
      for (const [k, r] of db.otlpPointReceipt) {
        if (ids.has(r.id as string)) {
          db.otlpPointReceipt.delete(k);
          count++;
        }
      }
      return { count };
    },
  },
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    db.transactions += 1;
    const snap = (m: Map<string, Row>) => new Map([...m].map(([k, v]) => [k, { ...v }]));
    const saved = [snap(db.aiUsageRecord), snap(db.agentSession), snap(db.otlpPointReceipt)] as const;
    try {
      return await fn(prisma);
    } catch (err) {
      const restore = (m: Map<string, Row>, s: Map<string, Row>) => {
        m.clear();
        for (const [k, v] of s) m.set(k, v);
      };
      restore(db.aiUsageRecord, saved[0]);
      restore(db.agentSession, saved[1]);
      restore(db.otlpPointReceipt, saved[2]);
      throw err;
    }
  },
};

export const clientMock = { isDbConfigured: () => true, getPrisma: () => prisma };
