// "Has anything actually arrived?" — the one line on a provider card that distinguishes a working
// connector from one that has been receiving telemetry and storing none of it. Sourced entirely from
// AiUsageRecord (updatedAt is a Prisma @updatedAt the ingest path already maintains), so there is no
// second write path to drift out of sync and no schema behind this.
//
// The copy is driven by the PROVIDER ROW, never by an id: `connectKind` decides what an owner is told
// to do when nothing has arrived (run Claude Code once vs. press Sync now), and `fidelity` decides
// what a delivered figure may be called. That second dispatch is load-bearing: this component used to
// map `status.measured ? "measured" : "allocated"` and print `$0.00 over the last 35 days` for every
// non-measured source, so a freshly synced Copilot org — whose connector reports seats and engagement
// and NO spend — would have rendered "not reported" as money. src/lib/integrations/copilot.ts and
// `hasAllocatedCost` exist to keep that fabrication out of the ROI model; this keeps it off the card.

import { freshness } from "@/lib/ui";
import type { ProviderIngestStatus } from "@/lib/db";
import { FIDELITY_META, type ConnectKind, type ProviderDef } from "@/lib/integrations/providers";

function Dot({ hex }: { hex: string }) {
  return <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: hex }} />;
}

/** What an owner does next when nothing has ever landed — one sentence per connect mechanism, so a
 *  provider added to the registry inherits the right instruction instead of Claude Code's. */
const FIRST_ACTION: Record<ConnectKind, string> = {
  "otel-push": "No telemetry received yet. Finish the setup below, then run Claude Code once.",
  "admin-pull": "Nothing synced yet. Use Sync now below to pull the org's seats and engagement.",
};

export function ProviderStatus({ provider, status }: { provider: ProviderDef; status: ProviderIngestStatus | null }) {
  if (provider.status !== "available") return null;

  if (!status) {
    return (
      <p className="mt-2 flex items-center gap-2 type-caption text-slate-500">
        <Dot hex="#475569" />
        {FIRST_ACTION[provider.connectKind]}
      </p>
    );
  }

  const when = freshness(status.lastReceived.toISOString());

  // Seats-only: the vendor never reports spend, so this line reports what it DOES report and no
  // dollar figure appears at any point. Repo attribution is not expected either (Copilot reports at
  // org level), so the "nothing landed on a repository" diagnostic below would be a false alarm here.
  if (provider.fidelity === "seats-only") {
    const meta = FIDELITY_META["seats-only"];
    return (
      <p className="mt-2 flex items-center gap-2 type-caption text-slate-400">
        <Dot hex={meta.hex} />
        <span>
          Last synced <span className="tabular-nums text-slate-300">{when}</span> ·{" "}
          <span className="tabular-nums text-slate-300">{status.seats}</span> seat{status.seats === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums text-slate-300">{status.sessions}</span> engaged user{status.sessions === 1 ? "" : "s"} (peak) ·{" "}
          <span className="text-slate-500" title={meta.note}>
            no cost reported
          </span>
        </span>
      </p>
    );
  }

  if (status.repos === 0) {
    return (
      <p className="mt-2 flex items-start gap-2 type-caption text-orange-300">
        <span className="mt-1.5">
          <Dot hex="#fb923c" />
        </span>
        <span>
          Last received {when}, but nothing landed on a repository. Check that{" "}
          <code className="text-slate-300">OTEL_RESOURCE_ATTRIBUTES=git.repository</code> is set to a GitHub remote; the ingest response
          reports the skipped datapoints and why.
        </span>
      </p>
    );
  }

  const fid = FIDELITY_META[status.measured ? "measured" : "allocated"];
  return (
    <p className="mt-2 flex items-center gap-2 type-caption text-slate-400">
      <Dot hex={fid.hex} />
      <span>
        Last received <span className="tabular-nums text-slate-300">{when}</span> ·{" "}
        <span className="tabular-nums text-slate-300">{status.repos}</span> repo{status.repos === 1 ? "" : "s"} attributed ·{" "}
        <span className="tabular-nums text-slate-300">${(status.costCents / 100).toFixed(2)}</span> over the last 35 days
      </span>
    </p>
  );
}
