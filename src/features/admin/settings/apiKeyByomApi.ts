// The /api/org/llm-provider calls behind the API-key BYOM cards (OpenRouter, Nebius): save, the
// pre-flight connection test, and disable-and-clear. No JSX and no state here, so the card keeps every
// setState and these stay plain awaitable calls. Callers pass already-trimmed values; an empty `apiKey`
// means "leave the stored key alone" (the key is write-only, so a blank field must never clear it).
// `kind` is always sent explicitly: the route's default is Bedrock, and an implicit default is what
// once made a mis-filled save land on the wrong provider.

import type { ApiKeyByomKind } from "@/lib/llm/byom-kinds";

export async function saveApiKeyByomConfig(
  kind: ApiKeyByomKind,
  slug: string,
  modelId: string,
  enabled: boolean,
  apiKey: string,
) {
  const res = await fetch("/api/org/llm-provider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, provider: kind, modelId, enabled, ...(apiKey ? { apiKey } : {}) }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
}

export async function testApiKeyByomConfig(
  kind: ApiKeyByomKind,
  slug: string,
  modelId: string,
  apiKey: string,
): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch("/api/org/llm-provider/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ org: slug, provider: kind, modelId, ...(apiKey ? { apiKey } : {}) }),
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
