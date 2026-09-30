"use client";

// THE REMEDIATION PRICE LIST, Prism composition (v2): a Frame headed by what the numbers mean, one hairline row per
// (dimension, model) with the dimension named by hue. Every rate still carries its `n` and the caveat footer is the
// same shared component, so no rate reads more certain than its sample. Data from `usePriceList`, shared with v1.
import { Caption, DimensionMark, Frame, SectionHead, HairlineList } from "@/components/kit";
import { fmtMicrosPerPoint } from "@/lib/local/lane-economics";
import { dimShort } from "@/lib/ui";
import { PriceListFooter, type PriceListPanelProps } from "./PriceListPanel";
import { usePriceList } from "./usePriceList";

export function PriceListPanelV2({ slug, initial = null }: PriceListPanelProps) {
  const { prices, loaded } = usePriceList(slug, initial);
  if (!loaded || !prices) return null;
  return (
    <Frame aria-label="Remediation price list" pad="md">
      <SectionHead
        eyebrow="Price list"
        title="What a verified point"
        named="has cost."
        level="section"
        lede="Per model and dimension. Every rate is printed with the number of lanes behind it."
      />
      {prices.rows.length === 0 ? (
        <Caption tone="note" className="mt-6">
          A price needs a lane with both scan ends and a recorded cost. None of the lanes read here had all three yet.
        </Caption>
      ) : (
        <HairlineList className="mt-6" data-role="price-rows">
          {prices.rows.map((row) => {
            const rate = fmtMicrosPerPoint(row.microsPerPoint);
            return (
              <li key={`${row.model}:${row.dimId}`} className="grid grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)_auto] items-baseline gap-x-4 py-3">
                <DimensionMark id={row.dimId} label={dimShort(row.dimId)} />
                <span className="min-w-0 truncate type-body-sm text-slate-300">
                  {dimShort(row.dimId)} <span className="text-slate-500">·</span> {row.model}
                </span>
                <span
                  className="type-mono-sm tabular-nums text-white"
                  title={rate === "<0.01¢" ? "Positive cost below a hundredth of a cent per point — not free, not a measured zero." : undefined}
                >
                  {rate}
                  <span className="text-slate-400">/point</span>
                  <span
                    className="ml-3 text-slate-500"
                    title="Contributing lanes. A rate from one lane and a rate from nine are different claims; the price is never shown without it."
                  >
                    n={row.n}
                  </span>
                </span>
              </li>
            );
          })}
        </HairlineList>
      )}
      <PriceListFooter prices={prices} />
    </Frame>
  );
}
