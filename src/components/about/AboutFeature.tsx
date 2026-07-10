import type { ReactNode } from "react";
import { Kicker } from "@/components/ui";
import { Reveal } from "@/components/deck/Reveal";
import { DeckSection } from "@/components/deck/DeckSection";
import { GlowBackdrop } from "./GlowBackdrop";

/** One heavy-hitter capability as a full-viewport deck section: editorial copy on one side, a live
 *  animated diagram on the other, sides alternating down the deck (`reverse`). */
export function AboutFeature({
  id,
  kicker,
  title,
  body,
  points,
  value,
  reverse,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  value: string;
  reverse?: boolean;
  children: ReactNode;
}) {
  return (
    <DeckSection id={id}>
      <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 lg:grid-cols-2">
        <Reveal className={reverse ? "lg:order-last" : ""}>
          <Kicker>{kicker}</Kicker>
          <h2 className="mt-3 text-2xl font-bold text-white sm:text-3xl">{title}</h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">{body}</p>
          <ul className="mt-5 space-y-2.5">
            {points.map((p, i) => (
              <li key={i} className="flex gap-3 text-base text-slate-400">
                <span aria-hidden className="mt-0.5 text-accent">
                  ▸
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-l-2 border-accent/50 pl-4 text-base font-medium text-white">{value}</p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="relative overflow-hidden rounded-2xl border border-divider bg-surface-strong/40 p-5 sm:p-6">
            <GlowBackdrop
              strataOpacity="opacity-40"
              pointerEventsNone
              glow="radial-gradient(70% 60% at 50% 0%, rgba(59,158,255,0.10), transparent 70%)"
            >
              {children}
            </GlowBackdrop>
          </div>
        </Reveal>
      </div>
    </DeckSection>
  );
}
