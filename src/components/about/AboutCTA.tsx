"use client";

import Link from "next/link";
import { Surface } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { demoOrgHref } from "@/lib/site";
import { GlowBackdrop } from "./GlowBackdrop";

/** Closing deck section — the call to action centered in the viewport, with a compact footer riding
 *  at the bottom of the same screen. The footer is inline (not the server SiteFooter, which can't be
 *  imported into this client component) so the deck's last snap point still reaches it. */
export function AboutCTA() {
  return (
    <section id="cta" className="flex min-h-screen snap-start flex-col pt-14">
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
                  <Link href="/connect" className="rounded-xl bg-accent px-6 py-3 font-semibold text-on-accent transition hover:bg-accent-soft">
                    Scan your org
                  </Link>
                  <Link href={demoOrgHref()} className="rounded-xl border border-divider px-6 py-3 font-medium text-slate-200 transition hover:border-accent hover:text-white">
                    Explore the demo →
                  </Link>
                </div>
              </GlowBackdrop>
            </Surface>
          </Reveal>
        </div>
      </div>

      <footer className="border-t border-divider/70 py-8 text-center">
        <div className="mx-auto max-w-6xl px-5">
          <div className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">Ascent</div>
          <p className="mt-2 font-mono text-sm uppercase tracking-widest text-slate-500">The maturity index for AI-native engineering</p>
          <div className="mt-3 flex justify-center gap-5 font-mono text-sm uppercase tracking-widest text-slate-400">
            <Link href="/#pricing" className="focus-ring rounded-sm hover:text-accent">Pricing</Link>
            <Link href="/connect" className="focus-ring rounded-sm hover:text-accent">Connect</Link>
            <Link href="/" className="focus-ring rounded-sm hover:text-accent">Home</Link>
          </div>
        </div>
      </footer>
    </section>
  );
}
