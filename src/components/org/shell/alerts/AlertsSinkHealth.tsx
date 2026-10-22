// Sink health on the Alerts chip and at the top of its popover (fleet-alerts-digests#B). The sink
// field says where alerts GO; this says whether they are ARRIVING, from the AlertEvent ledger alone
// (`sinkHealth` in src/lib/alert-sink-health.ts). Presentational only: no hooks, no handlers, so no
// "use client" (it renders inside the client AlertsControl either way).

import { sinkHealthLine, type SinkHealth } from "@/lib/alert-sink-health";

/**
 * A small dot on the chip, only while the sink is FAILING. A healthy sink, an org that never raised an
 * alert, and one with no sink at all get no new chrome on the chip: the popover line covers the last
 * case, and marking every sink-less org would teach people to ignore the dot.
 */
export function SinkHealthMarker({ health }: { health: SinkHealth | null }) {
  if (health?.state !== "failing") return null;
  const since = (health.failingSince ?? "").slice(0, 10);
  return (
    <span
      role="img"
      aria-label="Alert sink failing"
      title={`Alert sink failing since ${since}. Open to see what went undelivered.`}
      className="ml-0.5 inline-block h-2 w-2 rounded-full bg-danger"
    />
  );
}

/** One line above the sink field: failing since when and what was lost, or when it last delivered. */
export function SinkHealthLine({ health }: { health: SinkHealth | null }) {
  const line = health ? sinkHealthLine(health) : null;
  if (!health || !line) return null;
  const tone =
    health.state === "failing" ? "text-danger" : health.state === "unconfigured" ? "text-warn" : "text-slate-500";
  return <p className={`mt-1 type-caption ${tone}`}>{line}</p>;
}
