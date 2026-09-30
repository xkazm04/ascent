"use client";

// Copilot admin pull. No key to paste. The panel says, before the sync, that this connector reports no cost.
import { useState } from "react";
import { Input, MonoPath, PrimaryAction, SettingRow } from "@/components/kit";
import { PROVIDERS } from "@/lib/integrations/providers";
import { CapabilityNotes } from "./CapabilityNotes.v2";
import { ConnectNotice, StatusSentence } from "./ConnectNotice";
import { CopyControl } from "./CopyControl";
import type { IngestWire } from "./integrationModel";
import { providerStatusLine } from "./providerStatusLine";
import { QuietField } from "./QuietField";

interface SyncOk {
  synced?: boolean;
  days?: number;
  seats?: number;
  engagedPeak?: number;
  stored?: number;
  note?: string;
  error?: string;
}

function remedyFor(status: number): string | null {
  switch (status) {
    case 403:
      return "Grant the Ascent App installation Copilot admin access (manage_billing:copilot or read:enterprise), then sync again.";
    case 503:
      return "This is a deployment-level gap, not an organization one: an operator has to configure the GitHub App (or the database) on this instance.";
    case 422:
      return "Nothing is wrong with the credential. The Metrics API only returns data for organizations with at least 5 active Copilot users.";
    case 502:
      return "Nothing was stored, so a later sync will pick the window up whole. Try again shortly.";
    case 404:
      return "Install the Ascent GitHub App on this organization first.";
    default:
      return null;
  }
}

function summaryLine(data: SyncOk): string {
  const days = data.days ?? 0;
  const stored = data.stored ?? 0;
  return (
    `Synced ${days} day${days === 1 ? "" : "s"} of Copilot activity (${stored} record${stored === 1 ? "" : "s"} stored): ` +
    `${data.seats ?? 0} seat${data.seats === 1 ? "" : "s"}, peak ${data.engagedPeak ?? 0} engaged user${data.engagedPeak === 1 ? "" : "s"}.`
  );
}

export function CopilotConnectV2({ slug, status = null }: { slug: string; status?: IngestWire | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; note?: string } | null>(null);
  const provider = PROVIDERS.find((item) => item.id === "copilot")!;

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/integrations/copilot/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug }),
      });
      const data = (await res.json().catch(() => ({}))) as SyncOk;
      if (res.ok && data.synced) setResult({ ok: true, text: summaryLine(data), note: data.note });
      else setResult({ ok: false, text: data.error ?? `The sync failed (${res.status}).`, note: remedyFor(res.status) ?? undefined });
    } catch {
      setResult({ ok: false, text: "Request failed. Is the app reachable?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="type-body-sm text-slate-400">
        Nothing to install and no key to paste: Ascent reads this organization&apos;s Copilot seat count and daily engaged users through the GitHub App installation it already holds. The credential needs Copilot admin access (<MonoPath>manage_billing:copilot</MonoPath> or <MonoPath>read:enterprise</MonoPath>); without it the sync says so rather than storing an empty window.
      </p>
      <StatusSentence line={providerStatusLine(provider, status)} />
      <SettingRow label="Organization" description="Read only. The org whose Copilot seats this sync reads." control={<span />} />
      <QuietField label="Organization" htmlFor="copilot-org">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Input id="copilot-org" readOnly value={slug} />
          </span>
          <CopyControl text={slug} />
        </span>
      </QuietField>
      <p className="type-body-sm text-slate-400">
        <span className="text-slate-100">This connector reports no cost.</span> GitHub does not expose the negotiated per-seat price through any API, so Ascent records seats and engagement and reports cost as unavailable rather than estimating it. Syncing Copilot therefore leaves the AI delivery views in their no-cost-source state: the spend columns stay empty and no ROI figure appears. Cost-based ROI needs a provider that reports it (Claude Code, via OpenTelemetry).
      </p>
      <PrimaryAction onClick={() => void sync()} disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </PrimaryAction>
      {result && <ConnectNotice ok={result.ok} text={result.text} note={result.note} />}
      <p className="type-body-sm text-slate-400">
        Re-syncing is safe: the Metrics API returns each day&apos;s totals, so an overlapping window overwrites those day buckets rather than accumulating them.
      </p>
      <CapabilityNotes items={provider.capabilities} note={provider.perRepo} />
    </div>
  );
}
