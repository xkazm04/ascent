// POST /api/org/skills/events { org, events: [{ skillId, type, repo?, source? }] } -> { recorded }
// Batch usage telemetry — the "track back the use rate" half of the loop. A synced repo / CI job / Claude
// Code hook reports `download` (a real use) and `sync` (a background pull). The third type, `invoke`, was
// retired on 2026-07-29: nothing ever emitted it, so the one signal that could mark a skill `active` was
// unproducible. Batched because hooks fire often; the whole insert is best-effort and never blocks the
// caller — an installed client still posting `invoke` has that event dropped, not the whole batch
// rejected, as long as it also reports a valid type. Gated on `telemetry:write`
// (token) or a session. Events are filtered server-side to skills that belong to `org` (the tenant
// boundary), so a forged skillId is silently dropped. A `sync` is logged but never inflates "most used".

import { NextResponse } from "next/server";
import { isDbConfigured, isSkillEventType, recordSkillEvents, type SkillEventInput } from "@/lib/db";
import { authorizeOrgApi, isDenied } from "@/lib/api-token-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVENTS = 500; // bound the insert; a client with more batches across calls

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    events?: Array<{ skillId?: string; type?: string; repo?: string; source?: string }>;
  };
  if (!body.org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty events array." }, { status: 400 });
  }
  // telemetry:write — reporting usage is a distinct, lower-trust capability than authoring skills.
  const auth = await authorizeOrgApi(request, body.org, { scope: "telemetry:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;

  const events: SkillEventInput[] = body.events
    .slice(0, MAX_EVENTS)
    .filter((e): e is { skillId: string; type: string; repo?: string; source?: string } =>
      Boolean(e && typeof e.skillId === "string" && typeof e.type === "string" && isSkillEventType(e.type)),
    )
    .map((e) => ({ skillId: e.skillId, type: e.type as SkillEventInput["type"], repo: e.repo ?? null, source: e.source ?? null }));
  if (!events.length) return NextResponse.json({ error: "No valid events (type must be download|sync)." }, { status: 400 });

  const { recorded } = await recordSkillEvents(body.org, events);
  return NextResponse.json({ recorded });
}
