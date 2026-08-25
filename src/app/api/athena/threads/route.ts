// GET  /api/athena/threads?org=      -> { threads, thread, turns, proposals, engine }   (read-gated)
// POST /api/athena/threads { org }   -> { thread }                                      (member gate)
//
// ONE BOOT REQUEST. The GET returns the ledger AND the newest thread's transcript, its open proposals
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
    // Only what is still awaiting an answer. A resolved proposal is transcript, and the transcript is
    // already in `turns`.
    proposals: proposals.filter((p) => p.status === "open"),
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
