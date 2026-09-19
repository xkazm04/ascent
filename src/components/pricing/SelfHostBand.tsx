// The self-hosted option, stated on /pricing before the tier cards.
//
// A pricing page that lists four paid-ish tiers and never mentions that the whole product is
// AGPL-licensed and free to run yourself is not "focused marketing", it is a page that a visitor
// discovers is incomplete the moment they find the repository — and then trusts less. So this band
// goes ABOVE the cards: the free-forever path first, then what money buys.
//
// Deliberately NOT a fifth plan card. `PlanId` values are PERSISTED on `Organization.plan` and
// mapped in POLAR_PLAN_PRODUCTS; inventing a "self-hosted" tier to render one column would put a
// non-purchasable, non-storable id into a model the entitlement layer reads. This is a distinct
// band with its own shape, which is also honest about what it is: not a tier, a different way to run
// the same software.
//
// Server component: static copy and links only, no hooks or handlers.

import { HairlineGrid, Kicker } from "@/components/ui";
import { PLAN_FEATURES } from "@/lib/plans";
import { DOCS_ARE_UPSTREAM, selfHostGuideHref } from "@/lib/site";

/** What the self-hosted path gives you, phrased against the tier columns it sits above. */
const POINTS: { title: string; body: string }[] = [
  {
    title: "Unlimited scans",
    body: "No allowance, no credits, no 402. Metering exists to recover our inference bill; on your hardware that bill is already yours.",
  },
  {
    title: "Every capability",
    body: `Bring-your-own-model, white-label briefings, the skills library, shared org memory, PDF export — everything gated on the ${PLAN_FEATURES.team.label} and ${PLAN_FEATURES.enterprise.label} tiers is simply on.`,
  },
  {
    title: "Any model, including local",
    body: "Point it at Ollama, vLLM or LM Studio and nothing leaves the machine, at zero cost per token. Or run it on the Claude subscription you already pay for.",
  },
  {
    title: "Your data, your retention",
    body: "Your Postgres, your backups, no read floor on history. Nothing phones home.",
  },
];

export function SelfHostBand() {
  const guideHref = selfHostGuideHref();
  // `id="self-host"` is a public anchor: the landing hero's "run it yourself" CTA deep-links to
  // /pricing#self-host when the deployment names no source repository. Renaming it breaks that
  // fallback silently.
  return (
    <section id="self-host" aria-labelledby="self-host-heading" className="w-full">
      <HairlineGrid className="tick-corners">
        <div className="bg-surface/60 p-6 sm:p-8">
          <Kicker as="span" tone="accent">
            Free forever
          </Kicker>
          <h2 id="self-host-heading" className="deck-h2 mt-3 type-heading font-bold text-white sm:type-display">
            Run Ascent yourself
          </h2>
          {/* The claim a reader can check, stated as a fact rather than as a benefit: it is the same
              codebase, so "the cloud has the good version" cannot be true. */}
          <p className="mt-3 max-w-3xl type-body leading-relaxed text-slate-300">
            Ascent is open source under the{" "}
            <span className="text-slate-100">GNU AGPL-3.0</span>. Clone it, run it, and every tier
            below is switched on — because the same code runs here. The plans on this page buy
            <span className="text-slate-100"> operation</span>, not capability: a managed database, a
            registered GitHub App, cron that already runs, alerts, and someone on call for all of it.
          </p>

          <dl className="mt-7 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {POINTS.map((p) => (
              <div key={p.title}>
                <dt className="flex gap-2.5 type-body-sm font-medium text-white">
                  <span aria-hidden="true" className="mt-px select-none text-accent">
                    ✓
                  </span>
                  {p.title}
                </dt>
                <dd className="mt-1 pl-6 type-body-sm leading-relaxed text-slate-400">{p.body}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {/* The CTA is a real destination, always (MC-B22). It used to degrade to a printed file
                path whenever the deployment had not set NEXT_PUBLIC_SOURCE_REPO_URL — which is every
                deployment that has not been told to — leaving a page that claims AGPL and
                self-hostability three times over with nowhere to go. `selfHostGuideHref` falls back to
                UPSTREAM's guide and the label says so; only "view the source", which is a licence
                claim about THIS deployment, keeps the no-default rule. Plain <a>: it leaves the app. */}
            <a
              href={guideHref}
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded-xl border border-accent/50 bg-accent/10 px-5 py-2.5 font-medium text-white transition hover:bg-accent/20"
            >
              Self-hosting guide{DOCS_ARE_UPSTREAM ? " (upstream)" : ""} →
            </a>
            <code className="rounded-lg border border-divider bg-ink px-3 py-2 type-caption text-slate-300">
              docker compose --profile app up -d
            </code>
          </div>
        </div>
      </HairlineGrid>
    </section>
  );
}
