// THE TURN — one exchange with Athena, as a function that returns typed events.
//
// A TURN IS NOT A ROUTE. Everything that decides what she says lives here; the SSE route
// (src/app/api/athena/[id]/message/route.ts) is an adapter that renames these events into `event:`
// frames and carries no turn logic whatsoever. That split is what makes the interesting half
// testable: this module has NO database, NO network and NO Next.js — every dependency arrives as an
// injected function, so a full turn runs against fakes in a plain node test. If a rule about how she
// answers is ever only reachable through an HTTP request, it has been written in the wrong file.
//
// THE EVENT VOCABULARY IS THE CONTRACT between the turn and every transport it will ever have. It is
// deliberately small, and deliberately has room in it:
//
//   phase    which of the three visible stages she is in — the strip above the reply
//   recall   what she already knew that bears on this (at most two chips; often none)
//   tool     a tool she is calling right now, by name
//   settled  the persisted turn: prose, blocks, counts, provenance
//   error    the turn did not produce an answer, and this is why
//
// ROOM FOR `{ type: "delta"; text: string }`. Token streaming is not implemented — `runToolLoop`
// resolves with a whole completion and does not surface partials. But the client is written against
// this union rather than against "wait for settled", so adding a `delta` event later is a change to
// the turn and the renderer ONLY: the transport, the persistence and the block parser are untouched,
// and a client that does not understand `delta` still renders correctly off `settled`. That is why
// `settled` carries the FULL turn rather than "the rest of it".

import type { TokenUsage, ProviderName } from "@/lib/types";
import type { AthenaTool, ToolCall } from "@/lib/llm/leg";
import type { AthenaTurnRecord } from "@/lib/db/athena-threads";
import { parseAthenaBlocks, type AthenaBlock } from "@/lib/athena/blocks";
import { athenaActionPayload, parseAthenaActions } from "@/lib/athena/actions";
import { buildAthenaPrompt, ATHENA_NO_ENGINE_REPLY, ATHENA_HISTORY_TURNS } from "@/lib/athena/prompt";
import { selectRecallChips, type AthenaGrounding, type AthenaRecallChip } from "@/lib/athena/grounding";

export type AthenaPhase = "recalling" | "grounding" | "thinking";

export type AthenaEvent =
  | { type: "phase"; phase: AthenaPhase }
  | { type: "recall"; chips: AthenaRecallChip[] }
  | { type: "tool"; name: string }
  | { type: "settled"; turn: AthenaTurnRecord }
  | { type: "error"; message: string };

/** The subset of `ToolLoopRun` a turn reasons over. `ToolLoopRun` satisfies it structurally, so the
 *  route passes `runToolLoop` straight through and a test passes a two-line fake. */
export interface AthenaLoopRun {
  text: string;
  usage: TokenUsage;
  legs: number;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  truncated: boolean;
  grounding: "tools" | "prefetched";
  engine: ProviderName;
  model: string;
}

export interface AthenaLoopRequest {
  prompt: string;
  tools: AthenaTool[];
  execute: (call: ToolCall) => Promise<string>;
  signal?: AbortSignal;
}

export interface AthenaPersistInput {
  role: "user" | "assistant";
  content: string;
  meta?: Record<string, unknown>;
  /** null = the provider reported nothing. NEVER 0 for unknown — see athena-threads.ts. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  legs?: number | null;
  /**
   * Offers this turn makes. Handed to `appendTurn` rather than written by a second call, because the
   * store writes them IN THE SAME TRANSACTION as the turn (athena-threads.ts): a proposal whose turn
   * was never written is an Accept button under nothing, and a turn pointing at rows that were never
   * inserted is a card painted empty.
   */
  proposals?: { kind: string; payload: Record<string, unknown> }[];
}

export interface AthenaTurnDeps {
  /** Memories that may bear on the message. Ranked by the caller; this module only decides what SHOWS. */
  recall: (message: string) => Promise<{ id: string; content: string; kind?: string }[]>;
  identity: () => Promise<{ constitution: string | null; selfModel: string | null }>;
  /** Prior turns, oldest first. Trimmed to {@link ATHENA_HISTORY_TURNS} before the prompt is built. */
  history: () => Promise<{ role: "user" | "assistant"; content: string }[]>;
  /** Null means REFUSED — the caller may not read this org, and no model may be called. */
  grounding: () => Promise<AthenaGrounding | null>;
  /** Null means NO ENGINE — a first-class answer, not an error. */
  runLoop: (req: AthenaLoopRequest) => Promise<AthenaLoopRun | null>;
  appendTurn: (input: AthenaPersistInput) => Promise<AthenaTurnRecord | null>;
  /** Never throws by contract (athena-episodes.ts); a memory write must not cost a good answer. */
  writeEpisode: (input: { content: string; tags: string[]; confidence?: number }) => Promise<unknown>;
  now?: () => Date;
}

export interface AthenaTurnInput {
  orgSlug: string;
  threadId: string;
  message: string;
  signal?: AbortSignal;
  deps: AthenaTurnDeps;
}

/** What the operator is told when the gate refuses. Deliberately identical in wording to a missing
 *  thread: the answer must not become an oracle for which orgs exist. */
export const ATHENA_REFUSED_MESSAGE = "This conversation isn't available for this organization.";

/** Longest excerpt of the message / reply an episode carries. An episode is a note, not a transcript. */
const EPISODE_EXCERPT = 400;

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

function firstSentence(s: string, max: number): string {
  const f = flat(s);
  if (!f) return "";
  const end = f.search(/[.!?](\s|$)/);
  const sentence = (end > 0 ? f.slice(0, end + 1) : f).trim();
  return sentence.length <= max ? sentence : `${sentence.slice(0, max).trimEnd()}…`;
}

/**
 * When persistence is unavailable (no database), the answer still exists and must still reach the
 * operator — so a record is synthesized rather than the turn failing. `id: ""` is the honest marker:
 * there is no row, so nothing can address this turn later. A client MUST NOT treat it as addressable.
 */
function unpersisted(threadId: string, content: string, meta: Record<string, unknown>, at: Date): AthenaTurnRecord {
  return {
    id: "",
    threadId,
    role: "assistant",
    content,
    meta: { ...meta, persisted: false },
    inputTokens: null,
    outputTokens: null,
    legs: null,
    createdAt: at.toISOString(),
  };
}

/**
 * Run one exchange.
 *
 * The generator yields as work completes; the consumer decides what to do with each event. Tool
 * events are the awkward case — they originate inside a CALLBACK the loop invokes, not in this
 * generator's own control flow — so they are pushed onto a small queue and drained here. The
 * alternative (handing the loop a channel that writes to the transport) would put transport knowledge
 * back inside the turn, which is the one thing this file exists to prevent.
 */
export async function* runAthenaTurn(input: AthenaTurnInput): AsyncIterable<AthenaEvent> {
  const { deps, message, threadId } = input;
  const now = deps.now ?? (() => new Date());

  // The question is persisted BEFORE anything is spent. A turn that dies mid-completion then leaves a
  // thread showing what was asked and no reply — which is a legible failure — rather than a thread
  // that silently forgot the operator said anything. It is also what names an untitled thread.
  await deps.appendTurn({ role: "user", content: message });

  yield { type: "phase", phase: "recalling" };
  let recalled: { id: string; content: string; kind?: string }[] = [];
  try {
    recalled = await deps.recall(message);
  } catch {
    recalled = []; // a recall failure degrades the answer; it does not cancel it
  }
  const chips = selectRecallChips(recalled, message);
  // Nothing is emitted when nothing survives the surfacing filter. An empty strip beats echoing the
  // operator's own question back at them under the heading "what I remembered".
  if (chips.length > 0) yield { type: "recall", chips };

  yield { type: "phase", phase: "grounding" };
  const grounding = await deps.grounding();
  if (!grounding) {
    // The read gate refused. No prompt is built, no model is called, nothing is persisted as an
    // answer — the refusal happens strictly before any spend.
    yield { type: "error", message: ATHENA_REFUSED_MESSAGE };
    return;
  }

  const [identity, history] = await Promise.all([
    deps.identity().catch(() => ({ constitution: null, selfModel: null })),
    deps.history().catch(() => [] as { role: "user" | "assistant"; content: string }[]),
  ]);

  const prompt = buildAthenaPrompt({
    orgSlug: input.orgSlug,
    constitution: identity.constitution,
    selfModel: identity.selfModel,
    recall: recalled,
    grounding: grounding.tools.length > 0 ? "tools" : "prefetched",
    history: history.slice(-ATHENA_HISTORY_TURNS),
    message,
  });

  yield { type: "phase", phase: "thinking" };

  // ── the tool-event pump ────────────────────────────────────────────────────────────────────────
  // `execute` runs inside the loop, so it cannot yield. It pushes instead, and the drain below
  // interleaves those pushes with the loop's completion. There is no `await` between the drain check
  // and the parking promise, so a push can never land in the gap and be lost.
  const pending: AthenaEvent[] = [];
  const NOOP = () => {};
  let wake: () => void = NOOP;
  let settledLoop = false;

  // Both outcomes are folded into the RESOLVED value rather than left as a rejection: the drain loop
  // below only needs to know "is it over", and a promise that can reject would need a second handler
  // in the middle of the pump. `outcome` is read AFTER the drain, so it is never a closure-captured
  // mutable that the type checker has to guess about.
  const loopPromise = deps
    .runLoop({
      prompt,
      tools: grounding.tools,
      execute: async (call: ToolCall) => {
        pending.push({ type: "tool", name: call.name });
        wake();
        return grounding.execute(call);
      },
      signal: input.signal,
    })
    .then(
      (r) => ({ ok: true, run: r }) as const,
      (e: unknown) => ({ ok: false, error: e }) as const,
    );

  void loopPromise.then(() => {
    settledLoop = true;
    wake();
  });

  for (;;) {
    while (pending.length > 0) yield pending.shift()!;
    if (settledLoop) break;
    await new Promise<void>((resolve) => {
      wake = () => {
        wake = NOOP;
        resolve();
      };
    });
    wake = NOOP;
  }

  const outcome = await loopPromise;

  if (!outcome.ok) {
    yield {
      type: "error",
      message: outcome.error instanceof Error ? outcome.error.message : "The model call failed.",
    };
    return;
  }

  const at = now();

  // ── keyless: she still answers, in ONE quiet line, and writes NO episode ───────────────────────
  // The payload says which mode she was in. "She remembered nothing" and "she may not remember" are
  // different facts about this deployment, and only one of them is something an operator can fix.
  if (!outcome.run) {
    const meta = { degraded: "no_engine", grounding: "none", blocks: [] as AthenaBlock[] };
    const record =
      (await deps.appendTurn({
        role: "assistant",
        content: ATHENA_NO_ENGINE_REPLY,
        meta,
        inputTokens: null,
        outputTokens: null,
        legs: null,
      })) ?? unpersisted(threadId, ATHENA_NO_ENGINE_REPLY, meta, at);
    yield { type: "settled", turn: record };
    return;
  }

  const loop: AthenaLoopRun = outcome.run;
  // ORDER IS LOAD-BEARING. `parseAthenaBlocks` only consumes `athena:table` and `athena:chart` fences,
  // so an `athena:action` fence left in place would survive into the prose and be shown to the operator
  // as raw JSON. The actions come out FIRST; the block parser then applies the prose budget last, over
  // text with no fences of either kind left in it.
  const acts = parseAthenaActions(loop.text);
  const parsed = parseAthenaBlocks(acts.text);
  const meta: Record<string, unknown> = {
    blocks: parsed.blocks,
    chips,
    grounding: loop.grounding,
    truncated: loop.truncated,
    engine: loop.engine,
    model: loop.model,
    // Counted, not silent: a block that vanishes without a number beside it is indistinguishable
    // from a model that never emitted one, and only one of those is worth fixing.
    droppedBlocks: parsed.dropped,
    truncatedBlocks: parsed.truncated,
    overflowBlocks: parsed.overflow,
    // Same reasoning as the block counts: an offer that silently vanishes is indistinguishable from a
    // model that never made one, and only one of those is worth fixing.
    droppedActions: acts.dropped,
    overflowActions: acts.overflow,
    toolsCalled: loop.toolCalls.map((c) => c.name),
    phases: ["recalling", "grounding", "thinking"],
  };

  // The episode is written BEFORE `settled` is yielded, not after: a generator suspends at a yield
  // until its consumer pulls again, and a consumer that stops at the answer would leave the write
  // permanently unrun. `writeEpisode` never throws by contract, so this cannot cost the answer.
  if (parsed.prose.trim()) {
    await deps.writeEpisode({
      content: `Asked: ${firstSentence(message, EPISODE_EXCERPT)}\nAnswered: ${firstSentence(parsed.prose, EPISODE_EXCERPT)}`,
      tags: ["athena", `thread:${threadId}`],
      // Below 1.0 deliberately: this is her paraphrase of an exchange, not a fact the org asserted.
      confidence: 0.5,
    });
  }

  const record =
    (await deps.appendTurn({
      role: "assistant",
      content: parsed.prose,
      meta,
      // `?? null` and never `?? 0`: a provider that reported no usage told us nothing, and a 0 here
      // is summed and averaged downstream as if it were a measurement.
      inputTokens: loop.usage.inputTokens ?? null,
      outputTokens: loop.usage.outputTokens ?? null,
      legs: loop.legs,
      proposals: acts.actions.map((a) => ({ kind: a.id, payload: athenaActionPayload(a) })),
    })) ?? unpersisted(threadId, parsed.prose, meta, at);

  yield { type: "settled", turn: record };
}
