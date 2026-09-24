// The BYOM test-connection probe for an OpenAI-compatible `/chat/completions` endpoint, shared by every
// API-key kind (OpenRouter, Nebius) so the settings card's green check means the same thing for each.
//
// WHY a schema-shaped call and not a bare "hi" ping: assess() depends on THREE things holding at once
// (the key authenticates, the model id resolves on this account, and the model honours
// `response_format: json_object`). A plain text ping proves only the first two. An endpoint happily
// accepts a request for a model that cannot do JSON mode and returns prose; that model then fails
// parseJsonLoose/validateAssessment on EVERY real scan and silently degrades the org to the mock floor,
// after a green check mark. So the probe sends a JSON-mode request and requires a parseable JSON OBJECT
// back, with a tiny prompt and a small max_tokens.
//
// DELIBERATELY json_object, not the strict json_schema assess() tries FIRST: strict support is optional
// (assess() falls back per model via isResponseFormatRejection), so json_object is the FLOOR capability
// every scannable model must hold.
//
// Returns { ok } on success, or { ok:false, error } with a bounded message. The caller owns the key and
// puts it only in `headers`; nothing here logs a header or echoes one back.

import { parseJsonLoose } from "@/lib/llm/json";
import { withLlmTimeout } from "@/lib/llm/config";

export interface JsonModeProbe {
  /** Full `/chat/completions` URL. */
  url: string;
  /** Request headers, the `authorization` bearer included. */
  headers: Record<string, string>;
  model: string;
  /** Vendor name for the error text ("OpenRouter", "Nebius"). */
  label: string;
}

/** Short fixed budget so the settings UI stays responsive. */
const PROBE_TIMEOUT_MS = 15_000;

export async function probeJsonModeConnection(p: JsonModeProbe): Promise<{ ok: boolean; error?: string }> {
  const { signal, clear } = withLlmTimeout(undefined, PROBE_TIMEOUT_MS, `${p.label} test timed out.`);
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...p.headers },
      body: JSON.stringify({
        model: p.model,
        temperature: 0,
        max_tokens: 64,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You reply with a single JSON object and nothing else." },
          { role: "user", content: 'Connection test. Reply with exactly {"ok":true}.' },
        ],
      }),
      signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${p.label} request failed (${res.status}): ${body.slice(0, 200)}`.slice(0, 300) };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return { ok: false, error: `Empty response from ${p.label}.` };
    // parseJsonLoose THROWS on prose with no JSON in it; that is the very model this probe exists to
    // catch, so it gets the actionable message rather than the parser's.
    let parsed: unknown = null;
    try {
      parsed = parseJsonLoose(text);
    } catch {
      parsed = null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Model "${p.model}" did not return a JSON object, so it can't produce the assessment format scans require.`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : `${p.label} connection failed.`).slice(0, 300) };
  } finally {
    clear();
  }
}
