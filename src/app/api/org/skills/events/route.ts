// POST /api/org/skills/events { org, events: [{ skillId, type, repo?, source?, session?, ts? }] } -> { recorded }
//
// Batch usage telemetry — the "track back the use rate" half of the loop, and SINK A of the two-sink
// contract (#19). Three types: `invoke` (a skill actually ran — the PreToolUse hook, a CI job, or the
// MCP tool path), `download` (a human copy/download) and `sync` (a background pull, logged but never a
// use). This is the ONLY sink that may carry `repo`: the registry's `usage/` lane is constitutionally
// repo-free, so a repo dimension exists here, inside the tenant's own database, or nowhere.
//
// Batched because hooks fire often; the whole insert is best-effort and never blocks the caller. An
// event with an unknown type is dropped without rejecting its batch-mates; a batch of only invalid
// events is a 400. Gated on `telemetry:write` (token) or a session. Events are filtered server-side to
// skills that belong to `org` (the tenant boundary), so a forged skillId is silently dropped.
//
// `session` + `ts` are the idempotency pair: a retried batch with the same (session, skill, ts) records
// once. `ts` is clamped server-side, so a skewed clock cannot backdate a live skill into dormancy.

import { NextResponse } from "next/server";
import { isDbConfigured, isSkillEventType, recordSkillEvents, type SkillEventInput } from "@/lib/db";
import { authorizeOrgApi, isDenied } from "@/lib/api-token-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENTS = 500; // bound the insert; a client with more batches across calls

type WireEvent = { skillId?: string; type?: string; repo?: string; source?: string; session?: string; ts?: string };

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; events?: WireEvent[] };
  if (!body.org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty events array." }, { status: 400 });
  }
  // telemetry:write — reporting usage is a distinct, lower-trust capability than authoring skills.
  const auth = await authorizeOrgApi(request, body.org, { scope: "telemetry:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const events: SkillEventInput[] = body.events
    .slice(0, MAX_EVENTS)
    .filter((e): e is WireEvent & { skillId: string; type: string } =>
      Boolean(e && typeof e.skillId === "string" && typeof e.type === "string" && isSkillEventType(e.type)),
    )
    .map((e) => ({
      skillId: e.skillId,
      type: e.type as SkillEventInput["type"],
      repo: str(e.repo),
      // Kept as the producer wrote it: `recordSkillEvents` normalizes it against the closed
      // vocabulary, so the enum lives in ONE place instead of being re-decided per route.
      source: str(e.source),
      session: str(e.session),
      ts: str(e.ts),
    }));
  if (!events.length) {
    return NextResponse.json({ error: "No valid events (type must be invoke|download|sync)." }, { status: 400 });
  }

  const { recorded } = await recordSkillEvents(body.org, events);
  return NextResponse.json({ recorded });
}
