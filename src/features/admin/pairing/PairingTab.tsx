// Org dashboard "Pairing" tab — LOCAL MODE scope management (self-hosted deployments only).
// SERVER component, filename PINNED (docs/ORG-TABS-REFACTOR.md).
//
// What it manages: the mapping from each fleet repo to a working copy on THIS SERVER's filesystem.
// A paired repo can be scanned from disk (no GitHub round trip — `git ls-files`/`git log` are the
// source), which is what lets a local agent's trailer commits close follow-ups before they are ever
// pushed, and is the prerequisite for the war room's autopilot.
//
// Guard order mirrors SettingsTab: deployment mode first (the tab is hidden from the rail on managed
// cloud, but a deep link still resolves — explain, don't 404, since the URL was honestly shared),
// then the owner gate, then data.

import { OrgEmpty, SectionHeader } from "@/components/org/shared/ui";
import { PairingList } from "./PairingList";
import { AddRepoForm } from "./AddRepoForm";
import { listLocalPairings } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { selfHosted } from "@/lib/env";
import { orgTabHref } from "@/lib/org/orgTabs";

export async function PairingTab({ slug }: { slug: string }) {
  if (!selfHosted()) {
    return (
      <OrgEmpty
        title="Self-hosted only"
        body="Pairing maps repositories to folders on the server that runs Ascent, so it only exists on a self-hosted deployment. On Ascent Cloud there is no server filesystem of yours to pair against."
        href={orgTabHref(slug, "overview")}
        cta="← Overview"
      />
    );
  }
  if (!(await hasOrgRole(slug, "owner"))) {
    return (
      <OrgEmpty
        title="Owner only"
        body="Pairing points scans (and the autopilot) at folders on the server's filesystem, so it is limited to organization owners."
        href={orgTabHref(slug, "overview")}
        cta="← Overview"
      />
    );
  }

  const pairings = await listLocalPairings(slug);
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Local pairing"
        description="Pair each repository with its working copy on this machine. Paired repos scan from disk — commits carrying the Ascent-Resolves trailer close follow-ups immediately, before any push."
      />
      <AddRepoForm org={slug} />
      <PairingList org={slug} initial={pairings} />
    </div>
  );
}
