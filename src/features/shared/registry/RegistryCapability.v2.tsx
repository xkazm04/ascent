"use client";

// Why no registry action is offered, and the ways in that are open. Same rules as the Altimeter note.

import { orgTabHref } from "@/lib/org/orgTabs";
import { PrimaryAction } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { capabilityNotice, visibleActions } from "./registryActionRules";
import { RegistryOutbound } from "./RegistryOutcome.v2";

export function RegistryPairLink({ slug }: { slug: string }) {
  return <PrimaryAction href={orgTabHref(slug, "pairing")}>Pair local registry</PrimaryAction>;
}

export function RegistryCapability({ view, slug }: { view: RegistryView; slug: string }) {
  const notice = capabilityNotice(view.capabilities, slug);
  const actions = visibleActions(view.capabilities, { mapped: view.status !== "unmapped" });
  const pair = actions.includes("pair-local");
  if (!notice && !pair) return null;
  return (
    <div className="space-y-2">
      {notice ? <p className="max-w-2xl type-body-sm text-slate-400">{notice}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {pair ? <RegistryPairLink slug={slug} /> : null}
        {actions.includes("install-app") && view.capabilities.installUrl ? (
          <RegistryOutbound href={view.capabilities.installUrl}>
            {pair ? "Install the GitHub App (optional)" : "Install the GitHub App"}
          </RegistryOutbound>
        ) : null}
      </div>
    </div>
  );
}
