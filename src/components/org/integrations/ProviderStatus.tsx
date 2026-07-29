// "Has anything actually arrived?" — the one line on a provider card that distinguishes a working
// connector from one that has been receiving telemetry and storing none of it. Sourced entirely from
// AiUsageRecord.updatedAt (a Prisma @updatedAt the ingest path already maintains), so there is no
// second write path to drift out of sync and no schema behind this.
//
// Three states, all explicit: never received; received but nothing attributed to a repo; receiving.
// The "nothing attributed" case is the one that used to be invisible.

import { freshness } from "@/lib/ui";
import type { ProviderIngestStatus } from "@/lib/db";
import { FIDELITY_META } from "@/lib/integrations/providers";

function Dot({ hex }: { hex: string }) {
  return <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: hex }} />;
}

export function ProviderStatus({ status, available }: { status: ProviderIngestStatus | null; available: boolean }) {
  if (!available) return null;

  if (!status) {
    return (
      <p className="mt-2 flex items-center gap-2 font-mono text-xs text-slate-500">
        <Dot hex="#475569" />
        No telemetry received yet — finish the setup below, then run Claude Code once.
      </p>
    );
  }

  const when = freshness(status.lastReceived.toISOString());
  if (status.repos === 0) {
    return (
      <p className="mt-2 flex items-start gap-2 font-mono text-xs text-orange-300">
        <span className="mt-1.5">
          <Dot hex="#fb923c" />
        </span>
        <span>
          Last received {when} — but nothing landed on a repository. Check that{" "}
          <code className="text-slate-300">OTEL_RESOURCE_ATTRIBUTES=git.repository</code> is set to a GitHub remote; the ingest response
          reports the skipped datapoints and why.
        </span>
      </p>
    );
  }

  const fid = FIDELITY_META[status.measured ? "measured" : "allocated"];
  return (
    <p className="mt-2 flex items-center gap-2 font-mono text-xs text-slate-400">
      <Dot hex={fid.hex} />
      <span>
        Last received <span className="tabular-nums text-slate-300">{when}</span> ·{" "}
        <span className="tabular-nums text-slate-300">{status.repos}</span> repo{status.repos === 1 ? "" : "s"} attributed ·{" "}
        <span className="tabular-nums text-slate-300">${(status.costCents / 100).toFixed(2)}</span> over the last 35 days
      </span>
    </p>
  );
}
