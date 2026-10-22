// The context beside adoption, Prism composition: the AI tooling seen in PRs (a chip band) and the delivery
// strip (reviewed, merged, typical merge), framed as context and never as a consequence of adoption.
// Server-safe.
import Link from "next/link";
import { Caption, Chip, ChipRow, Display, Frame, SectionHead } from "@/components/kit";
import { fmtHours } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { DELIVERY_HINT, TOOLING_HINT } from "./adoptionHints";

export function ToolFootprintV2({ tools }: { tools: { name: string; count: number }[] }) {
  return (
    <Frame pad="sm" aria-label="AI tooling in pull requests">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Caption>AI tooling in PRs</Caption>
        <ChipRow>
          {tools.map((t) => (
            <Chip key={t.name}>
              {t.name} ×{t.count}
            </Chip>
          ))}
        </ChipRow>
        <WhyChip hint={TOOLING_HINT} label="how tooling is detected" />
      </div>
    </Frame>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Caption>{label}</Caption>
      <Display as="div" level="figure" className="mt-1">
        {value}
      </Display>
    </div>
  );
}

export function DeliveryContextV2({ delivery, slug }: { delivery: AdoptionOverview["delivery"]; slug: string }) {
  if (!delivery) {
    return (
      <Frame aria-label="Delivery context">
        <SectionHead level="named" as="h3" eyebrow="Delivery context" title="No pull-request data" named="yet." />
        <p className="mt-3 max-w-[60ch] type-body-sm text-slate-300">
          Connect a GitHub token or the GitHub App to read PR signals alongside adoption. Delivery health is shown beside adoption as context, never as its
          consequence.{" "}
          <Link href={`/org/${slug}/settings`} className="focus-ring text-accent hover:text-white">
            Settings →
          </Link>
        </p>
      </Frame>
    );
  }
  return (
    <Frame aria-label="Delivery context">
      <SectionHead
        level="named"
        as="h3"
        eyebrow="Delivery context"
        title={`${delivery.prs.toLocaleString()} PRs across the fleet,`}
        named="beside adoption."
        actions={
          <>
            <WhyChip hint={DELIVERY_HINT} label="delivery beside adoption" align="end" />
            <Link href={orgTabHref(slug, "delivery")} className="focus-ring type-caption text-slate-300 transition hover:text-white">
              Delivery detail →
            </Link>
          </>
        }
      />
      <div className="mt-5 flex flex-wrap gap-x-12 gap-y-4">
        {delivery.reviewedRate != null && <Reading label="Reviewed" value={`${delivery.reviewedRate}%`} />}
        <Reading label="Merged" value={`${delivery.mergeRate}%`} />
        <Reading label="Typical merge" value={fmtHours(delivery.typicalHoursToMerge)} />
      </div>
    </Frame>
  );
}
