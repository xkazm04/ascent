"use client";

import Link from "next/link";
import { Surface } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { demoOrgHref } from "@/lib/site";
import { SiteFooterCore } from "@/components/SiteFooterCore";
import { GlowBackdrop } from "./GlowBackdrop";

// Deliberately CURATED footer nav for the /about deck's closing screen: the conversion paths
// (Pricing / Connect) plus a way home — not the full FOOTER_LINKS set (Leaderboard/Badge/Usage),
// which would dilute the CTA moment. Tagline + attribution still come from SiteFooterCore, so
// content edits land on both footers; revisit this subset deliberately, not by drift.
const ABOUT_FOOTER_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/connect", label: "Connect" },
  { href: "/", label: "Home" },
];

/** Closing deck section — the call to action centered in the viewport, with a compact footer riding
 *  at the bottom of the same screen. The footer is inline (not the server SiteFooter, which can't be
 *  imported into this client component) so the deck's last snap point still reaches it. */
export function AboutCTA() {
  return (
    // data-deck-last: this is the /about deck's FINAL section — globals.css hides the section
    // connector (hairline + node) on it. If a section is ever added after this one, move the
    // attribute to the new last section.
    <section id="cta" data-deck-last="" className="flex min-h-screen snap-start flex-col pt-14">
      <div className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-6xl px-5">
          <Reveal>
            <Surface tone="strong" radius="2xl" className="relative overflow-hidden p-10 text-center">
              <GlowBackdrop
                strataOpacity="opacity-50"
                glow="radial-gradient(50% 60% at 50% 0%, rgba(59,158,255,0.14), transparent 70%)"
              >
                <h2 className="text-2xl font-bold text-white sm:text-3xl">{"See your organization's index"}</h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-slate-300">
                  Connect your GitHub org and Ascent scores the fleet in minutes — or explore the live demo first.
                </p>
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <Link href="/connect" className="focus-ring rounded-xl bg-accent px-6 py-3 font-semibold text-on-accent transition hover:bg-accent-soft">
                    Scan your org
                  </Link>
                  <Link href={demoOrgHref()} className="focus-ring rounded-xl border border-divider px-6 py-3 font-medium text-slate-200 transition hover:border-accent hover:text-white">
                    Explore the demo →
                  </Link>
                </div>
              </GlowBackdrop>
            </Surface>
          </Reveal>
        </div>
      </div>

      {/* Below lg the fixed DeckNav bottom bar overlays the viewport bottom — reserve pb-24 so the
          footer's link row (the conversion moment) isn't covered by / mis-tapped into prev/next. */}
      {/* Content (tagline / links / attribution) is single-sourced via SiteFooterCore — only the
          shell (deck-bar clearance) and the text-only wordmark (Logo lives in the server-only
          Brand.tsx) are local. */}
      <footer className="border-t border-divider/70 pb-24 pt-8 text-center lg:pb-8">
        <div className="mx-auto max-w-6xl px-5">
          <SiteFooterCore
            brand={<div className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">Ascent</div>}
            links={ABOUT_FOOTER_LINKS}
          />
        </div>
      </footer>
    </section>
  );
}
