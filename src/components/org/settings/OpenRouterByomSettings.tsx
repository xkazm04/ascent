"use client";

// OpenRouter BYOM — connect the org's own OpenRouter key so scans run on any model behind one key. Unlike
// the Bedrock card, this is a COST/FLEXIBILITY path, NOT the in-boundary privacy guarantee: OpenRouter
// routes the request (repo file samples included) to the selected model's third-party upstream. An org has
// ONE active connected provider, so saving here replaces a Bedrock config (and vice-versa). Owner-only,
// write-only key, Enterprise-plan gated, fail-closed without ENCRYPTION_KEY. See ModelScorecard for which
// model to pick. Structural template: LlmProviderSettings.

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import type { OrgLlmConfigPublic } from "@/lib/db";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const input =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50";

export function OpenRouterByomSettings({
  slug,
  initial,
  planAllowed,
  encryptionConfigured,
}: {
  slug: string;
  initial: OrgLlmConfigPublic | null;
  planAllowed: boolean;
  encryptionConfigured: boolean;
}) {
  const isActive = initial?.provider === "openrouter";
  const [modelId, setModelId] = useState(isActive ? (initial?.modelId ?? DEFAULT_MODEL) : DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(isActive ? (initial?.enabled ?? false) : false);
  const [hasKey, setHasKey] = useState(isActive ? (initial?.hasCredentials ?? false) : false);
  const [busy, setBusy] = useState<null | "save" | "test" | "disable">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lastValidatedAt, setLastValidatedAt] = useState(isActive ? (initial?.lastValidatedAt ?? null) : null);
  const disabledAll = !planAllowed || !encryptionConfigured;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch("/api/org/llm-provider", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          provider: "openrouter",
          modelId: modelId.trim(),
          enabled,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to save.");
      if (apiKey.trim()) setHasKey(true);
      setApiKey("");
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setBusy(null);
    }
  }

  // Validate BEFORE going live (save → test → enable), mirroring the Bedrock card. Without this the
  // first real scan was the test: a bad key or a model that can't do JSON mode surfaced only as a
  // silent degrade-to-mock, and lastValidatedAt stayed null forever for OpenRouter orgs.
  async function test() {
    setBusy("test");
    setMsg(null);
    try {
      const res = await fetch("/api/org/llm-provider/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          provider: "openrouter",
          modelId: modelId.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
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
      setHasKey(false);
      setLastValidatedAt(null);
      setMsg({ kind: "ok", text: "Disabled and cleared the key." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Bring your own model (OpenRouter)"
        description="Run scans on any model via your org's OpenRouter key — billed to your OpenRouter account. Note: OpenRouter routes to third-party upstreams, so this is NOT in-boundary like Bedrock. Enterprise plan."
      />

      {!planAllowed ? (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-slate-300">
          Connecting your own model is an <span className="text-accent">Enterprise</span> feature.
        </p>
      ) : !encryptionConfigured ? (
        <p className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm text-orange-200">
          Secret encryption isn&apos;t configured (no <code>ENCRYPTION_KEY</code>); the key can&apos;t be stored securely.
        </p>
      ) : null}

      <div className="mt-4 space-y-3" aria-disabled={disabledAll}>
        <label className="block">
          <span className="font-mono text-sm text-slate-500">Model slug</span>
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={disabledAll} placeholder={DEFAULT_MODEL} className={input} />
        </label>
        <label className="block">
          <span className="font-mono text-sm text-slate-500">OpenRouter API key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={disabledAll}
            autoComplete="off"
            placeholder={hasKey ? "configured ••••" : "sk-or-…"}
            className={input}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabledAll} className="accent-accent" />
          Use this provider for scans (replaces any other connected provider)
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={test}
            disabled={disabledAll || busy !== null || !modelId.trim()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={save}
            disabled={disabledAll || busy !== null || !modelId.trim()}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          {isActive && hasKey && (
            <button
              onClick={disable}
              disabled={disabledAll || busy !== null}
              className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
            >
              {busy === "disable" ? "Disabling…" : "Disable & clear"}
            </button>
          )}
        </div>

        {lastValidatedAt && (
          <p className="text-sm text-slate-500">Last validated {lastValidatedAt.slice(0, 16).replace("T", " ")} UTC.</p>
        )}
        {msg && (
          <p role="status" className={`text-sm ${msg.kind === "ok" ? "text-emerald-300" : "text-orange-300"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}
