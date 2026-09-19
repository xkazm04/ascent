"use client";

// GitHub Copilot connect surface — the ADMIN-PULL path. There is nothing for the customer to
// configure and no credential for Ascent to store: the sync reads the org's seats and daily
// engagement through the GitHub App installation Ascent already holds, so "connecting" is one
// owner-only POST to /api/integrations/copilot/sync. The backend has existed since W3b; until now it
// had no caller, so the card showed a green "Available" badge and offered no way to act.
//
// THE HONESTY THIS PANEL CARRIES: Copilot reports seats and engagement, NOT cost. GitHub does not
// expose the org's negotiated per-seat price through any API, so no cost figure exists to report and
// none is invented (src/lib/integrations/copilot.ts). The consequence is stated here, before the
// owner presses the button rather than after: the AI delivery views stay in their no-cost-source
// state after a Copilot sync — connecting this does not light up ROI.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { Field } from "./SetupField";

/** The route's success body (`summarizeCopilotSync` + storage + the standing cost note). */
interface SyncOk {
  synced?: boolean;
  days?: number;
  seats?: number;
  engagedPeak?: number;
  stored?: number;
  note?: string;
  error?: string;
}

/**
 * What an owner should DO about each refusal. The route already answers from fact rather than from a
 * scope guess — denied / not-configured / absent / unreachable are typed branches, not one blanket
 * error — so this only adds the remedy; the server's own sentence stays the headline.
 */
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

function summaryLine(d: SyncOk): string {
  const days = d.days ?? 0;
  const stored = d.stored ?? 0;
  return (
    `Synced ${days} day${days === 1 ? "" : "s"} of Copilot activity (${stored} record${stored === 1 ? "" : "s"} stored): ` +
    `${d.seats ?? 0} seat${d.seats === 1 ? "" : "s"}, peak ${d.engagedPeak ?? 0} engaged user${d.engagedPeak === 1 ? "" : "s"}.`
  );
}

export function CopilotSetup({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; note?: string } | null>(null);

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
      if (res.ok && data.synced) {
        setResult({ ok: true, text: summaryLine(data), note: data.note });
      } else {
        const remedy = remedyFor(res.status);
        setResult({
          ok: false,
          text: data.error ?? `The sync failed (${res.status}).`,
          note: remedy ?? undefined,
        });
      }
    } catch {
      setResult({ ok: false, text: "Request failed. Is the app reachable?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Kicker tone="muted">Connect via GitHub admin read</Kicker>
        <p className="mt-1 type-body-sm text-slate-400">
          Nothing to install and no key to paste: Ascent reads this organization&apos;s Copilot{" "}
          <span className="text-slate-300">seat count</span> and <span className="text-slate-300">daily engaged users</span> through the
          GitHub App installation it already holds. The credential needs Copilot admin access
          (<code className="type-caption text-slate-300">manage_billing:copilot</code> or{" "}
          <code className="type-caption text-slate-300">read:enterprise</code>); without it the sync says so rather than storing an empty
          window.
        </p>
      </div>

      <Field label="Organization" value={slug} />

      <div className="rounded-lg border border-divider bg-surface-strong/60 p-3">
        <p className="type-body-sm text-slate-400">
          <span className="text-slate-200">This connector reports no cost.</span> GitHub does not expose the negotiated per-seat price
          through any API, so Ascent records seats and engagement and reports cost as unavailable rather than estimating it. Syncing
          Copilot therefore leaves the{" "}
          <span className="text-slate-300">AI delivery</span> views in their no-cost-source state — the spend columns stay empty and no
          ROI figure appears. Cost-based ROI needs a provider that reports it (Claude Code, via OpenTelemetry, above).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
        {result && (
          <div role="status" className="min-w-0 flex-1">
            <p className={`type-body-sm ${result.ok ? "text-emerald-300" : "text-orange-300"}`}>{result.text}</p>
            {result.note && <p className="mt-1 type-note text-slate-500">{result.note}</p>}
          </div>
        )}
      </div>

      <p className="type-note text-slate-500">
        Re-syncing is safe: the Metrics API returns each day&apos;s totals, so an overlapping window overwrites those day buckets rather
        than accumulating them.
      </p>
    </div>
  );
}
