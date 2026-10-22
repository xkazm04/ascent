// Registry: masthead, the six steps, then the machine.

import { Notice } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryHeader } from "./RegistryHeader";
import { RegistryIdentified } from "./RegistryIdentified";
import { RegistryInvite } from "./RegistryInvite";
import { RegistryMasthead } from "./RegistryMasthead";
import { RegistryOnboarding } from "./RegistryOnboarding";

function RegistryFault({ view }: { view: RegistryView }) {
  if (!view.error) return null;
  return (
    <Notice>
      Last index failed {timeAgo(view.error.at)}: {view.error.message}
    </Notice>
  );
}

export function RegistryPanel({ view, slug }: { view: RegistryView; slug: string }) {
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
