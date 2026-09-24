// Claude's schema-constrained run, the stream-json dialect. Claude has no FILE form for a schema:
// `--json-schema <schema>` takes the JSON text itself (the 2.1.281 binary JSON.parses the flag value,
// "Error: --json-schema is not valid JSON"), so a temp file cannot carry it and inlining it would
// put several KB of quotes and braces through the shell:true argv (cmd.exe caps a command line at
// 8191 chars). The CLI does accept the schema on STDIN: with `--input-format stream-json`, the
// `initialize` control request (the one the Agent SDK sends) carries `jsonSchema`, and the final
// `result` event returns the constrained answer as `structured_output`. Verified live 2026-09-24
// (claude 2.1.281, haiku): `{"answer":5}` came back structured, exit 0, nothing on stderr.
//
// The single-json (no-schema) path is untouched; this module is only the stdin payload and the
// result-event pick for runs that carry a schema.

import type { ClaudeCliEnvelope } from "@/lib/llm/transport/claude";

/** argv for a schema run: stream-json both ways (stream-json output requires --verbose under -p). */
export const CLAUDE_STREAM_ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];

/** Two JSONL lines for the child's stdin: initialize{jsonSchema}, then the prompt as a user turn.
 *  JSON.stringify escapes every newline, so each message is exactly one line. */
export function claudeSchemaStdin(prompt: string, schema: object): string {
  const init = { type: "control_request", request_id: "ascent-init", request: { subtype: "initialize", jsonSchema: schema } };
  const user = { type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null, session_id: "" };
  return `${JSON.stringify(init)}\n${JSON.stringify(user)}\n`;
}

export type ClaudeStreamResult = ClaudeCliEnvelope & { structured_output?: unknown };

/**
 * The raw text of the LAST `type: "result"` event in a stream-json capture: the same object the
 * single-json mode prints, so unwrapCliEnvelope reads both. Hook, init and assistant events before
 * it are skipped; a non-JSON line is noise. Returns undefined when the stream never produced one.
 */
export function claudeResultLine(raw: string): string | undefined {
  let last: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      if ((JSON.parse(trimmed) as { type?: unknown }).type === "result") last = trimmed;
    } catch {
      continue;
    }
  }
  return last;
}

/** The result envelope of either dialect: a single-json capture IS the envelope; a stream-json
 *  capture is reduced to its last result event. Consumers read `.usage` off this. */
export function claudeEnvelopeText(raw: string): string {
  return claudeResultLine(raw) ?? raw;
}
