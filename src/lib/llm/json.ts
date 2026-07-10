// Tolerant JSON extraction for LLM output. Every provider (Gemini, Bedrock, claude-cli)
// funnels its reply through this one function, so a parsing miss silently downgrades a paid
// LLM scan to the deterministic mock floor. Real models wrap JSON in prose, markdown
// fences, a top-level array, two blocks, or trailing commentary that itself contains braces.
//
// Strategy:
//   1. direct parse (fast path for clean replies)
//   2. parse the first ```fenced``` block, if any
//   3. balanced-brace/bracket scan that finds the first COMPLETE `{...}` or `[...]` value,
//      correctly ignoring braces inside strings (so prose like "{score} is 0-100" or an
//      embedded brace in a string value never derails extraction)
// On total failure it throws a typed ProviderParseError carrying a truncated raw snippet,
// so callers can log a diagnosable reason instead of an opaque throw.

/** Thrown when no JSON value can be extracted from a model reply. Carries a short snippet. */
export class ProviderParseError extends Error {
  readonly snippet: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "ProviderParseError";
    this.snippet = raw.slice(0, 300);
  }
}

// The balanced recovery below is O(starts × N): each failed start re-scans toward end-of-string.
// A truncated/adversarial reply full of unclosed "{" (no valid JSON) would otherwise pin the
// single-threaded event loop for the whole reply — and a SYNCHRONOUS loop can't be interrupted by
// the per-request AbortSignal. Bound both dimensions: skip recovery above MAX_RECOVERY_BYTES (a
// clean reply of any size still parses on the O(N) fast path — only the scan is gated), and cap the
// number of structural starts tried (a real model puts its JSON within the first few structural
// chars; thousands of failed starts means there is no JSON value to find).
const MAX_RECOVERY_BYTES = 256 * 1024;
const MAX_START_ATTEMPTS = 512;

/**
 * Scan from `start` for one balanced JSON value beginning with `{` or `[`, respecting string
 * literals and escapes. Returns the matched substring, or null if no balanced value is found.
 */
function extractBalanced(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced — truncated output
}

/** Find the first index at/after `from` of either `{` or `[`, whichever comes first. */
function firstStructuralIndex(text: string, from = 0): number {
  const a = text.indexOf("{", from);
  const b = text.indexOf("[", from);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

export function parseJsonLoose<T>(text: string): T {
  if (typeof text !== "string" || text.trim() === "") {
    throw new ProviderParseError("Empty model output", String(text ?? ""));
  }

  // 1. Fast path: the whole reply is clean JSON.
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    /* fall through */
  }

  // Bound the recovery scans below (fence + balanced) so an oversized unparseable reply can't stall
  // the event loop. The clean fast path above already handled any size in O(N).
  if (text.length > MAX_RECOVERY_BYTES) {
    throw new ProviderParseError(`Model output too large to recover (${text.length} bytes)`, text);
  }

  // 2. Markdown code fences anywhere in the text (```json … ``` or ``` … ```). Try each
  //    fenced block in order — the first that parses (directly or via balanced scan) wins.
  const fenceRe = /```(?:json|jsonc)?\s*([\s\S]*?)```/gi;
  for (let m = fenceRe.exec(text); m; m = fenceRe.exec(text)) {
    const inner = (m[1] ?? "").trim();
    if (!inner) continue;
    try {
      return JSON.parse(inner) as T;
    } catch {
      const bal = balancedParse<T>(inner);
      if (bal.ok) return bal.value;
    }
  }

  // JSONC tolerance. The `jsonc` fence tag (fenceRe) advertises tolerance the strict parses don't
  // deliver, and real models leak two common artifacts into a PLAIN fence too: a trailing comma before
  // a closing }/] (a token-boundary hiccup) and //-or-/* */ comments. Every strict JSON.parse above
  // rejects both, so one trailing comma threw the whole paid assessment away for the deterministic mock
  // floor. stripJsonc removes comments + trailing commas OUTSIDE string literals (escape-aware; string
  // contents stay byte-exact). Computed once; only work when it actually changed something.
  const cleaned = stripJsonc(text);

  // 3. Cleaned DIRECT parse — BEFORE the balanced scan on purpose. A single well-formed object marred
  //    only by a trailing comma/comment must parse AS A WHOLE: once the real object fails strict
  //    parsing, the balanced scan below can mis-recover an empty `{}` from a brace that lives inside a
  //    string value. Parsing the cleaned whole first avoids that.
  if (cleaned !== text) {
    try {
      return JSON.parse(cleaned.trim()) as T;
    } catch {
      /* not a single clean value — fall through to the balanced scans */
    }
  }

  // 4. Balanced scan over the whole text: walk every `{`/`[` start until one yields a
  //    complete, parseable value. This skips leading prose whose braces aren't valid JSON
  //    and handles a top-level array or a JSON object followed by trailing junk.
  const bal = balancedParse<T>(text);
  if (bal.ok) return bal.value;

  // 5. Balanced scan over the cleaned text — the JSONC recovery for a value WRAPPED in prose (or a
  //    comment containing a brace: stripping comments first means such a brace can no longer derail
  //    extraction). Only when cleaning changed something and every strict path already failed.
  if (cleaned !== text) {
    const balc = balancedParse<T>(cleaned);
    if (balc.ok) return balc.value;
  }

  throw new ProviderParseError("No JSON value found in model output", text);
}

/**
 * JSONC → JSON normalization for the recovery path only. Removes `//` line comments, `/* … *​/` block
 * comments, and trailing commas (a `,` immediately before a closing `}`/`]`, possibly across whitespace
 * or a stripped comment) — the JSONC artifacts strict JSON.parse rejects. A single forward pass that is
 * STRING-AWARE (respecting `\` escapes) so a `//`, `,`, or brace INSIDE a string value is preserved
 * byte-exact — only structure outside strings is touched. Trailing commas are handled by deferring each
 * comma (`pendingComma`) and dropping it if the next significant token is a closer. Comments are skipped
 * wholesale; a line comment preserves its terminating newline as whitespace.
 */
function stripJsonc(text: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  let pendingComma = false; // a ',' seen outside a string, not yet emitted (may be trailing)
  const flushComma = () => {
    if (pendingComma) {
      out += ",";
      pendingComma = false;
    }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      // Line comment: skip through (but not including) the newline, which the loop then emits as ws.
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      i--; // let the for-loop's i++ land back on the newline
      continue;
    }
    if (ch === "/" && next === "*") {
      // Block comment: skip through the closing '*''/'.
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 1; // consume the '*'; the for-loop's i++ consumes the '/'
      continue;
    }
    if (ch === ",") {
      flushComma(); // a prior deferred comma was a real separator (e.g. ",,")
      pendingComma = true;
      continue;
    }
    if (ch === "}" || ch === "]") {
      pendingComma = false; // drop a trailing comma before this closer
      out += ch;
      continue;
    }
    if (ch === '"') {
      flushComma();
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      // Whitespace stays but does NOT resolve a pending comma (a `,\n}` is still a trailing comma).
      out += ch;
      continue;
    }
    // Any other significant char: the pending comma was a real separator.
    flushComma();
    out += ch;
  }
  flushComma(); // a comma at the very end (malformed either way) — emit so JSON.parse still reports it
  return out;
}

/** Try every structural start index, returning the first that parses to a value. */
function balancedParse<T>(text: string): { ok: true; value: T } | { ok: false } {
  let idx = firstStructuralIndex(text, 0);
  let attempts = 0;
  while (idx >= 0 && attempts < MAX_START_ATTEMPTS) {
    attempts++;
    const candidate = extractBalanced(text, idx);
    if (candidate) {
      try {
        return { ok: true, value: JSON.parse(candidate) as T };
      } catch {
        /* this start didn't yield valid JSON — advance to the next structural char */
      }
    }
    idx = firstStructuralIndex(text, idx + 1);
  }
  return { ok: false };
}
