// Replay-safe OTLP delta ingest (scan-sweep challenge 2026-10-22c, providers-0). OTLP delivery is
// at-least-once: a timeout, a proxy 502/504 after the write committed, or a mid-batch failure makes
// the exporter resend the same export. Every resend used to INCREMENT the day bucket and the session
// row again. The route, the parsers, recordUsage, recordAgentSessions and the receipt store run for
// real here, over an in-memory Prisma double whose $transaction rolls back on throw.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db, resetDb } from "./replay-db.test-helpers";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/integrations/ingest-token", () => ({
  bearerToken: (auth: string | null) => (auth ? auth.replace(/^Bearer /i, "") : null),
  parseIngestToken: (t: string) => (t.startsWith("good-") ? { slug: t.slice(5), epoch: 0 } : null),
  isIngestConfigured: () => true,
}));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  rateLimitRequestShared: async () => ({ ok: true, retryAfterSec: 0 }),
}));
vi.mock("@/lib/db/client", async () => (await import("./replay-db.test-helpers")).clientMock);
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async (slug: string) => ({ id: `org-${slug}`, ingestTokenEpoch: 0 }) }));
vi.mock("@/lib/db", async () => ({ recordUsage: (await import("@/lib/db/integrations")).recordUsage }));

const { POST } = await import("./route");
const { OTLP_REPLAY_HORIZON_MS, OTLP_RECEIPT_SWEEP_BATCH } = await import("@/lib/db/otlp-receipts");

const T0 = 1760000000000; // ms
const ns = (ms: number) => String(ms * 1e6);
const attr = (key: string, v: string) => ({ key, value: { stringValue: v } });

interface Pt { repo?: string; session?: string; cost?: number; tokens?: number; start?: number | null; end?: number | null; temporality?: 1 | 2 }
function resource({ repo = "acme/x", session = "s1", cost = 0.4, tokens = 1000, start = T0, end = T0 + 60_000, temporality = 1 }: Pt) {
  const times = { ...(start != null ? { startTimeUnixNano: ns(start) } : {}), ...(end != null ? { timeUnixNano: ns(end) } : {}) };
  return {
    resource: { attributes: [attr("git.repository", `https://github.com/${repo}.git`), attr("session.id", session), attr("user.email", "a@acme.dev")] },
    scopeMetrics: [{ metrics: [
      { name: "claude_code.cost.usage", sum: { aggregationTemporality: temporality, dataPoints: [{ asDouble: cost, ...times, attributes: [attr("model", "m1"), attr("type", "x")] }] } },
      { name: "claude_code.token.usage", sum: { aggregationTemporality: temporality, dataPoints: [{ asInt: tokens, ...times, attributes: [attr("type", "input"), attr("model", "m1")] }] } },
    ] }],
  };
}
const body = (...pts: Pt[]) => JSON.stringify({ resourceMetrics: pts.map(resource) });
const post = (text: string, org = "acme") =>
  POST(new Request("http://localhost/api/integrations/ingest/v1/metrics", {
    method: "POST",
    headers: { authorization: `Bearer good-${org}`, "content-type": "application/json" },
    body: text,
  }) as unknown as NextRequest);

const usage = (org = "acme", repo = "acme/x") => [...db.aiUsageRecord.values()].filter((r) => r.orgId === `org-${org}` && r.scopeKey === repo);
const session = (org = "acme", id = "s1") => [...db.agentSession.values()].find((r) => r.orgId === `org-${org}` && r.sessionId === id);
const receipts = (org = "acme", sink?: string) => [...db.otlpPointReceipt.values()].filter((r) => r.orgId === `org-${org}` && (!sink || r.sink === sink));

beforeEach(() => resetDb());

describe("OTLP metrics ingest is replay-safe", () => {
  it("stores a delta export POSTed twice exactly once; the replay is a terminal 202 with duplicates", async () => {
    const first = await post(body({}));
    expect(first.status).toBe(202);
    const second = await post(body({}));
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ stored: 0, duplicates: 2 }); // the cost and the token datapoint
    expect(usage()).toHaveLength(1);
    expect(usage()[0]!.costCents).toBe(40);
  });

  it("dedupes the session sink independently: AgentSession tokens equal one export", async () => {
    await post(body({}));
    await post(body({}));
    expect(session()?.tokens).toBe(1000);
    expect(session()?.costCents).toBe(40);
    expect(receipts("acme", "sessions").length).toBeGreaterThan(0);
    expect(receipts("acme", "usage").length).toBeGreaterThan(0);
  });

  it("sums consecutive intervals of one series: interval identity, not value equality, is the key", async () => {
    await post(body({ cost: 0.4, start: T0, end: T0 + 60_000 }));
    await post(body({ cost: 0.4, start: T0 + 60_000, end: T0 + 120_000 }));
    expect(usage()[0]!.costCents).toBe(80);
    expect(receipts("acme", "usage")).toHaveLength(4); // cost + tokens, per interval
    expect(new Set(receipts("acme", "usage").map((r) => r.pointKey)).size).toBe(receipts("acme", "usage").length);
  });

  it("dedupes the same export re-serialized (resources reordered, attributes reordered, whitespace)", async () => {
    await post(body({ repo: "acme/x" }, { repo: "acme/y", session: "s2" }));
    const swapped = JSON.parse(body({ repo: "acme/y", session: "s2" }, { repo: "acme/x" })) as { resourceMetrics: { resource: { attributes: unknown[] } }[] };
    for (const rm of swapped.resourceMetrics) rm.resource.attributes.reverse();
    const res = await post(JSON.stringify(swapped, null, 3));
    expect(await res.json()).toMatchObject({ stored: 0, duplicates: 4 });
    expect(usage("acme", "acme/x")[0]!.costCents).toBe(40);
    expect(usage("acme", "acme/y")[0]!.costCents).toBe(40);
  });

  it("rolls back receipts with the usage write when a bucket upsert fails mid-batch; the retry stores once", async () => {
    db.failUsageUpsertOnCall = 2;
    const text = body({ repo: "acme/a" }, { repo: "acme/b", session: "s2" }, { repo: "acme/c", session: "s3" });
    const failed = await post(text);
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(receipts("acme", "usage")).toHaveLength(0);
    expect([...db.aiUsageRecord.values()]).toHaveLength(0);
    const retry = await post(text);
    expect(retry.status).toBe(202);
    for (const repo of ["acme/a", "acme/b", "acme/c"]) expect(usage("acme", repo)[0]!.costCents).toBe(40);
  });

  it("admits a datapoint with no timestamps at all and counts it as unkeyed", async () => {
    const res = await post(JSON.stringify({ resourceMetrics: [{
      resource: { attributes: [attr("git.repository", "https://github.com/acme/x.git")] },
      scopeMetrics: [{ metrics: [{ name: "claude_code.cost.usage", sum: { aggregationTemporality: 1, dataPoints: [{ asDouble: 0.4 }] } }] }],
    }] }));
    expect(await res.json()).toMatchObject({ stored: 1, unkeyed: 1, duplicates: 0 });
    expect(usage()[0]!.costCents).toBe(40);
  });

  it("keys receipts per org: identical series/interval from org A and org B are both stored", async () => {
    await post(body({}), "acme");
    await post(body({}), "beta");
    expect(usage("acme")[0]!.costCents).toBe(40);
    expect(usage("beta")[0]!.costCents).toBe(40);
    expect(receipts("acme", "usage").length).toBeGreaterThan(0);
    expect(receipts("beta", "usage").map((r) => r.pointKey).sort()).toEqual(receipts("acme", "usage").map((r) => r.pointKey).sort());
  });

  it("sweeps the ingesting org's receipts past the replay horizon, bounded per call", async () => {
    const old = new Date(Date.now() - OTLP_REPLAY_HORIZON_MS - 60_000);
    for (let i = 0; i < OTLP_RECEIPT_SWEEP_BATCH + 3; i++) db.seedReceipt("org-acme", `old-${i}`, old);
    db.seedReceipt("org-acme", "fresh", new Date(Date.now() - 60_000));
    db.seedReceipt("org-beta", "old-beta", old);
    await post(body({}));
    const left = receipts("acme").map((r) => r.pointKey);
    expect(left).toContain("fresh");
    expect(left.filter((k) => k.startsWith("old-"))).toHaveLength(3);
    expect(receipts("beta").map((r) => r.pointKey)).toEqual(["old-beta"]);
  });
});

describe("guards (green before)", () => {
  it("still skips and reports cumulative-temporality datapoints", async () => {
    const res = await post(body({ temporality: 2 }));
    expect(await res.json()).toMatchObject({ stored: 0, skipped: { "cumulative-temporality": 2 } });
    expect(usage()).toHaveLength(0);
  });

  it("answers 401 for a bad token before any receipt or usage write", async () => {
    const res = await POST(new Request("http://localhost/api/integrations/ingest/v1/metrics", {
      method: "POST",
      headers: { authorization: "Bearer forged", "content-type": "application/json" },
      body: body({}),
    }) as unknown as NextRequest);
    expect(res.status).toBe(401);
    expect(db.otlpPointReceipt.size).toBe(0);
    expect(db.aiUsageRecord.size).toBe(0);
    expect(db.transactions).toBe(0);
  });
});
