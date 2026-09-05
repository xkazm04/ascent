// GET /api/kpi — operator diagnostics: the eight adopted product KPIs (src/lib/db/kpi-metrics.ts),
// computed on demand from the live database and returned as JSON. This is the first consumer of that
// module — the KPIs were measurable but reachable by nothing until this route.
//
// Every KPI entry carries `value` plus the counts that produced it (numerator/denominator where the
// metric is a ratio), so the reader can audit the cohort. `value: null` means "not measurable"
// (persistence off, or an empty cohort) — a different claim from 0, per the kpi-metrics contract,
// and the shape keeps the two distinguishable.
//
// GATING — a dedicated ASCENT_OPS_SECRET with the STRICT cron contract (header-only bearer,
// constant-time compare, fail-closed 503 when unset), deliberately NOT the seed-secret pattern:
// /api/dev/seed-* (a) accepts the secret as a query param — which leaks into access/CDN/proxy logs
// and Referer headers, (b) compares with a plain `===` (a timing oracle), and (c) falls OPEN outside
// production. All three are tolerable for a one-shot local seeder and wrong for a standing endpoint
// that exposes business metrics (conversion, unit economics) on every deploy. The compare helper is
// shared with the cron gate (cronSecretMatches); the SECRET is not — CRON_SECRET is held by the
// scheduler platform, this one by a human operator, and the two must rotate independently.

import { NextResponse } from "next/server";
import { cronSecretMatches } from "@/lib/cron-auth";
import {
  avgLlmCostPerScan,
  firstScanActivationRate,
  freeToPaidConversion,
  orgFleetScanDepth,
  reScanRate,
  roadmapEngagementRate,
  scanPipelineErrorRate,
  scanOutputBudget,
  weeklyActiveScanningOrgs,
} from "@/lib/db";
import type { RatioMetric } from "@/lib/db/kpi-metrics";
import { checkPriceDrift } from "@/lib/price-drift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guard the route against ASCENT_OPS_SECRET. Returns a ready-to-send error response when auth FAILS —
 * 503 if the secret is unset/empty (fail CLOSED: an operator route must never exist unauthenticated
 * because an env var was forgotten), 401 for a wrong/absent credential — or `null` to proceed.
 * Accepts ONLY `Authorization: Bearer <secret>`, compared in constant time. No query-param channel.
 */
function requireOpsAuth(request: Request): NextResponse | null {
  const secret = process.env.ASCENT_OPS_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Operator diagnostics are not configured (ASCENT_OPS_SECRET unset)." },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (presented && cronSecretMatches(presented, secret)) return null;
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

/** The uniform per-KPI shape: value plus audit counts, all null-able ("not measurable" ≠ 0). */
interface KpiEntry {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
}

const NOT_MEASURABLE: KpiEntry = { value: null, numerator: null, denominator: null };

function fromRatio(m: RatioMetric | null): KpiEntry {
  return m ? { value: m.value, numerator: m.numerator, denominator: m.denominator } : NOT_MEASURABLE;
}

export async function GET(request: Request) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;

  const [activation, rescan, conversion, fleetDepth, roadmap, weeklyActive, scanCost, errorRate, outputBudget, priceDrift] =
    await Promise.all([
      firstScanActivationRate(),
      reScanRate(),
      freeToPaidConversion(),
      orgFleetScanDepth(),
      roadmapEngagementRate(),
      weeklyActiveScanningOrgs(),
      avgLlmCostPerScan(),
      scanPipelineErrorRate(),
      // The god-scan trend: is the single-call assessment growing toward the model's output ceiling?
      scanOutputBudget(),
      // priceDrift rides the operator KPI pull rather than the weekly digest cron: the digest fans
      // out per-TENANT fleet intelligence to customer-facing Slack sinks, and a display-vs-Polar
      // price mismatch is operator-internal billing diagnostics — pushed into tenant channels it
      // would leak ops noise to customers, and a deployment with zero digest-eligible orgs would
      // never hear it at all. Here it fires exactly when the operator looks, costs nothing at
      // build/dev time, and returns null (a clean "not configured") when the Polar env is unset.
      checkPriceDrift(),
    ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    firstScanActivationRate: fromRatio(activation),
    reScanRate: fromRatio(rescan),
    freeToPaidConversion: fromRatio(conversion),
    orgFleetScanDepth: fromRatio(fleetDepth),
    roadmapEngagementRate: fromRatio(roadmap),
    // A count, not a ratio — 0 is a real measurement ("no org scanned this week"); null = no DB.
    weeklyActiveScanningOrgs: { value: weeklyActive, numerator: null, denominator: null },
    // Mean USD per priced scan; the audit counts here are the priced/unpriced scan split.
    avgLlmCostPerScan: scanCost
      ? { value: scanCost.value, numerator: null, denominator: scanCost.pricedScans, unpricedScans: scanCost.unpricedScans }
      : { ...NOT_MEASURABLE, unpricedScans: null },
    scanOutputBudget: outputBudget,
    scanPipelineErrorRate: errorRate
      ? {
          value: errorRate.value,
          numerator: errorRate.numerator,
          denominator: errorRate.denominator,
          rejected: errorRate.rejected,
          degraded: errorRate.degraded,
        }
      : { ...NOT_MEASURABLE, rejected: null, degraded: null },
    priceDrift,
  });
}
