// THE AWARENESS HEADER — four answers in large, high-contrast type, the part everyone reads from three
// metres. It answers the same four questions whatever the hero below it draws. Pure rendering of `HeaderModel`
// (theaterHeaderModel.ts): no hooks, no clock, no fetch — so a server test or a DOM test can render
// every state from a fixture.
//
// The live-dot (the one sanctioned ambient loop, BRAND.md) renders ONLY when the model says the runner
// is genuinely running on a fresh pulse; under reduced motion globals.css resolves it to a still dot.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { armLabel, type Arm } from "@/lib/local/arm";
import { TODAY_PREDICATES, type HeaderModel, type HeaderTone } from "./theaterHeaderModel";

const TONE: Record<HeaderTone, string> = {
  live: "text-white",
  calm: "text-slate-200",
  warn: "text-amber-300",
  danger: "text-danger",
  muted: "text-slate-400",
};

function Block({ label, children, amber = false }: { label: string; children: React.ReactNode; amber?: boolean }) {
  return (
    <section
      aria-label={label}
      data-amber={amber || undefined}
      className={`flex min-w-0 flex-col gap-2 px-6 py-5 ${amber ? "bg-amber-500/10" : "bg-ink"}`}
    >
      <Kicker tone={amber ? "accent" : "muted"} className={amber ? "text-amber-300" : ""}>
        {label}
      </Kicker>
      {children}
    </section>
  );
}

function Headline({ tone, children, live = false }: { tone: HeaderTone; children: React.ReactNode; live?: boolean }) {
  return (
    <p className={`flex min-w-0 items-center gap-3 type-display-lg font-semibold leading-tight ${TONE[tone]}`}>
      {live ? <span aria-hidden data-testid="theater-live-dot" className="live-dot h-3.5 w-3.5 shrink-0 rounded-full bg-accent" /> : null}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return <p className="type-title text-slate-400">{children}</p>;
}

/**
 * WHAT THE WORK ON SCREEN IS ARMED WITH — shown on EVERY run, single-arm ones included, because
 * "which model did this" is the question the theater could not answer at all before arms existed.
 *
 * The caller passes the arm of the lane the header is reporting on (`theaterArm.ts`): on a `single`
 * run that is the run's one arm, and on a `compare` run it is the arm of the work the NOW block is
 * describing — which is the only honest answer, since a race between four arms has no single one.
 *
 * Quiet by construction: a mono caption under the running answer, never a headline. A null label
 * renders NOTHING rather than "default" — a lane recorded before arms existed has a genuinely unknown
 * configuration, and "default" would be a claim about it (`armLabel`, arm.ts).
 */
function ArmLine({ arm }: { arm: Arm | null | undefined }) {
  const label = armLabel(arm);
  if (!label) return null;
  return (
    <p data-testid="theater-arm" className="truncate font-mono type-caption text-slate-500" title={`Armed with ${label}`}>
      {label}
    </p>
  );
}

export function TheaterHeader({ model, arm }: { model: HeaderModel; arm?: Arm | null }) {
  const { running, now, today, needs } = model;
  // NOTHING TO REPORT: the four questions keep their kickers and answer with an empty block, because
  // with no runner every one of them would say the same thing the hero is already saying once. The
  // blocks hold their height so the page does not reflow the moment the first pulse has news.
  if (model.quiet) {
    return (
      <header aria-label="Runner status" data-quiet className="grid gap-px border-b border-divider bg-divider md:grid-cols-2 xl:grid-cols-4">
        {["Running?", "Now", "Today", "Needs you"].map((label) => (
          <Block key={label} label={label}>
            <div aria-hidden className="min-h-[3.5rem]" />
          </Block>
        ))}
      </header>
    );
  }
  return (
    <header aria-label="Runner status" className="grid gap-px border-b border-divider bg-divider md:grid-cols-2 xl:grid-cols-4">
      <Block label="Running?">
        <div aria-live="polite">
          <Headline tone={running.tone} live={running.live}>
            {running.headline}
          </Headline>
        </div>
        <Sub>{running.sub}</Sub>
        <ArmLine arm={arm} />
      </Block>

      <Block label="Now">
        <Headline tone={now.tone}>{now.headline}</Headline>
        {now.path ? <p className="truncate font-mono type-title text-accent-soft" title={now.path}>{now.path}</p> : null}
        <Sub>{now.sub}</Sub>
      </Block>

      <Block label="Today">
        <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 type-display-lg font-semibold text-white">
          <span title={TODAY_PREDICATES.verified}>
            <span className="font-mono tabular-nums">{today.verified}</span> <span className="type-title font-normal text-slate-400">verified</span>
          </span>
          <span title={TODAY_PREDICATES.landed}>
            <span className="font-mono tabular-nums">{today.landed}</span> <span className="type-title font-normal text-slate-400">landed</span>
          </span>
        </p>
        <div title={TODAY_PREDICATES.spend} className="flex flex-col gap-1.5">
          <p className="type-title text-slate-300">
            <span className="font-mono tabular-nums text-white">{today.spend}</span>
            {today.ceiling ? <span className="text-slate-400"> of {today.ceiling}</span> : <span className="text-slate-500"> · no ceiling</span>}
          </p>
          {today.ratio != null ? (
            <div
              role="meter"
              aria-label="Spend of the daily ceiling"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(today.ratio * 100)}
              className="h-1 w-full overflow-hidden rounded-full bg-slate-800"
            >
              <div className={`h-full rounded-full ${today.ratio >= 0.9 ? "bg-amber-400" : "bg-accent"}`} style={{ width: `${today.ratio * 100}%` }} />
            </div>
          ) : null}
        </div>
        <Sub>{today.asOf}</Sub>
      </Block>

      <Block label="Needs you" amber={needs.amber}>
        <Headline tone={needs.tone}>
          {needs.amber ? <span className="mr-3 font-mono tabular-nums">{needs.count}</span> : null}
          {needs.headline}
        </Headline>
        {needs.href ? (
          <Link href={needs.href} className="focus-ring w-fit rounded type-title font-medium text-amber-200 underline decoration-amber-400/50 underline-offset-4 hover:text-white">
            Open the ledger →
          </Link>
        ) : null}
        <Sub>{needs.sub}</Sub>
      </Block>
    </header>
  );
}
