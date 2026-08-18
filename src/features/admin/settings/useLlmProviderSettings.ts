"use client";

// State/effects/handlers for the Bedrock BYOM settings card, extracted from LlmProviderSettings.tsx
// to keep the component under the 200-LOC cap (AGENTS.md / docs/ORG-TABS-REFACTOR.md). Owns no JSX.

import { useState } from "react";
import type { OrgLlmConfigPublic } from "@/lib/db";

export const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";

export function useLlmProviderSettings(slug: string, initial: OrgLlmConfigPublic | null) {
  // An org has ONE active connected provider, and `initial` is that shared config object — so it
  // describes THIS card only when the active provider is bedrock. Reading it unconditionally (the old
  // behavior, and the reason the sibling OpenRouterByomSettings guards on `provider === "openrouter"`)
  // pre-filled an OpenRouter org's Bedrock card with the OpenRouter model slug, a pre-checked "use this
  // provider", and "configured ••••" AWS fields — none of which are this provider's state.
  const isActive = initial?.provider === "bedrock";
  const [modelId, setModelId] = useState(isActive ? (initial?.modelId ?? DEFAULT_MODEL) : DEFAULT_MODEL);
  const [region, setRegion] = useState(isActive ? (initial?.region ?? "us-east-1") : "us-east-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [enabled, setEnabled] = useState(isActive ? (initial?.enabled ?? false) : false);
  const [hasCreds, setHasCreds] = useState(isActive ? (initial?.hasCredentials ?? false) : false);
  const [busy, setBusy] = useState<null | "save" | "test" | "disable">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lastValidatedAt, setLastValidatedAt] = useState(isActive ? (initial?.lastValidatedAt ?? null) : null);

  // Saving here TAKES OVER the org's single provider slot. The stored credential blob is only replaced
  // when a new one is supplied, so switching from another provider without entering AWS keys would
  // leave that provider's secret behind under provider "bedrock" — the Bedrock credential resolver then
  // returns null and the fail-closed guard aborts EVERY scan with a misleading ENCRYPTION_KEY message.
  // Require the keys for a cross-provider switch so the takeover always carries its own credential.
  const switchingProvider = Boolean(initial && initial.provider !== "bedrock");
  const credsEntered = accessKeyId.trim() !== "" && secretAccessKey.trim() !== "";
  const blockedBySwitch = switchingProvider && !credsEntered;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch("/api/org/llm-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          // Explicit, not the route's default — this card owns exactly one provider, and an implicit
          // default is what made a mis-filled save land as "bedrock" by accident.
          provider: "bedrock",
          modelId: modelId.trim(),
          region: region.trim() || undefined,
          enabled,
          ...(accessKeyId.trim() && secretAccessKey.trim()
            ? { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() }
            : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
      if (accessKeyId.trim() && secretAccessKey.trim()) setHasCreds(true);
      setAccessKeyId("");
      setSecretAccessKey("");
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const res = await fetch("/api/org/llm-provider/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          modelId: modelId.trim(),
          region: region.trim() || undefined,
          ...(accessKeyId.trim() && secretAccessKey.trim()
            ? { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setLastValidatedAt(new Date().toISOString());
        setMsg({ kind: "ok", text: "Connection succeeded." });
      } else {
        setMsg({ kind: "err", text: data.error ?? "Connection failed." });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Connection failed." });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("disable");
    setMsg(null);
    try {
      const res = await fetch("/api/org/llm-provider", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed.");
      setEnabled(false);
      setHasCreds(false);
      setLastValidatedAt(null);
      setMsg({ kind: "ok", text: "Disabled and cleared credentials." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
    } finally {
      setBusy(null);
    }
  }

  return {
    modelId,
    setModelId,
    region,
    setRegion,
    accessKeyId,
    setAccessKeyId,
    secretAccessKey,
    setSecretAccessKey,
    enabled,
    setEnabled,
    hasCreds,
    busy,
    msg,
    lastValidatedAt,
    blockedBySwitch,
    save,
    test,
    disable,
  };
}
