// Fleet section for The Index — the Mission Control constellation, made public.
//
// The star field is the product's most tone-setting surface, but it lived only on /launch, which is
// session-gated AND robots-disallowed: nobody deciding whether to sign up ever saw it. This section
// puts the same sky in front of an anonymous visitor, using the data-free `PublicConstellation`
// (deterministic phyllotaxis, no fetch, no session, no fleet data) so it costs the landing page
// nothing but markup — the same trick the /launch OG card already proved.

import Link from "next/link";
import { DeckSection } from "@/components/deck/DeckSection";
import { Kicker } from "@/components/ui";
import { PublicConstellation } from "@/components/launch/PublicConstellation";

// The three claims the picture is making, spelled out so the vignette is readable, not merely pretty.
const FLEET_NOTES: Array<{ term: string; detail: string }> = [
  { term: "One cluster per org", detail: "Every installation you connect becomes its own constellation." },
  { term: "One star per repo", detail: "Brightness and size track the repository's AI-native maturity." },
  { term: "Live as it scans", detail: "Stars light up in place as scores stream in — nothing to refresh." },
];

export function IndexFleet() {
  return (
    // No inner container: IndexVariant already wraps the mid-deck sections in the editorial
    // `mx-auto max-w-6xl px-5` shell (same as IndexOrg / IndexLevels).
    <DeckSection id="fleet">
      <div className="grid items-center gap-10 border-y border-slate-800 py-8 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <div className="max-w-2xl">
          <Kicker>Mission control</Kicker>
          <h2 className="mt-2 text-2xl font-bold text-white">Your whole fleet, read at a glance</h2>
          <p className="mt-2 text-base leading-relaxed text-slate-400">
            Sign in and Ascent charts every organization you connect as a living star-map: a cluster per org, a
            star per repository, each one brightening as its maturity climbs. It is the whole estate in one
            frame — where the light is, and where it is not.
          </p>

          <dl className="mt-6 grid gap-px overflow-hidden rounded-xl bg-slate-800 sm:grid-cols-3">
            {FLEET_NOTES.map((n) => (
              <div key={n.term} className="bg-ink p-4">
                <dt className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">{n.term}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-slate-400">{n.detail}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href="/onboarding"
              className="focus-ring inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              Chart your fleet →
            </Link>
            <Link href="/connect" className="text-sm font-medium text-slate-300 transition hover:text-white">
              Or connect a GitHub organization →
            </Link>
          </div>
        </div>

        {/* The vignette. `launch-sky` is the same deep-field wash Mission Control uses; the
            constellation inside carries no data at all (see PublicConstellation). It is NOT
            aria-hidden — the SVG names itself — only the gradient frame is decorative. */}
        <div className="launch-sky relative mx-auto w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{ background: "radial-gradient(20rem 14rem at 50% 0%, rgba(59,158,255,0.10), transparent 65%)" }}
          />
          <div className="relative aspect-square">
            <PublicConstellation />
          </div>
          <div className="relative mt-2 text-center font-mono text-xs uppercase tracking-[0.22em] text-slate-600">
            Illustrative fleet
          </div>
        </div>
      </div>
    </DeckSection>
  );
}
