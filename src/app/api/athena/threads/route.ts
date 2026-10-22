// GET  /api/athena/threads?org=      -> { threads, thread, turns, proposals, engine }   (read-gated)
// POST /api/athena/threads { org }   -> { thread }                                      (member gate)
//
// ONE BOOT REQUEST. The GET returns the ledger AND the newest thread's transcript, its proposals
// and the engine state. The obvious alternative — list the threads, then let the client fetch the one
// it was always going to open — is a second round trip for data the first query already knew the
// identity of, paid on every single mount of the panel. Nothing here is expensive: the rail is one
// indexed query (`[orgId, updatedAt]`), the transcript is one more, and the engine probe resolves a
// provider without calling it.
//
// SHE DOES NOT SPEAK FIRST. POST creates an empty, untitled thread and calls no model. An opener
// would spend an org's tokens on a greeting nobody asked for, and it would have nothing to say: at
// creation time she has no message to answer. The first spend happens when someone actually types
// something. It is also why the thread has no title yet — the title comes from the first user turn
// (`deriveThreadTitle`), so a thread that is never used never invents a name for itself.

import { NextResponse } from "next/server";
import {
  createAthenaThread,
  listAthenaThreads,
  listAthenaTurns,
  listThreadAthenaProposals,
} from "@/lib/db/athena";
import { athenaActionSummary, payloadParams, type AthenaActionParamValues } from "@/lib/athena/actions";
import { gateAthenaOrg, probeAthenaEngine, refused } from "@/app/api/athena/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await gateAthenaOrg(new URL(request.url).searchParams.get("org"), "read");
  if (refused(ctx)) return ctx;

  const [threads, engine] = await Promise.all([
    listAthenaThreads(ctx.orgId),
    probeAthenaEngine(ctx.org),
  ]);

  // `listAthenaThreads` orders by `updatedAt desc`, which is "last spoken in", so the head of the
  // list is the conversation the operator was actually having.
  const newest = threads[0] ?? null;
  const [turns, proposals] = newest
    ? await Promise.all([
        listAthenaTurns(ctx.orgId, newest.id),
        listThreadAthenaProposals(ctx.orgId, newest.id),
      ])
    : [[], []];

  return NextResponse.json({
    threads,
    thread: newest,
    turns,
    // EVERY status, not only the open ones: an answered card paints its stamped outcome after a reload
    // (the outcome rides in `payload.outcome`), and an expired one says so instead of vanishing.
    //
    // THE SENTENCE IS RESOLVED HERE, from the action spec, by the same `athenaActionSummary` the cron
    // briefing uses. An action payload stores `{ params }` only, so a client-side reader would have
    // nothing to read. Only the sentence crosses: the spec itself (and its `requiredRole`) does not.
    // A retired action or an identity diff has no spec, and its summary is null.
    proposals: proposals.map((p) => ({
      ...p,
      summary: athenaActionSummary(p.kind, payloadParams(p.payload) as AthenaActionParamValues),
    })),
    // `degraded` is the flag the panel reads; the rest names WHICH engine, because "an LLM answered"
    // and "gemini-2.5-flash answered" are different amounts of information.
    degraded: engine.degraded,
    engine,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { org?: unknown };
  const ctx = await gateAthenaOrg(typeof body.org === "string" ? body.org : null, "write");
  if (refused(ctx)) return ctx;

  const thread = await createAthenaThread(ctx.orgId);
  if (!thread) return NextResponse.json({ error: "Could not start a conversation." }, { status: 500 });
  return NextResponse.json({ thread }, { status: 201 });
}
