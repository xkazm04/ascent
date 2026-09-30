"use client";

// Review requirement for each autonomy tier. An empty field omits that tier on save.
import { FormField, Input } from "@/components/kit";
import type { AutonomyTierId } from "@/lib/types";
import { TIER_META } from "./stanceShared";
import { TIER_ORDER } from "./useStanceEditor";

const PLACEHOLDER: Record<AutonomyTierId, string> = {
  T0: "Normal review.",
  T1: "One human approval + green CI.",
  T2: "One human approval + green CI.",
  T3: "Human authorship only.",
};

export function StanceEditorReviewsV2({
  reviews,
  onChange,
}: {
  reviews: Partial<Record<AutonomyTierId, string>>;
  onChange: (tier: AutonomyTierId, value: string) => void;
}) {
  return (
    <div className="mt-6">
      <p className="type-body-sm text-slate-200">Review requirements by autonomy tier</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {TIER_ORDER.map((tier) => (
          <FormField key={tier} label={`${tier}, ${TIER_META[tier].name}`} htmlFor={`gov-review-${tier}`}>
            <Input
              id={`gov-review-${tier}`}
              value={reviews[tier] ?? ""}
              onChange={(e) => onChange(tier, e.target.value)}
              placeholder={PLACEHOLDER[tier]}
            />
          </FormField>
        ))}
      </div>
    </div>
  );
}
