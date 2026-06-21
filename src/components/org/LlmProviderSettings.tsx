"use client";

// BYOM settings (Feature 1) — connect the org's own Amazon Bedrock so scans run in their AWS account.
// Owner-only surface. Credentials are WRITE-ONLY: the GET never returns the secret (we show "configured
// ••••" when one is stored), and inputs are cleared after save. Test-connection validates before going
// live (save → test → enable). Plan-gated (Enterprise) with an upsell; fail-closed when the deployment
// has no ENCRYPTION_KEY. Structural template: BrandingSettings.

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/ui";
import type { OrgLlmConfigPublic } from "@/lib/db";

const DEFAULT_MODEL = "us.anthropic.claude-sonnet-4-6";

export function LlmProviderSettings({
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
  const [modelId, setModelId] = useState(initial?.modelId ?? DEFAULT_MODEL);
  const [region, setRegion] = useState(initial?.region ?? "us-east-1");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [hasCreds, setHasCreds] = useState(initial?.hasCredentials ?? false);
  const [busy, setBusy] = useState<null | "save" | "test" | "disable">(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lastValidatedAt, setLastValidatedAt] = useState(initial?.lastValidatedAt ?? null);

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

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Bring your own model (Bedrock)"
        description="Run scans on your org's own Amazon Bedrock — inference stays in your AWS account and region, billed to your AWS account. Enterprise plan."
      />

      {!planAllowed ? (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-slate-300">
          Connecting your own model is an <span className="text-accent">Enterprise</span> feature. Talk to us to enable BYOM for your org.
        </p>
      ) : !encryptionConfigured ? (
        <p className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm text-orange-200">
          Secret encryption isn&apos;t configured on this deployment (no <code>ENCRYPTION_KEY</code>), so credentials can&apos;t be stored securely. BYOM is unavailable until an operator sets it.
        </p>
      ) : null}

      <div className="mt-4 space-y-3" aria-disabled={disabledAll}>
        <label className="block">
          <span className="font-mono text-sm text-slate-500">Model ID</span>
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={disabledAll}
            placeholder={DEFAULT_MODEL}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="font-mono text-sm text-slate-500">Region</span>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={disabledAll}
            placeholder="us-east-1"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-sm text-slate-500">AWS Access Key ID</span>
            <input
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              disabled={disabledAll}
              autoComplete="off"
              placeholder={hasCreds ? "configured ••••" : "AKIA…"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="font-mono text-sm text-slate-500">AWS Secret Access Key</span>
            <input
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              disabled={disabledAll}
              autoComplete="off"
              placeholder={hasCreds ? "configured ••••" : "••••••••"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabledAll} className="accent-accent" />
          Use this provider for scans (enable)
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={test}
            disabled={disabledAll || busy !== null}
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
          {hasCreds && (
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
