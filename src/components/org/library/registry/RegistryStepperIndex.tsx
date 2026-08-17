// The Ledger direction's stepper: the six onboarding steps as an INDEX — numbered entries with a
// leader rule and a right-hand reading, the way a table of contents fills in as chapters land. The
// metaphor is that onboarding is not a wizard you are pushed through but a contents page you complete
// in any order; every entry states its own evidence, so a reload resumes exactly here.

"use client";

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { registrySteps, STEP_TONE, type RegistryStep } from "./registryModel";
import { RegistryChoiceActions, RegistryButton, fireIntent } from "./RegistryActions";

const STATE_READ: Record<RegistryStep["state"], string> = {
  done: "done",
  active: "next",
  blocked: "blocked",
  pending: "waiting",
  skipped: "n/a",
};

function Entry({ step, children }: { step: RegistryStep; children?: React.ReactNode }) {
  const tone = STEP_TONE[step.state];
  return (
    <li className="py-4">
      <div className="flex items-baseline gap-3">
        <span className={`font-mono text-sm tabular-nums ${step.state === "pending" ? "text-slate-600" : "text-accent"}`}>
          {String(step.n).padStart(2, "0")}
        </span>
        <span className={`text-base font-medium ${tone.text}`}>{step.title}</span>
        <span className="mx-2 hidden h-px flex-1 self-center bg-divider sm:block" aria-hidden />
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
          {STATE_READ[step.state]}
        </span>
      </div>
      <p className="mt-1 max-w-2xl pl-9 text-sm text-slate-400">{step.blurb}</p>
      <p className="mt-1 pl-9 font-mono text-xs text-slate-500">{step.detail}</p>
      {children ? <div className="mt-3 pl-9">{children}</div> : null}
    </li>
  );
}

export function RegistryStepperIndex({ view, slug }: { view: RegistryView; slug: string }) {
  const steps = registrySteps(view);
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Contents · setting up the registry</Kicker>
        <span className="font-mono text-xs text-slate-500">
          <span className="tabular-nums text-slate-200">{done}</span>/{steps.length} complete
        </span>
      </div>
      <ol className="divide-y divide-divider border-y border-divider">
        {steps.map((s) => (
          <Entry key={s.id} step={s}>
            {s.id === "choose" && s.state === "active" ? <RegistryChoiceActions view={view} slug={slug} /> : null}
            {s.id === "permissions" && s.state === "blocked" && view.permission.installUrl ? (
              <RegistryButton href={view.permission.installUrl}>Grant contents:write ↗</RegistryButton>
            ) : null}
            {s.id === "scaffold" && s.state === "active" && view.scaffoldPrUrl ? (
              <RegistryButton href={view.scaffoldPrUrl}>Review scaffold PR ↗</RegistryButton>
            ) : null}
            {s.id === "point" && s.state === "active" ? (
              <RegistryButton onClick={() => fireIntent("propose-pointers", slug)}>
                Propose pointer PRs to {Math.max(0, view.fleet.reposTotal - view.fleet.reposPointing)} repos
              </RegistryButton>
            ) : null}
          </Entry>
        ))}
      </ol>
      {view.error ? (
        <p className="pt-2 text-sm text-warn">
          <span className="font-mono text-xs uppercase tracking-[0.18em]">index error · </span>
          {view.error.message}
        </p>
      ) : null}
    </section>
  );
}
