// WHAT OF THE AGENT'S STDERR MAY BE PERSISTED — pure, so the rule is a table test.
//
// A failed session's stderr reaches three stored texts: the lane's failure summary (the lane log line),
// the envelope's "no JSON" sentence, and `AgentRunResult.errorText`. The live check for spark
// theater-upgrade (2026-09-18) found stderr carrying a failing user `SessionEnd` HOOK's full command
// line — including a local token — which would have been written onto a lane row and shown on a
// screen. The harness echoes a failing hook's command verbatim, so a hook line is dropped whole, and
// anything that still looks like a credential is redacted (`audit-logging/write-path-sanitization`:
// the free-form field is sanitized on the way in, not trusted on the way out).
//
// This removes the class the check found and the obvious shapes around it. It is NOT a secret scanner:
// an unmarked credential of an unusual shape can still pass, which is why stderr stays the LAST fallback
// behind the CLI's own result text, error list and stream hint.

/** Lines the harness prints about hooks carry the hook's command line. */
const HOOK_LINE = /\bhooks?\b/i;
/** `token=…`, `api_key: …`, `Authorization: Bearer …`, `password=…` — the value goes. */
const KEYED_SECRET =
  /\b(authorization|bearer|token|access[_-]?token|api[_-]?key|apikey|secret|password|passwd|pwd|client[_-]?secret)\b(\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi;
/** A long opaque run (hex, base64, base64url) — the shape of a key or token with no label. */
const OPAQUE_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;

export function sanitizeAgentStderr(stderr: string): string {
  if (!stderr) return "";
  return stderr
    .split(/\r?\n/)
    .filter((line) => !HOOK_LINE.test(line))
    .map((line) => line.replace(KEYED_SECRET, (_m, key: string, sep: string) => `${key}${sep}[redacted]`).replace(OPAQUE_RUN, "[redacted]"))
    .join("\n")
    .trim();
}
