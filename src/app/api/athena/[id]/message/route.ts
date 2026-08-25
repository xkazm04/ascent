// POST /api/athena/:id/message  { org, message }  ->  text/event-stream   (member gate)
//
// One exchange, streamed. This file is an ADAPTER and nothing else: it authorizes, it resolves every
// request-scoped fact, it renames `AthenaEvent`s into SSE frames, and it closes the stream. Every
// decision about what she says lives in `src/lib/athena/turn.ts`, which has no idea this transport
// exists — which is why a turn can be tested end to end with no server, no database and no network.
//
// ── THE TRAP THIS ROUTE IS BUILT AROUND ────────────────────────────────────────────────────────
//
// `next/headers` cookies are NOT readable inside a `ReadableStream`'s `start()` callback: `getViewer()`
// there returns null. Every cookie-scoped fact — the viewer, the read decision, the plan — is
// therefore resolved in REQUEST SCOPE, above `new ReadableStream`, and closed over. The precedent,
// carrying the same comment, is `src/app/api/scan/stream/route.ts`.
//
// The failure mode if this is got wrong is quiet rather than loud, which is what makes it worth a
// header: the stream would still open, she would still answer, and every tool would refuse — so the
// operator would get a fluent, confident, completely ungrounded reply with no error anywhere.
//
// ── ERRORS AFTER THE STREAM OPENS ──────────────────────────────────────────────────────────────
//
// Once the 200 and the headers are on the wire there is no status code left to change, so a failure
// is delivered as an `error` FRAME and the stream closes normally. A client that sees `error` without
// `settled` knows the turn produced no answer; that is a better contract than a socket that dies.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";
import { getAthenaThread } from "@/lib/db/athena";
import { runAthenaTurn } from "@/lib/athena/turn";
import { buildAthenaTurnDeps, gateAthenaOrg, refused, resolveAthenaGates } from "@/app/api/athena/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longest message accepted. A prompt-sized paste is a different feature, not a chat turn. */
const MESSAGE_MAX = 8_000;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { org?: unknown; message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";

  const gated = await gateAthenaOrg(typeof body.org === "string" ? body.org : null, "write");
  if (refused(gated)) return gated;
  if (!message) return NextResponse.json({ error: "Say something." }, { status: 400 });
  if (message.length > MESSAGE_MAX) {
    return NextResponse.json({ error: `A message is at most ${MESSAGE_MAX} characters.` }, { status: 400 });
  }

  // ANDed with the org id — a thread id from another tenant resolves to nothing, so a guessed id is a
  // 404 rather than a conversation.
  const thread = await getAthenaThread(gated.orgId, id);
  if (!thread) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  // ── EVERYTHING COOKIE-SCOPED, RESOLVED HERE. See the header. ─────────────────────────────────
  const viewer = await resolveViewerLogin();
  const { canRead, memoryAllowed } = await resolveAthenaGates(gated.org);

  const deps = buildAthenaTurnDeps({ ...gated, threadId: thread.id, viewer, canRead, memoryAllowed });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = makeSseSend(controller);
      try {
        for await (const event of runAthenaTurn({
          orgSlug: gated.org,
          threadId: thread.id,
          message,
          signal: request.signal,
          deps,
        })) {
          // The SSE event NAME is the union's `type`, verbatim. A translation table here would be one
          // more place for the client and the turn to drift apart; `phase`/`recall`/`tool`/`settled`/
          // `error` is the vocabulary on both sides of the wire.
          send(event.type, event);
        }
      } catch (err) {
        console.error("[athena] turn failed", { thread: thread.id, err });
        send("error", {
          type: "error",
          message: err instanceof Error ? err.message : "The turn failed.",
        });
      } finally {
        // `done` is the client's cue to stop reading. Sent on every path, including the error one, so
        // a UI never has to distinguish "still thinking" from "gave up" by timing out.
        send("done", { ok: true });
        try {
          controller.close();
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
