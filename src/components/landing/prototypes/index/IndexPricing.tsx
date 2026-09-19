"use client";

// Pricing snap for The Index. G8/G11: numeric, anonymous, one-click; self-host band above the grid;
// no "talk to sales" on Starter/Team. Amounts come from planPriceLabel() so this deck cannot drift
// from /pricing or the entitlement gate. Custom is Flexible plus the enquiry dialog.

import Link from "next/link";
import { DeckSection } from "@/components/deck/DeckSection";
import { HairlineGrid, Kicker, SectionHeading } from "@/components/ui";
import { PlanEnquiryCta } from "@/components/pricing/PlanEnquiryCta";
import { PLAN_FEATURES, PLAN_ORDER, planPriceLabel, planScanLine, type PlanId } from "@/lib/plans";

const CTA_CLASS =
  "focus-ring mt-4 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center type-body-sm font-medium text-white transition hover:bg-accent/20";

/** Anonymous branch of the /pricing CTA: Free scans, Starter/Team onboard, Custom enquires. */
function anonymousCta(id: PlanId): { href: string; label: string } | null {
  if (id === "free") return { href: "/", label: "Scan a repo free" };
  if (PLAN_FEATURES[id].billing === "custom") return null;
  return { href: "/onboarding", label: "Get started" };
}

export function IndexPricing() {
  return (
    <DeckSection id="pricing" justify="startLgCenter">
      <SectionHeading
        size="page"
        kicker="Plans"
        title="What hosted operation costs"
        intro="Self-host is free forever, every gate open. The figures below are the hosted plans, read from the same model the entitlement gate enforces."
      />

      {/* Same public anchor IndexLocal (and the hero fallback) already deep-link to. */}
      <HairlineGrid className="tick-corners mt-8">
        <div className="bg-surface/60 p-5 sm:p-6">
          <Kicker as="span" tone="accent">
            Free forever
          </Kicker>
          <p className="mt-2 max-w-3xl type-body leading-relaxed text-slate-300">
            Open source under AGPL-3.0. Clone it, run it, and every hosted tier is switched on. The
            plans below buy operation, not capability.
          </p>
          <Link
            href="/pricing#self-host"
            className="mt-4 inline-block type-body-sm font-medium text-slate-300 transition hover:text-white"
          >
            What self-hosting includes →
          </Link>
        </div>
      </HairlineGrid>

      <HairlineGrid className="tick-corners mt-6 sm:grid-cols-2 lg:grid-cols-4 2xl:mt-8">
        {PLAN_ORDER.map((id) => {
          const p = PLAN_FEATURES[id];
          const price = planPriceLabel(id);
          const highlight = id === "team";
          const cta = anonymousCta(id);
          return (
            <div
              key={id}
              data-plan={id}
              className={`flex flex-col p-5 2xl:p-6 ${highlight ? "bg-surface/60" : "bg-ink"}`}
            >
              <Kicker as="span" tone={highlight ? "accent" : "muted"}>
                {p.label}
              </Kicker>
              <p className="mt-3 type-figure-lg font-bold leading-none text-white">{price.amount}</p>
              <p className="mt-2 type-body-sm text-slate-500">{price.cadence}</p>
              <p className="mt-3 flex-1 type-body-sm leading-relaxed text-slate-400">{p.blurb}</p>
              <p className="mt-4 type-mono-sm text-accent">{planScanLine(id)}</p>
              {cta === null ? (
                <PlanEnquiryCta className={CTA_CLASS} />
              ) : (
                <Link href={cta.href} className={CTA_CLASS}>
                  {cta.label}
                </Link>
              )}
            </div>
          );
        })}
      </HairlineGrid>
    </DeckSection>
  );
}
