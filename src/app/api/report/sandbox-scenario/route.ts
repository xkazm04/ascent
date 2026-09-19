// GET    /api/report/sandbox-scenario?repo=owner/name  -> SandboxScenarioRecord | null
// PUT    /api/report/sandbox-scenario?repo=owner/name  -> SandboxScenarioRecord   (save/replace)
// DELETE /api/report/sandbox-scenario?repo=owner/name  -> { ok: true }
//
// The Roadmap Sandbox's saved what-if: per-dimension overrides, the roadmap items it selected (by the
// shared recommendationDecisionKey identity, never dimension+title), and the projected score/level/
// delta as NUMBERS. One scenario per (org, repo, signed-in author) — PUT replaces.
//
// Gating mirrors PATCH /api/recommendations/:id, deliberately: a scenario is planning state about a
// team's own repo, so it needs org ACCESS (not merely read), and the shared "public" org — the
// anonymous free-scan funnel — is refused outright. Otherwise any visitor could write planning state
// onto every public report and read back someone else's.

import { NextResponse } from "next/server";
import {
  deleteSandboxScenario,
  getSandboxScenario,
  MAX_SCENARIO_ITEM_KEYS,
  saveSandboxScenario,
} from "@/lib/db";
import { PUBLIC_ORG, readableOrgForOwner } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { dbGuard } from "@/lib/api/orgPlan";
import { isDimensionId } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_REFUSAL = {
  error: "Saved sandbox scenarios are available for your own organization's scans.",
} as const;

/** Resolve + authorize the repo in the query string. Returns either a response to send, or the scope. */
async function scopeFor(request: Request): Promise<
  { denied: NextResponse } | { owner: string; name: string; orgSlug: string; login: string | null }
> {
  const q = new URL(request.url).searchParams.get("repo");
  if (!q) return { denied: NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 }) };
  const parsed = parseRepoParam(q);
  if (!parsed) return { denied: NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 }) };

  const orgSlug = await readableOrgForOwner(parsed.owner);
  if (orgSlug.trim().toLowerCase() === PUBLIC_ORG) {
    return { denied: NextResponse.json(PUBLIC_REFUSAL, { status: 403 }) };
  }
  const denied = await requireOrgAccess(orgSlug);
  if (denied) return { denied };
  return { owner: parsed.owner, name: parsed.name, orgSlug, login: await resolveViewerLogin() };
}

export async function GET(request: Request) {
  const guard = dbGuard("Saved sandbox scenarios", "Saved sandbox scenarios require a database.");
  if (guard) return guard;
  const scope = await scopeFor(request);
  if ("denied" in scope) return scope.denied;
  const scenario = await getSandboxScenario(scope.orgSlug, scope.owner, scope.name, scope.login);
  return NextResponse.json({ scenario });
}

interface PutBody {
  overrides?: Record<string, unknown>;
  itemKeys?: unknown;
  baselineScore?: unknown;
  baselineLevel?: unknown;
  baselineScanAt?: unknown;
  projectedScore?: unknown;
  projectedLevel?: unknown;
}

const isScore = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const isLevel = (v: unknown): v is string => typeof v === "string" && /^L[1-9]$/.test(v);

export async function PUT(request: Request) {
  const guard = dbGuard("Saved sandbox scenarios", "Saved sandbox scenarios require a database.");
  if (guard) return guard;
  const scope = await scopeFor(request);
  if ("denied" in scope) return scope.denied;

  const body = (await request.json().catch(() => ({}))) as PutBody;

  if (!isScore(body.baselineScore) || !isScore(body.projectedScore)) {
    return NextResponse.json({ error: "baselineScore and projectedScore must be numbers 0..100." }, { status: 400 });
  }
  if (!isLevel(body.baselineLevel) || !isLevel(body.projectedLevel)) {
    return NextResponse.json({ error: "baselineLevel and projectedLevel must be a level id (e.g. L3)." }, { status: 400 });
  }
  if (typeof body.baselineScanAt !== "string" || Number.isNaN(Date.parse(body.baselineScanAt))) {
    return NextResponse.json({ error: "baselineScanAt must be an ISO timestamp." }, { status: 400 });
  }

  // Only real dimension ids at real scores survive — the column is the sandbox's slider state, not a
  // free-text store, and an unknown key would silently do nothing on restore anyway.
  const overrides: Partial<Record<DimensionId, number>> = {};
  for (const [k, v] of Object.entries(body.overrides ?? {})) {
    if (isDimensionId(k) && isScore(v)) overrides[k] = Math.round(v);
  }

  const rawKeys = Array.isArray(body.itemKeys) ? body.itemKeys : [];
  if (rawKeys.length > MAX_SCENARIO_ITEM_KEYS) {
    return NextResponse.json(
      { error: `A scenario may select at most ${MAX_SCENARIO_ITEM_KEYS} recommendations.` },
      { status: 400 },
    );
  }
  const itemKeys = rawKeys.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 200);

  const scenario = await saveSandboxScenario(scope.orgSlug, scope.owner, scope.name, scope.login, {
    overrides,
    itemKeys,
    baselineScore: body.baselineScore,
    baselineLevel: body.baselineLevel,
    baselineScanAt: body.baselineScanAt,
    projectedScore: body.projectedScore,
    projectedLevel: body.projectedLevel,
  });
  if (!scenario) return NextResponse.json({ error: "Could not save the scenario." }, { status: 500 });
  return NextResponse.json({ scenario });
}

export async function DELETE(request: Request) {
  const guard = dbGuard("Saved sandbox scenarios", "Saved sandbox scenarios require a database.");
  if (guard) return guard;
  const scope = await scopeFor(request);
  if ("denied" in scope) return scope.denied;
  await deleteSandboxScenario(scope.orgSlug, scope.owner, scope.name, scope.login);
  return NextResponse.json({ ok: true });
}
