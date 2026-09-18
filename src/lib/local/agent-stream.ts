// THE AGENT'S STREAM, parsed as it arrives (spark theater-upgrade, 2026-09-18; WP4).
//
// `claude -p --output-format stream-json --verbose` emits one JSON object per line: system events (init,
// hook traces), `rate_limit_event`s, assistant messages carrying ONE content block each (`thinking`,
// `text`, or a `tool_use` naming Read / Grep / Glob / Edit / Write … with its input), user messages
// carrying the `tool_result`s, and a final `result` object with the SAME fields the one-shot `json`
// envelope has. Verified against CLI 2.1.276 on 2026-09-18 — `__fixtures__/claude-stream-2.1.276.jsonl`
// is that session, trimmed. This module turns the lines into `AgentStreamEvent`s for the lane's activity
// sink, and hands the final `result` line back so `parseAgentEnvelope` reads exactly what it read before.
//
// TOLERANT BY CONTRACT (`streaming-output/stream-parsing`):
//   • FRAMING BEFORE PARSING. Chunks are cut into lines first; the unterminated tail is carried, never
//     parsed early. A frame longer than the cap is SKIPPED WHOLE (routed, not clipped — a clipped frame
//     is malformed input the framer manufactured) and the framer resynchronizes at the next newline.
//   • An unknown event type is ignored, a malformed line is skipped, and an `onEvent` that throws is
//     swallowed here — a sink's failure never reaches the session.
//   • OUTPUT THAT NEVER LOOKED LIKE A STREAM (an older CLI's one-shot `json`, a pretty-printed object, a
//     test double, `command not found`) is kept verbatim up to the cap and returned by `raw()`, so the
//     caller parses it exactly as before. The moment one typed stream line parses, that copy is dropped:
//     from then on only the `result` line is retained, so memory is bounded by the cap, not the session.

import { MICROS_PER_USD } from "@/lib/local/agent-envelope";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

export interface StreamParser {
  /** Feed a raw stdout chunk (may split or join lines arbitrarily). */
  push(chunk: string): void;
  /** Flush the trailing partial line and return the final `result` object's raw JSON text, or null. */
  end(): string | null;
  /** The stdout verbatim (bounded) while it has NOT proved to be a stream; "" once it has. The
   *  fallback a caller parses when `end()` is null, so a non-stream output reads exactly as before. */
  raw(): string;
  /** The CLI's own error words seen before the end — a synthetic or `error`-flagged assistant message
   *  (how the session-limit sentence arrives). Bounded; null when none was seen. */
  errorHint(): string | null;
}

export interface StreamParserOptions {
  /** The session's cwd. A tool path inside it becomes repo-relative with forward slashes. */
  cwd?: string;
  /** The largest frame (one stdout line) held or parsed, and the cap on the non-stream copy. Default
   *  4 MiB — the runner's `MAX_STDOUT`, so the cap semantics are the ones the one-shot read had. */
  maxFrameChars?: number;
}

const DEFAULT_MAX_FRAME = 4 * 1024 * 1024;
const NOTE_MAX = 160;
const PATH_MAX = 300;
const HINT_MAX = 2_048;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The first non-empty line, trimmed and bounded — the one human line a tail entry carries. */
export function firstLine(text: unknown, max = NOTE_MAX): string | null {
  if (typeof text !== "string") return null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t.slice(0, max);
  }
  return null;
}

/** A tool path as the tail records it: repo-relative with forward slashes when it sits inside `cwd`
 *  (case-insensitively on a drive-letter path), else as given with forward slashes. The cwd itself is
 *  null — "the whole repo" is not a path. */
export function repoPath(p: unknown, cwd?: string): string | null {
  const given = strOf(p);
  if (!given) return null;
  let s = given.trim().replace(/\\/g, "/");
  if (cwd) {
    const base = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const fold = /^[A-Za-z]:\//.test(base);
    const a = fold ? s.toLowerCase() : s;
    const b = fold ? base.toLowerCase() : base;
    if (a === b) return null;
    if (b && a.startsWith(`${b}/`)) s = s.slice(base.length + 1);
  }
  while (s.startsWith("./")) s = s.slice(2);
  return s ? s.slice(0, PATH_MAX) : null;
}

const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);

/** One `tool_use` block → the tail's vocabulary. Any tool this map does not know is `tool`, by name. */
export function toolEvent(name: string, input: unknown, cwd?: string): AgentStreamEvent {
  const inp = isObj(input) ? input : {};
  const tool = name.slice(0, 80);
  const file = inp.file_path ?? inp.notebook_path;
  if (READ_TOOLS.has(name)) return { kind: "read", path: repoPath(file, cwd), tool, note: null };
  if (SEARCH_TOOLS.has(name)) return { kind: "search", path: repoPath(inp.path, cwd), tool, note: firstLine(inp.pattern) };
  if (EDIT_TOOLS.has(name)) return { kind: "edit", path: repoPath(file, cwd), tool, note: null };
  if (name === "Write") return { kind: "write", path: repoPath(file, cwd), tool, note: null };
  // `description` is the human line Bash / Task carry ("Run the unit tests"); never the command itself.
  return { kind: "tool", path: null, tool, note: firstLine(inp.description) };
}

/** A finite non-negative integer, or null — the same honesty the envelope applies. */
function countOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function createStreamParser(onEvent: (e: AgentStreamEvent) => void, opts: StreamParserOptions = {}): StreamParser {
  const cap = opts.maxFrameChars ?? DEFAULT_MAX_FRAME;
  let partial = "";
  /** The current frame outgrew the cap: drop everything up to the next newline. */
  let skipping = false;
  let isStream = false;
  let raw = "";
  let result: string | null = null;
  let hint: string | null = null;

  const emit = (e: AgentStreamEvent): void => {
    try {
      onEvent(e);
    } catch {
      // The sink's problem, never the session's.
    }
  };

  const assistant = (o: Obj): void => {
    const msg = isObj(o.message) ? o.message : null;
    const blocks = msg && Array.isArray(msg.content) ? msg.content : [];
    // The CLI injects its own failures (usage limit, API error) as an assistant message on a synthetic
    // model, newer builds also flag `error`. Their text is the CLI talking, not the agent.
    const cliSays = msg?.model === "<synthetic>" || strOf(o.error) != null;
    for (const b of blocks) {
      if (!isObj(b)) continue;
      if (b.type === "tool_use" && typeof b.name === "string") emit(toolEvent(b.name, b.input, opts.cwd));
      else if (b.type === "text") {
        const note = firstLine(b.text);
        if (!note) continue;
        if (cliSays) hint = String(b.text).trim().slice(0, HINT_MAX);
        emit({ kind: "text", path: null, tool: null, note });
      }
      // `thinking` blocks carry no display text (the CLI redacts them) and are ignored, like any
      // other block shape this map does not know.
    }
  };

  const frame = (line: string): void => {
    const t = line.trim();
    if (!t.startsWith("{")) return;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      return;
    }
    if (!isObj(o) || typeof o.type !== "string") return;
    if (o.type === "result") {
      result = t;
      const usd = typeof o.total_cost_usd === "number" && Number.isFinite(o.total_cost_usd) ? o.total_cost_usd : null;
      emit({
        kind: "result",
        path: null,
        tool: null,
        note: o.is_error === true ? (firstLine(o.result) ?? strOf(o.subtype)) : null,
        turns: countOf(o.num_turns),
        costMicros: usd == null ? null : Math.round(usd * MICROS_PER_USD),
      });
      return;
    }
    // Any OTHER typed line proves this is a stream: the verbatim copy is no longer needed.
    isStream = true;
    raw = "";
    if (o.type === "assistant") assistant(o);
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
      if (!isStream && raw.length < cap) raw += chunk.slice(0, cap - raw.length);
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
    end(): string | null {
      if (!skipping && partial) frame(partial);
      partial = "";
      skipping = false;
      return result;
    },
    raw: () => (isStream ? "" : raw),
    errorHint: () => hint,
  };
}
