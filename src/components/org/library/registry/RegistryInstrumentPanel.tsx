// The instrument column of the Registry tab — every load-bearing fact about the registry repo as a
// column of mono readouts (repo, branch, mode, index sha, catalog sha, webhook, sink, counts). Lifted
// out of the Blueprint direction when the tab consolidated into one render, so the panel file stays an
// orchestrator and this stays a pure readout list.
//
// Server-safe (no hooks). Tone is derived, never hand-picked: `off` for a fact that does not exist yet,
// `warn` for one that is failing, `ok` for a closed circuit.

import { Kicker, Surface } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { MODE_LABEL, SINK_LABEL, shortSha } from "./registryModel";

function Readout({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "ok" | "warn" | "off" }) {
  const color =
    tone === "ok" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "off" ? "text-slate-600" : "text-slate-200";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export function RegistryInstrumentPanel({ view }: { view: RegistryView }) {
  const r = view.registry;
  return (
    <div className="space-y-2">
      <Kicker tone="muted">Readouts</Kicker>
      <Surface radius="xl" className="divide-y divide-divider px-4 py-2">
        <Readout label="repo" value={r?.fullName ?? "—"} tone={r ? "plain" : "off"} />
        <Readout label="branch" value={r?.defaultBranch ?? "—"} tone={r ? "plain" : "off"} />
        <Readout label="mode" value={r ? MODE_LABEL[r.mode] : "—"} tone={r ? "plain" : "off"} />
        <Readout label="canonical" value={r ? (r.canonical ? "yes" : "no") : "—"} tone={r ? "plain" : "off"} />
        <Readout
          label="index sha"
          value={shortSha(r?.lastIndexSha)}
          tone={view.status === "error" ? "warn" : r?.lastIndexSha ? "ok" : "off"}
        />
        <Readout label="indexed" value={r?.lastIndexedAt ? timeAgo(r.lastIndexedAt) : "never"} tone={r?.lastIndexedAt ? "plain" : "off"} />
        <Readout label="catalog sha" value={shortSha(r?.catalogSha)} tone={r?.catalogSha ? "ok" : "off"} />
        <Readout label="webhook" value={r ? (r.webhookHealthy ? "healthy" : "unconfirmed") : "—"} tone={r?.webhookHealthy ? "ok" : "warn"} />
        <Readout label="telemetry sink" value={SINK_LABEL[view.telemetry.sink]} tone={view.telemetry.sink === "off" ? "off" : "ok"} />
        <Readout label="invokes 30d" value={view.telemetry.invokes30d.toLocaleString()} tone={view.telemetry.invokes30d > 0 ? "plain" : "off"} />
        <Readout label="lessons" value={String(view.counts.lessons)} tone={view.counts.lessons > 0 ? "plain" : "off"} />
      </Surface>
      {view.error ? (
        <p className="rounded-xl border border-warn/40 bg-warn/5 px-3 py-2 font-mono text-xs text-warn">
          index fault {timeAgo(view.error.at)} — {view.error.message}
        </p>
      ) : null}
    </div>
  );
}
