// The Altimeter composition of the Pairing tab (moved unchanged from PairingTab.tsx). Server-safe.
import { SectionHeader } from "@/components/shared/dashboard/ui";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { PairingList } from "./PairingList";
import { AddRepoForm } from "./AddRepoForm";
import { RegistryPairingCard } from "./RegistryPairingCard";
import { RegistryGithubStep } from "./RegistryGithubStep";
import type { PairingData } from "./pairingData";

export function pairingV1(slug: string, { pairings, registry }: PairingData) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Local pairing"
        description="Pair the registry first, then each repository, with their working copies on this machine. Everything paired reads from disk — no GitHub App required."
      />
      <RegistryPairingCard org={slug} view={registry} />
      <RegistryGithubStep org={slug} github={registry.github} paired={registry.localPath !== null} />
      <SectionHeader
        title="Fleet repositories"
        description="Paired repos scan from disk — commits carrying the Ascent-Resolves trailer close follow-ups immediately, before any push — and feed the registry's conformance sweep."
      />
      <AddRepoForm org={slug} />
      <PairingList org={slug} initial={pairings} />
      <NextMoveLink href={orgTabHref(slug, "repositories")} to="repositories" />
    </div>
  );
}
