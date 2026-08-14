"use client";

// Closing deck section — the conversion moment centred in the viewport with a compact footer riding at
// the bottom of the same screen, mirroring AboutCTA's structure (the footer must be inline: the server
// SiteFooter can't be imported into a client component, and the deck's last snap point has to reach it).
//
// Footer nav is curated for THIS deck: the org-shaped next steps (Connect / Pricing) plus a way across
// to the per-repo story on /about, which is the one link a reader who landed here first will want.

import { Surface } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { SiteFooterCore } from "@/components/SiteFooterCore";
import { GlowBackdrop } from "@/components/about/GlowBackdrop";
import { AboutCtaButtons } from "@/components/about/AboutCtaButtons";

const ABOUT_ORG_FOOTER_LINKS = [
  { href: "/connect", label: "Connect" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About Ascent" },
  { href: "/", label: "Home" },
];

export function AboutOrgCTA() {
  return (
    // data-deck-last: the FINAL section of this deck — globals.css hides the inter-section connector
    // (hairline + node) on it. If a section is ever added after this one, move the attribute with it.
    <section id="cta" data-deck-last="" className="flex min-h-screen snap-start flex-col pt-14">
      <div className="flex flex-1 items-center">
        <div className="deck-container">
          <Reveal>
            <Surface tone="strong" radius="2xl" className="tick-corners relative overflow-hidden p-10 text-center 2xl:p-14">
              <GlowBackdrop
                strataOpacity="opacity-50"
                glow="radial-gradient(50% 60% at 50% 0%, rgba(59,158,255,0.14), transparent 70%)"
              >
                <h2 className="deck-h2 text-2xl font-bold text-white sm:text-3xl">Index your organization</h2>
                <p className="deck-lede mx-auto mt-3 max-w-xl text-base text-slate-300 2xl:max-w-2xl">
                  Connect the GitHub org and Ascent scores the fleet in minutes, or walk the live demo
                  first: every view in it is a real dashboard on real scans.
                </p>
                <AboutCtaButtons size="lg" className="mt-7 justify-center" />
              </GlowBackdrop>
            </Surface>
          </Reveal>
        </div>
      </div>

      {/* Below lg the fixed DeckNav bottom bar overlays the viewport bottom — reserve pb-24 so the
          footer's link row isn't covered by (or mis-tapped into) prev/next. */}
      <footer className="border-t border-divider/70 pb-24 pt-8 text-center lg:pb-8">
        <div className="deck-container">
          <SiteFooterCore
            brand={<div className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">Ascent</div>}
            links={ABOUT_ORG_FOOTER_LINKS}
          />
        </div>
      </footer>
    </section>
  );
}
