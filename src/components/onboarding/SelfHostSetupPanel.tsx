// A self-hosted install with nothing set up yet: no declared local org, no GitHub App, no tenant.
//
// The in-app wizard is the wrong tool here — it imports repositories into an organization, and there
// is no organization. What the operator actually needs next is the repo's own `/onboarding` skill,
// run from Claude Code in the clone: it probes the machine, asks which capabilities to switch on,
// writes .env.local without echoing a secret, and boots the app with an honest capability matrix.
// This panel says so, at the altitude of "what will happen", and keeps the wizard one click away for
// the operator who only wants to score a public org right now.
//
// Server component: static copy. The step list is the same data the self-hosted /pricing renders,
// so the two surfaces can't describe two different skills.

import Link from "next/link";
import { Kicker, Surface } from "@/components/ui";
import { ONBOARDING_STEPS } from "@/components/pricing/selfHostPricingData";
import { DOCS_ARE_UPSTREAM, selfHostGuideHref } from "@/lib/site";

export function SelfHostSetupPanel() {
  // MC-B22: always a link — this deployment's own guide when it names a repository, upstream's
  // otherwise (labelled), rather than a file path printed at an operator who cannot click it.
  const guideHref = selfHostGuideHref();
  return (
    <Surface radius="2xl" className="tick-corners p-6 sm:p-8">
      <Kicker as="span">Self-hosted · nothing configured yet</Kicker>
      <h2 className="mt-2 type-heading font-bold text-white">Set this install up with the onboarding skill</h2>
      <p className="mt-2 max-w-2xl type-body leading-relaxed text-slate-300">
        This Ascent has no organization to scan into yet. Open the repository in Claude Code and run the skill:
        it takes a fresh clone to a booted install whose capability story matches reality, in one conversation.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-divider bg-ink px-4 py-3 type-mono-sm text-slate-200">
        <span className="select-none text-slate-600">$ </span>claude
        {"\n"}
        <span className="select-none text-slate-600">&gt; </span>/onboarding
      </pre>
      <ol className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {ONBOARDING_STEPS.map((s) => (
          <li key={s.n} className="grid grid-cols-[2.25rem_1fr] gap-x-2">
            <span className="type-mono-sm tabular-nums text-accent">{s.n}</span>
            <div>
              <div className="type-body-sm font-medium text-white">{s.title}</div>
              <p className="mt-0.5 type-body-sm leading-relaxed text-slate-400">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 type-body-sm leading-relaxed text-slate-400">
        The dashboard for your own projects needs an organization to hang off. The skill&apos;s{" "}
        <span className="font-mono text-slate-300">local-mode</span> group declares one (
        <span className="font-mono text-slate-300">ASCENT_LOCAL_ORG</span>), or install the GitHub App under{" "}
        <span className="font-mono text-slate-300">github-app</span> and it arrives with the first install.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href={guideHref}
          target="_blank"
          rel="noreferrer"
          className="focus-ring rounded-xl border border-accent/50 bg-accent/10 px-5 py-2.5 font-medium text-white transition hover:bg-accent/20"
        >
          Self-hosting guide{DOCS_ARE_UPSTREAM ? " (upstream)" : ""} →
        </a>
        <Link href="/onboarding?wizard=1" className="focus-ring type-body-sm text-slate-400 transition hover:text-white">
          Skip setup and scan a public organization →
        </Link>
      </div>
    </Surface>
  );
}
