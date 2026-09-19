// Labels a What Changed pair that spans mock (deterministic rubric, no model) and a live model.
// The delta still draws — this is a caveat, not a hard block.

import {
  MIXED_ENGINE_PAIR_LABEL,
  MIXED_ENGINE_PAIR_NOTE,
  mixesEngines,
} from "@/components/report/chartEngine";

export function MixedEngineCaveat({
  beforeEngine,
  afterEngine,
}: {
  beforeEngine: string | undefined | null;
  afterEngine: string | undefined | null;
}) {
  if (!mixesEngines([beforeEngine, afterEngine])) return null;
  return (
    <p
      role="status"
      data-testid="mixed-engine-pair"
      className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 type-body text-amber-200/90"
    >
      <span className="mr-2 inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 type-body-sm font-semibold text-amber-200">
        {MIXED_ENGINE_PAIR_LABEL}
      </span>
      {MIXED_ENGINE_PAIR_NOTE}
    </p>
  );
}
