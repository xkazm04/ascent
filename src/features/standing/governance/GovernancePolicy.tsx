// The active bar as a ruled list, with the owner editor under it. Not a card beside an empty twin.
import type { GatePolicy } from "@/lib/scoring/gate";
import { Frame, HairlineList, SectionHead } from "@/components/kit";
import { GatePolicyEditor } from "./GatePolicyEditor";

export function GovernancePolicy({
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
    <Frame aria-label="Active policy">
      <SectionHead eyebrow="Policy" title="The bar every repo" named="is held to." />
      <HairlineList className="mt-5">
        {policyText.map((t) => (
          <li key={t} className="flex items-start gap-3 py-3 type-body text-slate-200">
            <span aria-hidden className="text-slate-400">
              ▸
            </span>
            <span>{t}</span>
          </li>
        ))}
      </HairlineList>
      {canEdit && <GatePolicyEditor org={slug} initial={gatePolicy} />}
    </Frame>
  );
}
