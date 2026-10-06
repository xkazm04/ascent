// POST /api/integrations/openai/sync { org } -> { synced, days, costCents, stored, partial, ... }
//
// Pull the org's OpenAI spend from the Admin Costs API with the owner-supplied admin key and fold it
// into `AiUsageRecord` as org-scope, allocated day records: the same rollup Copilot and the JSON
// ingest feed (`getOrgUsageRollup`), not a parallel one. Unlike Copilot, these records carry REAL
// cost, so a synced org's `hasAllocatedCost` turns true and Delivery distributes the total across
// repos by git-attributed AI volume. Mirrors copilot/sync/route.ts, down to the owner gate.
//
// `mode: "replace"`: each bucket is that day's TOTAL, so re-syncing an overlapping window overwrites
// the day rather than accumulating it.
//
// PARTIAL: a pull that stopped early (page cap, rate limit, outage after some pages) stores the whole
// days it did read, answers `partial: true` with the reason, and records the sync as partial on the
// connection row. It is never reported, stored or audited as a complete window.
//
// The admin key is read here and handed to the fetch; it never reaches a response, a log or the audit.

import { NextResponse } from "next/server";
import { getOrgId, isDbConfigured, recordAudit, recordUsage } from "@/lib/db";
import { getProviderSecret, recordProviderSync } from "@/lib/db/provider-credentials";
import { requireOrgAccess, hasOrgRole } from "@/lib/authz";
import {
  buildOpenAIUsage,
  costsWindowStart,
  fetchOpenAICosts,
  summarizeOpenAISync,
  type OpenAIStop,
} from "@/lib/integrations/openai-costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A failed pull (nothing read) → status + the operator-facing sentence. */
const FAILED: Record<Exclude<OpenAIStop, "page-cap">, { status: number; error: string }> = {
  denied: {
    status: 403,
    error: "OpenAI refused the key. The Costs API needs an organization Admin key (sk-admin-...), not a project or service-account key.",
  },
  "rate-limited": { status: 429, error: "OpenAI rate-limited the Costs API. Nothing was stored; try again in a minute." },
  unreachable: { status: 502, error: "The OpenAI Costs API could not be reached (or errored). Nothing was stored; try again shortly." },
  malformed: { status: 502, error: "The OpenAI Costs API returned an unexpected response. Nothing was stored." },
};

/** Why a pull that DID read something stopped before the end of the window. */
const PARTIAL_REASON: Record<OpenAIStop, string> = {
  "page-cap": "OpenAI reported more days than one sync reads; the later days were not pulled.",
  "rate-limited": "OpenAI rate-limited the pull before the window was complete; the later days were not pulled.",
  unreachable: "The OpenAI Costs API stopped answering before the window was complete; the later days were not pulled.",
  malformed: "OpenAI returned an unexpected page before the window was complete; the later days were not pulled.",
  denied: "OpenAI refused a later page; the later days were not pulled.",
};

// NO same-origin guard, deliberately: scripts and schedulers drive this pull, and they send no
// `Origin` / `Sec-Fetch-Site`. Operator decision 2026-10-06 (security scan F1) — the sibling PUT and
// DELETE on /api/integrations/openai are browser-only and DO carry the guard. Do not re-flag.
export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The OpenAI connector requires a database." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  const org = body.org;
  if (!org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });

  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  if (!(await hasOrgRole(org, "owner"))) {
    return NextResponse.json({ error: "Connecting a provider is owner-only." }, { status: 403 });
  }

  const secret = await getProviderSecret(org, "openai");
  if (!secret.key) {
    const error =
      secret.reason === "absent"
        ? "No OpenAI admin key is connected for this organization. Save one on the Integrations page first."
        : "The stored OpenAI admin key cannot be read on this deployment (ENCRYPTION_KEY is missing or changed). Save the admin key again.";
    return NextResponse.json({ error }, { status: 409 });
  }

  const pull = await fetchOpenAICosts(secret.key, { startTime: costsWindowStart(Date.now()), projectIds: secret.projectIds });
  const built = buildOpenAIUsage(org, pull.buckets);

  if (built.records.length === 0 && pull.stop && pull.stop !== "page-cap") {
    const f = FAILED[pull.stop];
    await recordProviderSync(org, "openai", { status: "failed", detail: f.error, from: null, through: null });
    return NextResponse.json({ error: f.error }, { status: f.status });
  }

  const res = await recordUsage(org, built.records, { mode: "replace" });
  const summary = summarizeOpenAISync(built.records);
  const partial = !pull.complete;
  const partialReason = pull.stop ? PARTIAL_REASON[pull.stop] : null;

  await recordProviderSync(org, "openai", {
    status: partial ? "partial" : "complete",
    detail: partialReason,
    from: built.from,
    through: built.through,
  });
  const orgId = await getOrgId(org).catch(() => null);
  await recordAudit(
    "integrations.openai.sync",
    { ...summary, stored: res.stored, partial, stop: pull.stop, pages: pull.pages, skippedNonUsd: built.skippedNonUsd },
    { orgId: orgId ?? undefined },
  );

  return NextResponse.json({
    synced: true,
    ...summary,
    stored: res.stored,
    partial,
    ...(partialReason ? { partialReason } : {}),
    from: built.from?.toISOString() ?? null,
    through: built.through?.toISOString() ?? null,
    skippedNonUsd: built.skippedNonUsd,
    note:
      "OpenAI reports cost by organization and project, not by repository. AI delivery distributes this total " +
      "across repositories by git-attributed AI volume, and marks those figures Allocated.",
  });
}
