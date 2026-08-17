"use client";

// The Registry tab's action affordances, shared by all three prototype directions. PROTOTYPE ROUND:
// every action is real-looking and logs its intent (`console.info`) instead of calling an API — the
// writers (`scaffoldRegistryPr`, `migrateToRegistryPr`, the indexer, the pointer PRs) land in R2/R3.
// Hoisted here from the first variant that needed a button so the three directions cannot drift on
// what the actions ARE, only on how they are laid out.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import { CTA_OUTLINE, CTA_PRIMARY, timeAgo } from "@/lib/ui";
import type { RegistryCandidate, RegistryView } from "@/lib/org/registry-view";

export type RegistryIntent =
  | "create-registry"
  | "map-existing"
  | "stay-hosted"
  | "grant-permission"
  | "migrate-skills"
  | "migrate-practices"
  | "migrate-memory"
  | "reindex"
  | "propose-pointers";

/** One log line per click — the prototype's stand-in for the POST that lands in R2. */
export function fireIntent(intent: RegistryIntent, slug: string, extra?: Record<string, unknown>) {
  console.info("[registry-prototype] intent", { intent, slug, ...extra });
}

export function RegistryButton({
  children,
  onClick,
  tone = "outline",
  disabled,
  title,
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "primary" | "outline";
  disabled?: boolean;
  title?: string;
  href?: string;
}) {
  const cls = `${tone === "primary" ? CTA_PRIMARY : CTA_OUTLINE} text-sm disabled:cursor-not-allowed disabled:opacity-40`;
  if (href) {
    return (
      <a href={href} title={title} className={cls} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={cls}>
      {children}
    </button>
  );
}

/**
 * Step 1's three answers. "Stay hosted" is deliberately present and un-dimmed as a *choice* — the
 * copy says what it costs rather than hiding it, which is the whole difference between an invitation
 * and a funnel.
 */
export function RegistryChoiceActions({ view, slug }: { view: RegistryView; slug: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <RegistryButton tone="primary" onClick={() => fireIntent("create-registry", slug)}>
          Create {slug}/ai-registry
        </RegistryButton>
        <RegistryButton onClick={() => setPicking((p) => !p)} disabled={view.candidates.length === 0}>
          {picking ? "Close picker" : `Map an existing repo${view.candidates.length ? ` (${view.candidates.length})` : ""}`}
        </RegistryButton>
        <RegistryButton onClick={() => fireIntent("stay-hosted", slug)} title="Keeps today's behavior: ascent stays the writer">
          Stay hosted
        </RegistryButton>
      </div>
      {picking ? <RegistryCandidatePicker candidates={view.candidates} slug={slug} /> : null}
      {!view.permission.contentsWrite && view.permission.installUrl ? (
        <p className="text-sm text-slate-400">
          The GitHub App cannot write to your repos yet.{" "}
          <a href={view.permission.installUrl} className="text-accent hover:text-white" target="_blank" rel="noreferrer">
            Grant contents:write →
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** The "map existing" repo list: real facts per row so the choice is informed, not a name-only chip. */
export function RegistryCandidatePicker({ candidates, slug }: { candidates: RegistryCandidate[]; slug: string }) {
  if (candidates.length === 0) {
    return <p className="text-sm text-slate-500">No installed repositories to map — install the App on one first.</p>;
  }
  return (
    <ul className="divide-y divide-divider overflow-hidden rounded-xl border border-divider">
      {candidates.map((c) => (
        <li key={c.fullName} className="flex flex-wrap items-center justify-between gap-3 bg-surface/40 px-4 py-3">
          <div className="min-w-0">
            <div className="font-mono text-sm text-white">{c.fullName}</div>
            <div className="mt-0.5 font-mono text-xs text-slate-500">
              {c.private ? "private" : "public"} · {c.defaultBranch} · pushed {timeAgo(c.pushedAt)} ·{" "}
              {c.hasLayout ? <span className="text-accent">registry layout detected</span> : "layout would be scaffolded by PR"}
            </div>
          </div>
          <RegistryButton onClick={() => fireIntent("map-existing", slug, { repo: c.fullName })}>
            {c.hasLayout ? "Map" : "Map + scaffold"}
          </RegistryButton>
        </li>
      ))}
    </ul>
  );
}

/** Indexed-state header actions: re-index, propose pointer PRs, open the repo. */
export function RegistryHeaderActions({ view, slug }: { view: RegistryView; slug: string }) {
  const unpointed = Math.max(0, view.fleet.reposTotal - view.fleet.reposPointing);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RegistryButton onClick={() => fireIntent("reindex", slug)}>Re-index</RegistryButton>
      <RegistryButton onClick={() => fireIntent("propose-pointers", slug, { repos: unpointed })} disabled={unpointed === 0}>
        Propose pointer PRs{unpointed > 0 ? ` (${unpointed})` : ""}
      </RegistryButton>
      {view.registry ? (
        <RegistryButton href={view.registry.url}>Open on GitHub ↗</RegistryButton>
      ) : null}
    </div>
  );
}

/** Step 4's per-artifact action. `n/a` (hosted mirror) renders as a stated reason, not a dead button. */
export function RegistryMigrateAction({
  artifact,
  step,
  slug,
}: {
  artifact: "skills" | "practices" | "memory";
  step: RegistryView["migration"]["skills"];
  slug: string;
}) {
  if (step.state === "merged") {
    return (
      <span className="font-mono text-xs text-slate-500">
        merged · {step.moved}/{step.total}
      </span>
    );
  }
  if (step.state === "n/a") return <span className="font-mono text-xs text-slate-500">hosted mode</span>;
  if (step.state === "pr-open") {
    return (
      <a href={step.prUrl ?? "#"} className="font-mono text-xs text-accent hover:text-white" target="_blank" rel="noreferrer">
        review PR ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => fireIntent(`migrate-${artifact}` as RegistryIntent, slug, { total: step.total })}
      className="focus-ring font-mono text-xs text-accent transition hover:text-white"
    >
      open migration PR →
    </button>
  );
}

/** Small labelled action row used by the Blueprint/Pipeline readouts. */
export function RegistryActionRail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Kicker tone="muted">{label}</Kicker>
      {children}
    </div>
  );
}
