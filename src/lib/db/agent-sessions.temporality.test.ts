import { beforeEach, describe, expect, it, vi } from "vitest";

// Counter TEMPORALITY across two consecutive exports of one session, through the real parsers and
// the real upserts over an in-memory Prisma double. Claude Code's exporter defaults to DELTA
// temporality (OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE, default `delta`, one export every
// 60 s), and the connect snippet does not override it: each export carries only what happened since
// the previous one. A `cumulative` exporter instead carries the running total and says so in
// `sum.aggregationTemporality` (2). The day-bucket path and the session path read the SAME body, so
// both have to decode the same declaration or one of them is wrong whichever way the exporter is set.

type Row = Record<string, unknown>;
const tables: Record<string, Map<string, Row>> = { agentSession: new Map(), aiUsageRecord: new Map() };

function apply(row: Row, update: Row): Row {
  const next = { ...row };
  for (const [k, v] of Object.entries(update)) {
    next[k] = v && typeof v === "object" && "increment" in v ? Number(row[k] ?? 0) + Number((v as { increment: number }).increment) : v;
  }
  return next;
}

function model(name: string) {
  return {
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = JSON.stringify(where);
      const cur = tables[name]!.get(key);
      tables[name]!.set(key, cur ? apply(cur, update) : { ...create });
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ agentSession: model("agentSession"), aiUsageRecord: model("aiUsageRecord") }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async () => ({ id: "org-1" }) }));

const { parseOtlpSessions } = await import("@/lib/integrations/sessions");
const { parseOtlpMetrics } = await import("@/lib/integrations/otlp");
const { recordAgentSessions } = await import("./agent-sessions");
const { recordUsage } = await import("./integrations");

const attr = (k: string, v: string) => ({ key: k, value: { stringValue: v } });

/** One export: `tokens` for session s-1 at `iso`, with or without a declared temporality. */
function exportBody(tokens: number, iso: string, temporality?: 1 | 2) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [attr("git.repository", "https://github.com/acme/web.git"), attr("session.id", "s-1")] },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "claude_code.token.usage",
                sum: {
                  ...(temporality ? { aggregationTemporality: temporality } : {}),
                  dataPoints: [{ asDouble: tokens, timeUnixNano: String(Date.parse(iso) * 1e6), attributes: [attr("type", "input")] }],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function ingest(body: ReturnType<typeof exportBody>) {
  const now = Date.parse("2026-09-15T12:00:00Z");
  const parsed = parseOtlpMetrics(body, now);
  await recordUsage("acme", parsed.records, { mode: "add" }); // exactly the route's call
  await recordAgentSessions("acme", parseOtlpSessions(body, now));
  return parsed;
}

const stored = () => ({
  session: Number([...tables.agentSession!.values()][0]?.tokens ?? 0),
  day: Number([...tables.aiUsageRecord!.values()][0]?.tokens ?? 0),
});

beforeEach(() => {
  tables.agentSession!.clear();
  tables.aiUsageRecord!.clear();
});

describe("OTLP counter temporality (true session total: 1500 tokens)", () => {
  it("delta exports (the exporter default): both paths store the sum of the exports", async () => {
    await ingest(exportBody(1000, "2026-09-15T10:00:00Z"));
    await ingest(exportBody(500, "2026-09-15T10:01:00Z"));
    console.log("[temporality] delta      ", JSON.stringify(stored()));
    expect(stored()).toEqual({ session: 1500, day: 1500 });
  });

  it("delta exports that declare temporality 1 behave like the default", async () => {
    await ingest(exportBody(1000, "2026-09-15T10:00:00Z", 1));
    await ingest(exportBody(500, "2026-09-15T10:01:00Z", 1));
    expect(stored()).toEqual({ session: 1500, day: 1500 });
  });

  it("cumulative exports: the session keeps the latest running total; the day bucket refuses and reports", async () => {
    const first = await ingest(exportBody(1000, "2026-09-15T10:00:00Z", 2));
    const second = await ingest(exportBody(1500, "2026-09-15T10:01:00Z", 2));
    console.log("[temporality] cumulative ", JSON.stringify(stored()));
    // A running total added into a day bucket would store 2500. Without the previous point per series
    // there is no honest delta, so the datapoint is counted as skipped, never summed.
    expect(stored()).toEqual({ session: 1500, day: 0 });
    expect(first.skipped["cumulative-temporality"] + second.skipped["cumulative-temporality"]).toBe(2);
  });
});
