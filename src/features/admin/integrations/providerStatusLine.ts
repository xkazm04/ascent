// The provider card's status sentence, shared with the Prism level. Same branches as ProviderStatus:
// seats-only never prints a dollar, allocated names org-level cost, a repo miss names the attribute.
import { freshness } from "@/lib/ui";
import type { ConnectKind, ProviderDef } from "@/lib/integrations/providers";
import type { IngestWire } from "./integrationModel";

export type StatusKind = "idle" | "ok" | "problem";

const FIRST_ACTION: Record<ConnectKind, string> = {
  "otel-push": "No telemetry received yet. Finish the setup below, then run Claude Code once.",
  "admin-pull": "Nothing synced yet. Use Sync now below to pull the org's seats and engagement.",
};

const FIRST_ACTION_ALLOCATED_PULL = "Nothing synced yet. Save an admin key below, then use Sync now to pull the org's daily cost.";

function firstAction(provider: ProviderDef): string {
  return provider.connectKind === "admin-pull" && provider.fidelity === "allocated" ? FIRST_ACTION_ALLOCATED_PULL : FIRST_ACTION[provider.connectKind];
}

export function providerStatusLine(provider: ProviderDef, status: IngestWire | null): { text: string; kind: StatusKind } | null {
  if (provider.status !== "available") return null;
  if (!status) return { text: firstAction(provider), kind: "idle" };
  const when = freshness(status.lastReceived);
  if (provider.fidelity === "seats-only") {
    const seats = `${status.seats} seat${status.seats === 1 ? "" : "s"}`;
    const users = `${status.sessions} engaged user${status.sessions === 1 ? "" : "s"} (peak)`;
    return { text: `Last synced ${when} · ${seats} · ${users} · no cost reported`, kind: "ok" };
  }
  if (provider.connectKind === "admin-pull" && provider.fidelity === "allocated") {
    return { text: `Last synced ${when} · org-level cost, allocated to repositories by git evidence`, kind: "ok" };
  }
  if (status.repos === 0) {
    return {
      text: "Last received " + when + ", but nothing landed on a repository. Check that OTEL_RESOURCE_ATTRIBUTES=git.repository is set to a GitHub remote; the ingest response reports the skipped datapoints and why.",
      kind: "problem",
    };
  }
  const dollars = `$${(status.costCents / 100).toFixed(2)}`;
  const repos = `${status.repos} repo${status.repos === 1 ? "" : "s"} attributed`;
  return { text: `Last received ${when} · ${repos} · ${dollars} over the last 35 days`, kind: "ok" };
}
