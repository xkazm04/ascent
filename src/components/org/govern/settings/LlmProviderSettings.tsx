"use client";

// BYOM settings (Feature 1) — connect the org's own Amazon Bedrock so scans run in their AWS account.
// Owner-only surface. Credentials are WRITE-ONLY: the GET never returns the secret (we show "configured
// ••••" when one is stored), and inputs are cleared after save. Test-connection validates before going
// live (save → test → enable). Plan-gated (Enterprise) with an upsell; fail-closed when the deployment
// has no ENCRYPTION_KEY. Structural template: BrandingSettings.
//
// JSX only — state/effects/handlers live in useLlmProviderSettings.ts (extracted to keep this file
// under the 200-LOC cap; docs/ORG-TABS-REFACTOR.md).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import type { OrgLlmConfigPublic } from "@/lib/db";
import { DEFAULT_MODEL, useLlmProviderSettings } from "./useLlmProviderSettings";

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
  const f = useLlmProviderSettings(slug, initial);
  const disabledAll = !planAllowed || !encryptionConfigured;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Bring your own model (Bedrock)"
        description="Run scans on your org's own Amazon Bedrock — inference stays in your AWS account and region, billed to your AWS account. Custom plan."
      />

      {!planAllowed ? (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm text-slate-300">
          Connecting your own model is a <span className="text-accent">Custom</span> plan feature. Talk to us to enable BYOM for your org.
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
            value={f.modelId}
            onChange={(e) => f.setModelId(e.target.value)}
            disabled={disabledAll}
            placeholder={DEFAULT_MODEL}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="font-mono text-sm text-slate-500">Region</span>
          <input
            value={f.region}
            onChange={(e) => f.setRegion(e.target.value)}
            disabled={disabledAll}
            placeholder="us-east-1"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-sm text-slate-500">AWS Access Key ID</span>
            <input
              value={f.accessKeyId}
              onChange={(e) => f.setAccessKeyId(e.target.value)}
              disabled={disabledAll}
              autoComplete="off"
              placeholder={f.hasCreds ? "configured ••••" : "AKIA…"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="font-mono text-sm text-slate-500">AWS Secret Access Key</span>
            <input
              type="password"
              value={f.secretAccessKey}
              onChange={(e) => f.setSecretAccessKey(e.target.value)}
              disabled={disabledAll}
              autoComplete="off"
              placeholder={f.hasCreds ? "configured ••••" : "••••••••"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={f.enabled} onChange={(e) => f.setEnabled(e.target.checked)} disabled={disabledAll} className="accent-accent" />
          Use this provider for scans (replaces any other connected provider)
        </label>

        {f.blockedBySwitch && (
          <p className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-sm text-orange-200">
            This org currently runs on <span className="font-mono">{initial?.provider}</span>. Switching to Bedrock
            replaces it, so enter the AWS access key and secret above — saving without them would leave the previous
            provider&apos;s credential in place and break every scan.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={f.test}
            disabled={disabledAll || f.busy !== null}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-accent hover:text-white disabled:opacity-50"
          >
            {f.busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            onClick={f.save}
            disabled={disabledAll || f.busy !== null || !f.modelId.trim() || f.blockedBySwitch}
            className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
          >
            {f.busy === "save" ? "Saving…" : "Save"}
          </button>
          {f.hasCreds && (
            <button
              onClick={f.disable}
              disabled={disabledAll || f.busy !== null}
              className="ml-auto rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
            >
              {f.busy === "disable" ? "Disabling…" : "Disable & clear"}
            </button>
          )}
        </div>

        {f.lastValidatedAt && (
          <p className="text-sm text-slate-500">Last validated {f.lastValidatedAt.slice(0, 16).replace("T", " ")} UTC.</p>
        )}
        {f.msg && (
          <p role="status" className={`text-sm ${f.msg.kind === "ok" ? "text-emerald-300" : "text-orange-300"}`}>
            {f.msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}
