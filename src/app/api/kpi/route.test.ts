// Route test for the operator KPI surface (GET /api/kpi). The route exposes business metrics
// (conversion, unit economics, error rates) on every deploy, so the properties pinned here are the
// gate's fail-closed contract and the response contract the operator tooling reads:
//   (1) unset/empty ASCENT_OPS_SECRET → 503 with NO metric computed (an operator route must never
//       exist unauthenticated because an env var was forgotten);
//   (2) wrong or missing bearer → 401, still no metric computed; the secret is accepted ONLY in the
//       Authorization header — never as a query param (query strings leak into access/proxy logs);
//   (3) correct bearer → 200 carrying ALL EIGHT KPI keys in the uniform {value, numerator,
//       denominator} shape, with null-metric ("not measurable") kept distinct from 0, plus the
//       priceDrift reconciliation field.
// @/lib/db and @/lib/price-drift are mocked so the suite drives exact metric values and asserts
// when the route does (and does NOT) reach for the database.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  firstScanActivationRate: vi.fn(async () => ({ value: 60, numerator: 3, denominator: 5 })),
  reScanRate: vi.fn(async () => ({ value: 25, numerator: 1, denominator: 4 })),
  freeToPaidConversion: vi.fn(async () => null),
  orgFleetScanDepth: vi.fn(async () => ({ value: 50, numerator: 2, denominator: 4 })),
  roadmapEngagementRate: vi.fn(async () => ({ value: 40, numerator: 2, denominator: 5 })),
  weeklyActiveScanningOrgs: vi.fn(async () => 7),
  avgLlmCostPerScan: vi.fn(async () => ({ value: 0.21, pricedScans: 12, unpricedScans: 1 })),
  scanPipelineErrorRate: vi.fn(async () => ({ value: 2.5, numerator: 1, denominator: 40, rejected: 3, degraded: 2 })),
}));

vi.mock("@/lib/price-drift", () => ({
  checkPriceDrift: vi.fn(async () => null),
}));

import { GET } from "./route";
import {
  firstScanActivationRate,
  freeToPaidConversion,
  weeklyActiveScanningOrgs,
} from "@/lib/db";
import { checkPriceDrift } from "@/lib/price-drift";

const mockActivation = vi.mocked(firstScanActivationRate);
const mockConversion = vi.mocked(freeToPaidConversion);
const mockWeekly = vi.mocked(weeklyActiveScanningOrgs);
const mockDrift = vi.mocked(checkPriceDrift);

const SECRET = "ops-secret-abc";

const KPI_KEYS = [
  "firstScanActivationRate",
  "reScanRate",
  "freeToPaidConversion",
  "orgFleetScanDepth",
  "roadmapEngagementRate",
  "weeklyActiveScanningOrgs",
  "avgLlmCostPerScan",
  "scanPipelineErrorRate",
] as const;

function req(headers: Record<string, string> = {}, url = "https://ascent.test/api/kpi"): Request {
  return new Request(url, { headers });
}

const savedSecret = process.env.ASCENT_OPS_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASCENT_OPS_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.ASCENT_OPS_SECRET;
  else process.env.ASCENT_OPS_SECRET = savedSecret;
});

describe("GET /api/kpi — fail-closed operator gate", () => {
  it("503s when ASCENT_OPS_SECRET is unset, computing NOTHING", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect(mockActivation).not.toHaveBeenCalled();
    expect(mockDrift).not.toHaveBeenCalled();
  });

  it("503s when ASCENT_OPS_SECRET is whitespace-only (empty ≠ configured)", async () => {
    process.env.ASCENT_OPS_SECRET = "   ";
    const res = await GET(req({ authorization: "Bearer    " }));
    expect(res.status).toBe(503);
    expect(mockActivation).not.toHaveBeenCalled();
  });

  it("401s on a wrong bearer, computing NOTHING", async () => {
    process.env.ASCENT_OPS_SECRET = SECRET;
    const res = await GET(req({ authorization: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(mockActivation).not.toHaveBeenCalled();
    expect(mockDrift).not.toHaveBeenCalled();
  });

  it("401s with no Authorization header at all", async () => {
    process.env.ASCENT_OPS_SECRET = SECRET;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockActivation).not.toHaveBeenCalled();
  });

  it("REFUSES the secret as a query param — header-only channel", async () => {
    process.env.ASCENT_OPS_SECRET = SECRET;
    const res = await GET(req({}, `https://ascent.test/api/kpi?secret=${SECRET}&key=${SECRET}`));
    expect(res.status).toBe(401);
    expect(mockActivation).not.toHaveBeenCalled();
  });
});

describe("GET /api/kpi — authorized response contract", () => {
  beforeEach(() => {
    process.env.ASCENT_OPS_SECRET = SECRET;
  });

  it("200s with ALL EIGHT KPI keys in the uniform value/numerator/denominator shape", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { value: number | null; numerator: number | null; denominator: number | null }>;

    for (const key of KPI_KEYS) {
      expect(body, `missing KPI key ${key}`).toHaveProperty(key);
      expect(body[key]).toHaveProperty("value");
      expect(body[key]).toHaveProperty("numerator");
      expect(body[key]).toHaveProperty("denominator");
    }

    // Ratio metrics pass their audit counts through untouched.
    expect(body.firstScanActivationRate).toEqual({ value: 60, numerator: 3, denominator: 5 });
    // A count KPI carries its value with null audit counts (there is no cohort to audit).
    expect(body.weeklyActiveScanningOrgs).toEqual({ value: 7, numerator: null, denominator: null });
    // The cost KPI keeps its priced/unpriced split (denominator = priced scans).
    expect(body.avgLlmCostPerScan).toMatchObject({ value: 0.21, denominator: 12, unpricedScans: 1 });
    // The pipeline KPI keeps its side-counters.
    expect(body.scanPipelineErrorRate).toMatchObject({ value: 2.5, rejected: 3, degraded: 2 });
  });

  it("renders a null metric as value:null — 'not measurable' stays distinct from 0", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    const body = (await res.json()) as Record<string, { value: number | null }>;
    // freeToPaidConversion mocked to null (empty cohort / persistence off).
    expect(body.freeToPaidConversion).toEqual({ value: null, numerator: null, denominator: null });
    expect(body.freeToPaidConversion.value).not.toBe(0);
    expect(mockConversion).toHaveBeenCalledTimes(1);
  });

  it("weeklyActiveScanningOrgs value 0 survives as 0 (a real measurement, not null)", async () => {
    mockWeekly.mockResolvedValueOnce(0);
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    const body = (await res.json()) as { weeklyActiveScanningOrgs: { value: number | null } };
    expect(body.weeklyActiveScanningOrgs.value).toBe(0);
  });

  it("carries the priceDrift reconciliation field through (null when Polar is unconfigured)", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(((await res.json()) as { priceDrift: unknown }).priceDrift).toBeNull();
    expect(mockDrift).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-empty drift report verbatim", async () => {
    mockDrift.mockResolvedValueOnce({
      checked: 2,
      mismatches: [{ plan: "pro", productId: "prod_pro", displayUsd: 10, polarUsd: 12 }],
      errors: [],
    });
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    const body = (await res.json()) as { priceDrift: { checked: number; mismatches: unknown[] } };
    expect(body.priceDrift.checked).toBe(2);
    expect(body.priceDrift.mismatches).toEqual([{ plan: "pro", productId: "prod_pro", displayUsd: 10, polarUsd: 12 }]);
  });
});
