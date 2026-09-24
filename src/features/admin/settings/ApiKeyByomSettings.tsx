"use client";

// The BYOM card for every API-key kind (OpenRouter, Nebius): model id + one write-only key, the
// save → test → enable flow, and disable-and-clear. One card, specialised by a spec, so a new API-key
// kind is a spec and a caution rather than a copied form (the kinds themselves are listed once in
// src/lib/llm/byom-kinds.ts). An org has ONE active connected provider, so saving here replaces any
// other; switching kinds needs the new kind's key (setOrgLlmConfig refuses to carry the previous
// vendor's key across). Owner-only (SettingsTab gates it), plan gated, fail-closed without
// ENCRYPTION_KEY. Structural template: LlmProviderSettings (the Bedrock card).

import { useState, type ReactNode } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { disableLlmProvider, saveApiKeyByomConfig, testApiKeyByomConfig } from "./apiKeyByomApi";
import type { OrgLlmConfigPublic } from "@/lib/db";
import type { ApiKeyByomKind } from "@/lib/llm/byom-kinds";

export interface ApiKeyByomSpec {
  kind: ApiKeyByomKind;
  title: string;
  description: string;
  modelLabel: string;
  /** Pre-filled model id; "" when the vendor has no id that is safe to guess (Nebius). */
  defaultModel: string;
  modelPlaceholder: string;
  keyLabel: string;
  keyPlaceholder: string;
}

export interface ApiKeyByomProps {
  slug: string;
  initial: OrgLlmConfigPublic | null;
  planAllowed: boolean;
  encryptionConfigured: boolean;
}

const input =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50";

export function ApiKeyByomSettings({
  spec,
  caution,
  slug,
  initial,
  planAllowed,
  encryptionConfigured,
}: ApiKeyByomProps & { spec: ApiKeyByomSpec; caution: ReactNode }) {
  // `initial` is the org's ONE provider slot: it describes this card only when this kind holds it.
  const isActive = initial?.provider === spec.kind;
  const [modelId, setModelId] = useState(isActive ? (initial?.modelId ?? spec.defaultModel) : spec.defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(isActive ? (initial?.enabled ?? false) : false);
  const [hasKey, setHasKey] = useState(isActive ? (initial?.hasCredentials ?? false) : false);
  const [busy, setBusy] = useState<null | "save" | "test" | "disable">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lastValidatedAt, setLastValidatedAt] = useState(isActive ? (initial?.lastValidatedAt ?? null) : null);
  const disabledAll = !planAllowed || !encryptionConfigured;

  async function run(action: "save" | "test" | "disable", fn: () => Promise<string>, fallback: string) {
    setBusy(action);
    setMsg(null);
    try {
      setMsg({ kind: "ok", text: await fn() });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : fallback });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      await saveApiKeyByomConfig(spec.kind, slug, modelId.trim(), enabled, apiKey.trim());
      if (apiKey.trim()) setHasKey(true);
      setApiKey("");
      return "Saved.";
    }, "Failed to save.");

  // Validate BEFORE going live (save → test → enable): otherwise the first real scan is the test, and a
  // bad key or a model that can't do JSON mode surfaces only as a silent degrade-to-mock.
  const test = () =>
    run("test", async () => {
      const data = await testApiKeyByomConfig(spec.kind, slug, modelId.trim(), apiKey.trim());
      if (!data.ok) throw new Error(data.error ?? "Connection failed.");
      setLastValidatedAt(new Date().toISOString());
      return "Connection succeeded.";
    }, "Connection failed.");

  const disable = () =>
    run("disable", async () => {
      await disableLlmProvider(slug);
      setEnabled(false);
      setHasKey(false);
      setLastValidatedAt(null);
      return "Disabled and cleared the key.";
    }, "Failed.");

  return (
    <Card>
      <SectionHeader size="sm" title={spec.title} description={spec.description} />

      {!planAllowed ? (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3 type-body-sm text-slate-300">
          Connecting your own model is a <span className="text-accent">Custom</span> plan feature.
        </p>
      ) : !encryptionConfigured ? (
        <p className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 type-body-sm text-orange-200">
          Secret encryption isn&apos;t configured (no <code>ENCRYPTION_KEY</code>); the key can&apos;t be stored securely.
        </p>
      ) : null}

      <div className="mt-4 space-y-3" aria-disabled={disabledAll}>
        {/* The boundary caution sits ON the form, above the key field, where the decision is made. */}
        {caution}
        <label className="block">
          <span className="type-mono-sm text-slate-500">{spec.modelLabel}</span>
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={disabledAll} placeholder={spec.modelPlaceholder} className={input} />
        </label>
        <label className="block">
          <span className="type-mono-sm text-slate-500">{spec.keyLabel}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={disabledAll}
            autoComplete="off"
            placeholder={hasKey ? "configured ••••" : spec.keyPlaceholder}
            className={input}
          />
        </label>
        <label className="flex items-center gap-2 type-body-sm text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabledAll} className="accent-accent" />
          Use this provider for scans (replaces any other connected provider)
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1" aria-busy={busy !== null}>
          <button
            onClick={test}
            disabled={disabledAll || busy !== null || !modelId.trim()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={save}
            disabled={disabledAll || busy !== null || !modelId.trim()}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          {isActive && hasKey && (
            <button
              onClick={disable}
              disabled={disabledAll || busy !== null}
              className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-400 hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
            >
              {busy === "disable" ? "Disabling…" : "Disable & clear"}
            </button>
          )}
        </div>

        {lastValidatedAt && (
          <p className="type-body-sm text-slate-500">Last validated {lastValidatedAt.slice(0, 16).replace("T", " ")} UTC.</p>
        )}
        {/* ONE persistent polite live region (always rendered, content swapped): a region mounted only
            once there is something to say is never read. Errors carry a textual "Error:" prefix so the
            kind isn't conveyed by color alone (WCAG 1.4.1). */}
        <p
          role="status"
          aria-live="polite"
          className={`type-body-sm ${msg?.kind === "err" ? "text-orange-300" : "text-emerald-300"}`}
        >
          {msg ? (msg.kind === "err" ? `Error: ${msg.text}` : msg.text) : ""}
        </p>
      </div>
    </Card>
  );
}
