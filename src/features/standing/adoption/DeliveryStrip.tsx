// DeliveryStrip — the delivery context as one slim hairline-divided ticker instead of a half-page
// card: five readings, one row, honest framing (context beside adoption, never a causal claim).
// Server-safe.

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { Surface, Kicker } from "@/components/ui";
import { fmtHours } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { scoreHex } from "@/lib/ui";
import { DELIVERY_HINT } from "./adoptionHints";

function Reading({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-5 py-4">
      <Kicker tone="muted">{label}</Kicker>
      <div className="mt-1 font-mono type-title font-bold tabular-nums" style={{ color: color ?? "#e2e8f0" }}>
        {value}
      </div>
    </div>
  );
}

export function DeliveryStrip({ delivery, slug }: { delivery: NonNullable<AdoptionOverview["delivery"]>; slug: string }) {
  const d = delivery;
  return (
    <Surface radius="xl" className="p-0">
      {/* The AI-involved / AI-governed rates live in the headline tiles; this strip carries the pure
          delivery-health half so the two surfaces never repeat a number. */}
      <div className="flex flex-wrap items-stretch divide-x divide-divider">
        <div className="flex w-72 min-w-56 flex-col justify-center px-5 py-4">
          <span className="flex items-center gap-2">
            <Kicker tone="muted">Delivery · context</Kicker>
            {/* (D) "shown beside adoption, not a causal claim" — the reading constraint, on demand. */}
            <WhyChip hint={DELIVERY_HINT} label="delivery beside adoption" />
          </span>
          <p className="mt-1 type-mono-sm text-slate-500">{d.prs.toLocaleString()} PRs across the fleet</p>
          <Link href={orgTabHref(slug, "delivery")} className="mt-1 type-label tracking-widest text-slate-500 transition hover:text-accent">
            Delivery detail →
          </Link>
        </div>
        {d.reviewedRate != null && <Reading label="Reviewed" value={`${d.reviewedRate}%`} color={scoreHex(d.reviewedRate)} />}
        <Reading label="Merged" value={`${d.mergeRate}%`} color={scoreHex(d.mergeRate)} />
        <Reading label="Typical merge" value={fmtHours(d.typicalHoursToMerge)} />
      </div>
    </Surface>
  );
}
