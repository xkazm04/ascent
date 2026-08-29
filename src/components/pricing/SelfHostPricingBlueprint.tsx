// The self-hosted /pricing surface — the "Blueprint" direction, promoted from a /prototype round
// (2026-08-29) over an editorial "Ledger" alternative. The comparison is a capability MATRIX (a
// proper table with mono column heads and tick readouts, the way a spec sheet lists what a unit
// ships with), and the setup process is a flight checklist: a rail of numbered stations, each with
// the probe it runs typeset like a terminal prompt. Engineering drawing, not editorial page.
//
// Server-safe: static copy, no hooks. Data comes from selfHostPricingData.ts.

import { Kicker, Surface } from "@/components/ui";
import { sourceRepoHref } from "@/lib/site";
import { CAPABILITY_DIFF, ONBOARDING_STEPS, SELF_HOST_LEDE } from "./selfHostPricingData";

const TH = "px-4 py-2.5 text-left font-mono text-xs font-normal uppercase tracking-[0.2em]";

export function SelfHostPricingBlueprint() {
  const guideHref = sourceRepoHref("docs/SELF-HOSTING.md");
  const gated = CAPABILITY_DIFF.filter((r) => r.gated);
  const ungated = CAPABILITY_DIFF.filter((r) => !r.gated);
  return (
    <section id="self-host" aria-labelledby="self-host-heading" className="w-full">
      <header className="text-center">
        <Kicker>Free forever</Kicker>
        <h1 id="self-host-heading" className="deck-h2 mt-3 text-3xl font-bold text-white sm:text-4xl">
          This install has every tier switched on
        </h1>
        <p className="deck-lede mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-300">{SELF_HOST_LEDE}</p>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">
          ASCENT_SELF_HOSTED=1 · unmetered · AGPL-3.0
        </p>
      </header>

      {/* (a) The capability matrix. */}
      <Surface radius="2xl" className="tick-corners mt-12 overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-divider px-4 py-3 sm:px-6">
          <Kicker as="span" tone="muted">
            a · Capability matrix — cloud plans vs. this install
          </Kicker>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {gated.length} gated capabilities · {ungated.length} operating limits
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-divider text-slate-500">
                <th scope="col" className={TH}>
                  Capability
                </th>
                <th scope="col" className={TH}>
                  Hosted cloud
                </th>
                <th scope="col" className={`${TH} text-accent`}>
                  This install
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {gated.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-white">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 text-slate-400">
                    <span className="rounded border border-divider px-1.5 py-0.5 font-mono text-xs text-slate-300">
                      {row.cloud}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-200">
                    <span aria-hidden="true" className="text-accent">
                      ✓
                    </span>{" "}
                    {row.local}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface/60">
                <td colSpan={3} className="px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                  Limits the tiers carry
                </td>
              </tr>
              {ungated.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-white">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 leading-relaxed text-slate-400">{row.cloud}</td>
                  <td className="px-4 py-2.5 leading-relaxed text-slate-200">{row.local}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* (b) The flight checklist. */}
      <div className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Kicker as="span" tone="muted">
            b · Setup checklist — the /onboarding skill
          </Kicker>
          <span className="font-mono text-xs tabular-nums text-slate-500">{ONBOARDING_STEPS.length} stations</span>
        </div>
        <ol className="mt-5 grid gap-px overflow-hidden rounded-2xl bg-divider sm:grid-cols-2 lg:grid-cols-4">
          {ONBOARDING_STEPS.map((s) => (
            <li key={s.n} className="flex flex-col bg-ink p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-2xl font-bold tabular-nums text-accent">{s.n}</span>
                <span aria-hidden="true" className="h-3 w-3 rounded-full border border-accent/60" />
              </div>
              <h3 className="mt-3 text-base font-medium text-white">{s.title}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-400">{s.body}</p>
              {s.probe && (
                <pre className="mt-3 overflow-x-auto rounded-lg border border-divider bg-surface-strong/40 px-3 py-2 font-mono text-xs text-slate-300">
                  <span className="select-none text-slate-600">$ </span>
                  {s.probe}
                </pre>
              )}
            </li>
          ))}
          <li className="flex flex-col justify-center bg-surface/60 p-5">
            <Kicker as="span" tone="muted">
              Further reading
            </Kicker>
            {guideHref ? (
              <a
                href={guideHref}
                target="_blank"
                rel="noreferrer"
                className="focus-ring mt-3 inline-block rounded-xl border border-accent/50 bg-accent/10 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-accent/20"
              >
                Self-hosting guide →
              </a>
            ) : (
              <span className="mt-3 font-mono text-xs text-slate-300">docs/SELF-HOSTING.md</span>
            )}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The skill reads the overlay at <span className="font-mono text-slate-400">.claude/onboarding/config.md</span>{" "}
              and runs on defaults without it.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}
