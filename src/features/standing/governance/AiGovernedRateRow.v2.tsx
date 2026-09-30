"use client";

// Provenance bar for the Prism policy editor: minimum share of AI-attributed merged PRs
// that carried an approving human review. Unchecked omits the field on save.
import { Eyebrow, FormField, Input } from "@/components/kit";

export function AiGovernedRateRowV2({
  enabled,
  rate,
  onEnabled,
  onRate,
}: {
  enabled: boolean;
  rate: string;
  onEnabled: (v: boolean) => void;
  onRate: (v: string) => void;
}) {
  return (
    <div className="mt-6">
      <Eyebrow>AI-governed review</Eyebrow>
      <p className="mt-2 max-w-[40rem] type-body-sm text-slate-400">
        Share of AI-attributed merged PRs that carried an approving human review.
      </p>
      <FormField label="Min AI-governed rate (%)" htmlFor="gov-ai-governed" className="mt-3 max-w-md">
        <div className="flex items-center gap-3">
          <input
            id="gov-ai-governed"
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
            className="accent-accent"
          />
          <div className="w-28">
            <Input
              type="number"
              aria-label="Minimum AI-governed rate"
              min={1}
              max={100}
              value={rate}
              disabled={!enabled}
              onChange={(e) => onRate(e.target.value)}
            />
          </div>
        </div>
      </FormField>
    </div>
  );
}
