// The client half of one exchange: POST the message, read the SSE frames back, hand up typed events.
//
// The frames are named after the turn's own event `type` (the route renames nothing), so the whole
// client-side contract is "is this frame one of the five names, and is its payload the right shape".
// `toAthenaEvent` is that check, pure and exported, because a renderer that trusts `msg.data` blindly
// is one malformed frame away from a crash in the middle of an answer.
//
// A `delta` frame is NOT handled here and that is deliberate: token streaming does not exist yet, the
// union has room for it, and an unknown frame returns null rather than throwing — so the day it ships,
// a client that has not been updated keeps rendering correctly off `settled`.

import { readSSE, type SSEMessage } from "@/lib/sse";
import type { AthenaEvent, AthenaPhase } from "@/lib/athena/turn";
import type { AthenaTurnRecord } from "@/lib/db/athena-threads";

const PHASES: readonly AthenaPhase[] = ["recalling", "grounding", "thinking"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One SSE frame → a turn event, or null for `done`, a keepalive, or anything unrecognised. */
export function toAthenaEvent(msg: SSEMessage): AthenaEvent | null {
  const d = msg.data;
  if (!d) return null;
  switch (msg.event) {
    case "phase": {
      const phase = d.phase;
      return typeof phase === "string" && (PHASES as readonly string[]).includes(phase)
        ? { type: "phase", phase: phase as AthenaPhase }
        : null;
    }
    case "recall": {
      if (!Array.isArray(d.chips)) return null;
      const chips = d.chips
        .filter((c): c is { insight: string } => isRecord(c) && typeof c.insight === "string")
        .map((c) => ({ insight: c.insight }));
      return chips.length > 0 ? { type: "recall", chips } : null;
    }
    case "tool":
      return typeof d.name === "string" && d.name ? { type: "tool", name: d.name } : null;
    case "settled":
      return isRecord(d.turn) && typeof (d.turn as { id?: unknown }).id === "string"
        ? { type: "settled", turn: d.turn as unknown as AthenaTurnRecord }
        : null;
    case "error":
      return { type: "error", message: typeof d.message === "string" && d.message ? d.message : "The turn failed." };
    default:
      return null;
  }
}

/** Start a conversation. No model is called by this route — it is a row, not an opener. */
export async function createAthenaThread(org: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch("/api/athena/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org }),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { thread?: { id?: unknown } } | null;
  const id = body?.thread?.id;
  return typeof id === "string" && id ? id : null;
}

/** Read the boot payload — the ledger, the newest thread's turns, its open proposals, the engine state. */
export async function fetchAthenaBoot(org: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`/api/athena/threads?org=${encodeURIComponent(org)}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 403 ? "This conversation isn't available for this organization." : String(res.status));
  return res.json();
}

/**
 * Send one message and drain the stream. Every failure — a refused gate before the stream opens, a
 * mid-stream `error` frame, a dead socket — arrives through `onEvent` as an `error` event, so the
 * caller has exactly ONE place that learns a turn produced no answer.
 */
export async function streamAthenaMessage(opts: {
  org: string;
  threadId: string;
  message: string;
  signal?: AbortSignal;
  onEvent: (event: AthenaEvent) => void;
}): Promise<void> {
  const { org, threadId, message, signal, onEvent } = opts;
  let res: Response;
  try {
    res = await fetch(`/api/athena/${encodeURIComponent(threadId)}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org, message }),
      signal,
    });
  } catch {
    onEvent({ type: "error", message: "Couldn't reach the server." });
    return;
  }
  // Before the stream opens there is still a status code to read, so a refusal arrives as JSON.
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    onEvent({
      type: "error",
      message: typeof body?.error === "string" ? body.error : "The turn failed.",
    });
    return;
  }
  try {
    await readSSE(res.body, (msg) => {
      const event = toAthenaEvent(msg);
      if (event) onEvent(event);
    });
  } catch {
    // An aborted read is the caller unmounting or cancelling; it is not an answer that failed.
    if (!signal?.aborted) onEvent({ type: "error", message: "The connection dropped mid-answer." });
  }
}
