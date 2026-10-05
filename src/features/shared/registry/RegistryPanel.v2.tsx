// Prism registry: masthead, the six steps, then the machine. Altimeter stays in RegistryPanel.v1.

import { timeAgo } from "@/lib/ui";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryHeader } from "./RegistryHeader.v2";
import { RegistryIdentified } from "./RegistryIdentified.v2";
import { RegistryInvite } from "./RegistryInvite.v2";
import { RegistryMasthead } from "./RegistryMasthead.v2";
import { RegistryOnboarding } from "./RegistryOnboarding.v2";

function RegistryFault({ view }: { view: RegistryView }) {
  if (!view.error) return null;
  return (
    <p role="alert" className="type-body-sm text-slate-100">
      <span aria-hidden>! </span>
      Last index failed {timeAgo(view.error.at)}: {view.error.message}
    </p>
  );
}

export function RegistryPanelV2({ view, slug }: { view: RegistryView; slug: string }) {
  const identified = view.status !== "unmapped";
  return (
    <div data-role="registry-v2" className="space-y-10">
      <RegistryMasthead view={view} slug={slug} aside={identified ? <RegistryHeader view={view} slug={slug} /> : undefined} />
      <RegistryFault view={view} />
      <RegistryOnboarding view={view} slug={slug} />
      {identified ? <RegistryIdentified view={view} slug={slug} /> : <RegistryInvite view={view} />}
      <NextMoveLink href={orgTabHref(slug, "repositories")} to="repositories" />
    </div>
  );
}
