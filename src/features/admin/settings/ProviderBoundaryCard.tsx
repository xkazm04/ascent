// "Whose computer runs the inference" — the provider comparison, drawn instead of narrated.
//
// This is the first thing the Settings tab paints (§2.2: first sight is graphical), above the two
// BYOM cards it compares. It replaces the diff a reader used to have to perform between two
// paragraphs sitting in two different card headers — see providerBoundaryViz.ts for what each mark
// means and why the Boundary column carries three different kinds of "no".
//
// Server-safe: no hooks, no handlers. `MatrixGrid` and `WhyChip` carry their own client boundary.

import { Kicker } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import type { OrgLlmConfigPublic } from "@/lib/db";
import {
  PROVIDER_AXES,
  PROVIDER_AXIS_HINT,
  providerBoundaryRows,
  providerBoundaryStates,
  providerScopeLine,
} from "./providerBoundaryViz";

export function ProviderBoundaryCard({
  config,
  planAllowed,
}: {
  config: OrgLlmConfigPublic | null;
  planAllowed: boolean;
}) {
  const rows = providerBoundaryRows({ config, planAllowed });

  return (
    <Card>
      <SectionHeader size="sm" title="Provider boundary" description={providerScopeLine(config)} />

      <div className="mt-4 max-w-sm">
        <MatrixGrid
          axes={[...PROVIDER_AXES]}
          rows={rows}
          title="Where each provider runs inference, who it bills, and which one this organization is on"
        />
      </div>

      <Legend states={providerBoundaryStates(rows)} className="mt-3" />

      {/* One disclosure per COLUMN. The demoted paragraphs were only ever meaningful as a comparison,
          which is why they read badly as two separate card ledes — so the caveat lives on the axis. */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {PROVIDER_AXES.map((axis) => (
          <li key={axis} className="flex items-center gap-1.5">
            <Kicker tone="muted" as="span">
              {axis}
            </Kicker>
            <WhyChip hint={PROVIDER_AXIS_HINT[axis]} label={axis} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
