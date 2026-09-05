// The /api/org/llm-provider calls behind the OpenRouter BYOM card — save, the pre-flight connection
// test, and disable-and-clear. Split out of OpenRouterByomSettings.tsx for the 200-LOC src/features
// cap: no JSX and no state here, so the card keeps every setState and these stay plain awaitable
// calls. Callers pass already-trimmed values; an empty `apiKey` means "leave the stored key alone"
// (the key is write-only, so a blank field must never clear it).

export async function saveOpenRouterConfig(slug: string, modelId: string, enabled: boolean, apiKey: string) {
  const res = await fetch("/api/org/llm-provider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      org: slug,
      provider: "openrouter",
      modelId,
      enabled,
      ...(apiKey ? { apiKey } : {}),
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
}

export async function testOpenRouterConfig(
  slug: string,
  modelId: string,
  apiKey: string,
): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/org/llm-provider/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      org: slug,
      provider: "openrouter",
      modelId,
      ...(apiKey ? { apiKey } : {}),
    }),
  });
  return await res.json().catch(() => ({}));
}

/** DELETE is provider-agnostic: it drops whichever provider the org has connected. */
export async function disableLlmProvider(slug: string) {
  const res = await fetch("/api/org/llm-provider", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed.");
}
