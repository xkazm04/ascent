// "Active policy" card — the governance tab's policy readout + owner-only editor. Extracted from the
// old governance page.tsx JSX (docs/ORG-TABS-REFACTOR.md JSX-region split).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { GatePolicyEditor } from "./GatePolicyEditor";
import type { GatePolicy } from "@/lib/scoring/gate";

export function GovernancePolicyCard({
  slug,
  policyText,
  canEdit,
  gatePolicy,
}: {
  slug: string;
  policyText: string[];
  canEdit: boolean;
  gatePolicy: GatePolicy | null;
}) {
  return (
    <Card>
      <SectionHeader size="sm" title="Active policy" description="The bar every repo is held to — change it once, enforce it everywhere." />
      <ul className="mt-3 space-y-1.5">
        {policyText.map((t) => (
          <li key={t} className="flex items-start gap-2 text-sm text-slate-300">
            <span aria-hidden className="mt-0.5 text-accent">▸</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      {canEdit && <GatePolicyEditor org={slug} initial={gatePolicy} />}
    </Card>
  );
}
