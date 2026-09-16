"use client";

// Why no registry action is offered, said once — and the ways in that ARE open. On a self-hosted
// deployment the first of those is pairing the registry's local checkout (Admin -> Pairing), which
// needs no GitHub App; installing the App is the optional second. Split out of RegistryActions.tsx.

import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";
import { capabilityNotice, visibleActions } from "./registryActionRules";
import { RegistryButton } from "./RegistryActions";

/** The Pairing tab link — local first, so it renders before any GitHub affordance. */
export function RegistryPairLocalLink({ slug }: { slug: string }) {
  return (
    <RegistryButton href={orgTabHref(slug, "pairing")} tone="primary" title="Pair the registry's working copy on this machine — no GitHub App needed">
      Pair local registry →
    </RegistryButton>
  );
}

export function RegistryCapabilityNote({ view, slug }: { view: RegistryView; slug: string }) {
  const notice = capabilityNotice(view.capabilities, slug);
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  const pair = actions.includes("pair-local");
  if (!notice && !pair) return null;
  return (
    <div className="space-y-2">
      {notice ? <p className="max-w-2xl type-body-sm text-slate-400">{notice}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {pair ? <RegistryPairLocalLink slug={slug} /> : null}
        {actions.includes("install-app") && view.capabilities.installUrl ? (
          <RegistryButton href={view.capabilities.installUrl}>{pair ? "Install the GitHub App (optional) ↗" : "Install the GitHub App ↗"}</RegistryButton>
        ) : null}
      </div>
    </div>
  );
}
