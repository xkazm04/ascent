// PI'S JSONL EVENT STREAM, folded into the shapes the lane already consumes — pure, so the whole of
// it is table-testable against a captured real session without a subprocess in the room.
//
// The output types are NOT new. `AgentStreamEvent` feeds the theater's live tail and `AgentEnvelope`
// feeds the lane's cost row; a second transport that invented its own shapes would make every reader
// a two-branch reader. So this module's entire job is translation, and the Claude-shaped contract on
// the other side is unchanged.
//
// WHAT A REAL RUN SHOWED (pi 0.86.1, provider ollama / qwen3.8:27b, 2026-09-21 — the two fixtures in
// `__fixtures__/pi-0.86.1-*.jsonl` are those sessions verbatim). Four things differ from Claude in
// ways that would each be a silent wrong number if assumed rather than read:
//
//   1. THERE IS NO `result` FIELD, AND NO TERMINAL ENVELOPE OBJECT. Claude's stream ends with one
//      `{"type":"result", result, total_cost_usd, num_turns, duration_ms, usage}` line that carries
//      the whole session's accounting. Pi ends with `agent_end` + `agent_settled` and carries none of
//      it. The session's answer is the TEXT BLOCKS OF THE LAST ASSISTANT `message_end`. An adapter
//      that looked for `.result` would report every successful Pi session as "no JSON envelope".
//
//   2. PI EXITS 0 ON A TOTAL FAILURE. A run whose endpoint was dead retried three times and exited
//      with status 0, having produced only `stopReason: "error"` assistant messages and a closing
//      `auto_retry_end {"success": false, "finalError": "Connection error."}`. `ok` is therefore read
//      from the STREAM — never from the exit code. (The other failure shape is the opposite: an
//      unknown provider exits 1 with an EMPTY stdout and one sentence on stderr, which is why the
//      caller's stderr is part of the parse options.)
//
//   3. THE DOCUMENTED "CUMULATIVE" USAGE IS NOT CUMULATIVE ON THIS PATH. `docs/json.md` says the
//      top-level `usage` on `message_update` is "the latest cumulative provider-reported usage". On
//      the openai-completions path it is not: the measured run reported 1715 in / 72 out on its first
//      assistant message and 1807 in / 60 out on its second — the second message's OWN usage, not
//      1715+1807. Reading only the last one would have thrown away a turn. So this module sums the
//      PER-MESSAGE usage from each assistant `message_end` (the docs' own "final authoritative
//      message") and ignores `message_update` usage entirely. Summing `input` across turns counts the
//      re-sent prefix once per request, which is exactly the work the local server actually did.
//
//   4. COST IS NOT A NUMBER HERE. Pi reports `cost: {input: 0, output: 0, total: 0}` because the
//      models.json entry prices a local model at zero. That zero is a CONFIGURED CONSTANT, not a
//      measurement, so it is discarded: `costMicros` is null and the caller writes
//      `costSource: "none"`. Banking the 0 would let a lift-per-cent display divide by nothing.
//
// TOLERANT BY CONTRACT, exactly as the Claude parser is: framing before parsing, an over-long frame
// skipped whole and resynchronized at the next newline, an unknown event type ignored, a malformed
// line skipped, and an `onEvent` that throws swallowed here — a sink's failure never reaches the
// session.

import type { AgentEnvelope } from "@/lib/local/agent-envelope";
import { firstLine, repoPath } from "@/lib/local/agent-stream";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

/** Same cap the Claude runner uses for one stdout line (`MAX_STDOUT`). */
const DEFAULT_MAX_FRAME = 4 * 1024 * 1024;
const SUMMARY_MAX = 4_000;
const ERROR_MAX = 2_048;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** A finite non-negative integer, or null — the same honesty `agent-envelope.ts` applies. */
function countOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * ONE PI TOOL CALL → the lane's activity vocabulary.
 *
 * Pi's built-in tool set is `read` / `bash` / `edit` / `write` (lower-case, from the system prompt of
 * the measured run) and its file argument is `path`, not Claude's `file_path`. The tail's `tool` field
 * keeps Pi's own spelling rather than being translated into Claude's — a tail that said "Read" for a
 * Pi lane would make the bake-off's two arms indistinguishable in the one surface an operator watches.
 * Anything this map does not know is `tool`, by name, which is what an extension-registered tool is.
 */
export function piToolEvent(name: string, args: unknown, cwd?: string): AgentStreamEvent {
  const a = isObj(args) ? args : {};
  const tool = name.slice(0, 80);
  const file = a.path ?? a.file_path ?? a.filePath;
  switch (name) {
    case "read":
      return { kind: "read", path: repoPath(file, cwd), tool, note: null };
    case "edit":
      return { kind: "edit", path: repoPath(file, cwd), tool, note: null };
    case "write":
      return { kind: "write", path: repoPath(file, cwd), tool, note: null };
    case "bash":
      // The human line Pi's bash tool carries, never the command itself — same rule as the Claude tail.
      return { kind: "tool", path: null, tool, note: firstLine(a.description) };
    default:
      return { kind: "tool", path: null, tool, note: firstLine(a.description) };
  }
}

export interface PiParserOptions {
  /** The session's cwd. A tool path inside it becomes repo-relative with forward slashes. */
  cwd?: string;
  /** The largest frame (one stdout line) held or parsed. Default 4 MiB. */
  maxFrameChars?: number;
}

export interface PiEnvelopeOptions {
  /** The model the caller asked Pi for — the fallback when no message named one. */
  fallbackModel: string;
  /** The child's exit code, for the "nothing at all" message. */
  exitCode: number | null;
  /** Whatever the child wrote to stderr — the ONLY thing an unknown-provider failure produces. */
  stderr: string;
  /** Wall-clock milliseconds the caller measured. Pi reports no session duration of its own, so an
   *  absent value falls back to the span between the first and last message timestamps in the
   *  stream, which is a real measurement of the model's time but not of the process's. */
  durationMs?: number | null;
}

export interface PiParser {
  /** Feed a raw stdout chunk (may split or join lines arbitrarily). */
  push(chunk: string): void;
  /** Flush the trailing partial line. Call before `envelope`. */
  end(): void;
  /** The folded session, once `end()` has run. */
  envelope(opts: PiEnvelopeOptions): AgentEnvelope;
  /** Pi's own error words seen in the stream, bounded; null when none. */
  errorText(): string | null;
  /** True once one typed Pi event has parsed — i.e. this really was a Pi JSON stream. */
  sawStream(): boolean;
}

/** Everything the fold accumulates. Kept in one object so the parser is a closure over it. */
interface PiState {
  sessionId: string | null;
  model: string | null;
  turns: number;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  /** The text blocks of the most recent assistant `message_end` — the session's answer. */
  answer: string | null;
  /** The newest `errorMessage` / `finalError` seen anywhere in the stream. */
  error: string | null;
  /** Any assistant message ended with `stopReason: "error"`, or a retry chain gave up. */
  failed: boolean;
  /** An assistant message with text and no error — the only proof Pi actually answered. */
  answered: boolean;
  firstTs: number | null;
  lastTs: number | null;
  sawEvent: boolean;
}

/** Add one message's usage to a running total, keeping `null` for "never reported". */
function add(total: number | null, v: unknown): number | null {
  const n = countOf(v);
  if (n == null) return total;
  return (total ?? 0) + n;
}

/** The text of an assistant message's content blocks, joined. Thinking blocks are not the answer. */
function answerOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    if (isObj(b) && b.type === "text") {
      const t = strOf(b.text);
      if (t) parts.push(t);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

/**
 * The incremental parser. `normalizePiStream` below is the pure, whole-text door onto the same fold,
 * so the live path and the table test exercise one implementation.
 */
export function createPiParser(onEvent: (e: AgentStreamEvent) => void, opts: PiParserOptions = {}): PiParser {
  const cap = opts.maxFrameChars ?? DEFAULT_MAX_FRAME;
  let partial = "";
  let skipping = false;
  const s: PiState = {
    sessionId: null,
    model: null,
    turns: 0,
    input: null,
    output: null,
    cacheRead: null,
    answer: null,
    error: null,
    failed: false,
    answered: false,
    firstTs: null,
    lastTs: null,
    sawEvent: false,
  };

  const emit = (e: AgentStreamEvent): void => {
    try {
      onEvent(e);
    } catch {
      // The sink's problem, never the session's.
    }
  };

  const noteTs = (v: unknown): void => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : null;
    if (n == null) return;
    if (s.firstTs == null || n < s.firstTs) s.firstTs = n;
    if (s.lastTs == null || n > s.lastTs) s.lastTs = n;
  };

  /** One assistant `message_end`: the accounting, the answer and the failure flag all live here. */
  const assistantEnd = (msg: Obj): void => {
    s.model = strOf(msg.model) ?? s.model;
    noteTs(msg.timestamp);
    const u = isObj(msg.usage) ? msg.usage : null;
    if (u) {
      s.input = add(s.input, u.input ?? u.input_tokens);
      s.output = add(s.output, u.output ?? u.output_tokens);
      s.cacheRead = add(s.cacheRead, u.cacheRead ?? u.cache_read_input_tokens);
    }
    const err = strOf(msg.errorMessage);
    if (err) s.error = err;
    if (msg.stopReason === "error" || err) s.failed = true;
    const text = answerOf(msg.content);
    if (text) {
      s.answer = text;
      s.answered = true;
      const note = firstLine(text);
      if (note) emit({ kind: "text", path: null, tool: null, note });
    }
  };

  const frame = (line: string): void => {
    const t = line.trim();
    if (!t.startsWith("{")) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      return;
    }
    if (!isObj(parsed) || typeof parsed.type !== "string") return;
    const o = parsed;
    s.sawEvent = true;
    switch (o.type) {
      case "session":
        s.sessionId = strOf(o.id);
        return;
      case "turn_start":
        s.turns += 1;
        return;
      case "tool_execution_start":
        if (typeof o.toolName === "string") emit(piToolEvent(o.toolName, o.args, opts.cwd));
        return;
      case "tool_execution_end":
        // A failing tool is the agent's problem to recover from, not the session's outcome — Claude's
        // tail does not surface tool_result either. Only its error words are kept, for the case where
        // nothing else in the stream said anything.
        if (o.isError === true) s.error = firstLine(toolErrorOf(o.result), ERROR_MAX) ?? s.error;
        return;
      case "message_end": {
        const msg = isObj(o.message) ? o.message : null;
        if (msg?.role === "assistant") assistantEnd(msg);
        else if (msg) noteTs(msg.timestamp);
        return;
      }
      case "auto_retry_end":
        if (o.success === false) {
          s.failed = true;
          s.error = strOf(o.finalError) ?? s.error;
        }
        return;
      default:
        // agent_start / turn_end / message_start / message_update / agent_end / agent_settled /
        // auto_retry_start and anything a later Pi adds: nothing this fold needs.
        return;
    }
  };

  const take = (piece: string, terminated: boolean): void => {
    if (skipping) {
      if (terminated) skipping = false;
      return;
    }
    if (partial.length + piece.length > cap) {
      partial = "";
      skipping = !terminated;
      return;
    }
    const line = partial + piece;
    partial = "";
    if (terminated) frame(line);
    else partial = line;
  };

  return {
    push(chunk: string): void {
      if (!chunk) return;
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf("\n", start);
        if (nl === -1) {
          take(chunk.slice(start), false);
          return;
        }
        take(chunk.slice(start, nl), true);
        start = nl + 1;
      }
    },
    end(): void {
      if (!skipping && partial) frame(partial);
      partial = "";
      skipping = false;
    },
    errorText: () => (s.error ? s.error.trim().slice(0, ERROR_MAX) : null),
    sawStream: () => s.sawEvent,
    envelope(opts2: PiEnvelopeOptions): AgentEnvelope {
      const span = s.firstTs != null && s.lastTs != null && s.lastTs >= s.firstTs ? s.lastTs - s.firstTs : null;
      const measured = {
        model: s.model ?? strOf(opts2.fallbackModel),
        // NEVER a number. Pi's zeros are the price list in models.json, not a measurement.
        costMicros: null,
        inputTokens: s.input,
        outputTokens: s.output,
        cacheReadTokens: s.cacheRead,
        turns: s.turns > 0 ? s.turns : null,
        durationMs: countOf(opts2.durationMs) ?? span,
        sessionId: s.sessionId,
      };
      if (!s.sawEvent) {
        // The unknown-provider shape: exit 1, empty stdout, one sentence on stderr.
        const said = strOf(s.error) ?? strOf(opts2.stderr) ?? "(no output)";
        return {
          ...measured,
          ok: false,
          summary: `Pi exited (${opts2.exitCode}) without an event stream: ${said.trimStart().slice(0, 300)}`,
        };
      }
      if (s.failed || !s.answered) {
        const reason = strOf(s.error) ?? strOf(opts2.stderr) ?? strOf(s.answer) ?? "the session produced no answer";
        return { ...measured, ok: false, summary: `Pi error: ${reason.trimStart().slice(0, 500)}` };
      }
      return { ...measured, ok: true, summary: (s.answer ?? "").slice(0, SUMMARY_MAX) };
    },
  };
}

/** A failed tool result's words, from Pi's `{content: [{type: "text", text}]}` result shape. */
function toolErrorOf(result: unknown): string | null {
  if (!isObj(result)) return null;
  return answerOf(result.content);
}

/**
 * THE PURE DOOR: a whole captured stream in, the tail's events and the lane's envelope out. This is
 * what the table test drives, and it is the same fold the live parser runs — so a fixture that passes
 * here is a statement about the code the runner uses, not about a second copy of it.
 */
export function normalizePiStream(
  text: string,
  opts: PiParserOptions & PiEnvelopeOptions,
): { events: AgentStreamEvent[]; envelope: AgentEnvelope; errorText: string | null } {
  const events: AgentStreamEvent[] = [];
  const p = createPiParser((e) => events.push(e), opts);
  p.push(text);
  p.end();
  const envelope = p.envelope(opts);
  return { events, envelope, errorText: envelope.ok ? null : p.errorText() };
}
