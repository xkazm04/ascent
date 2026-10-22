// The Prism composition of the Pairing tab: a masthead that states how much of the fleet reads from disk,
// then the registry step and the fleet step as ruled Frames (the steps keep their own cards for the forms).
// Same data and the same step components as v1. Server-safe.
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { Frame, Masthead, SectionHead, type MastheadFigure } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { PairingList } from "./PairingList";
import { AddRepoForm } from "./AddRepoForm";
import { RegistryPairingCard } from "./RegistryPairingCard";
import { RegistryGithubStep } from "./RegistryGithubStep";
import type { PairingData } from "./pairingData";

export function pairingV2(slug: string, { pairings, registry }: PairingData) {
  const paired = pairings.filter((p) => p.localPath != null).length;
  const regPaired = registry.localPath !== null;
  const figures: MastheadFigure[] = [
    { label: "Repositories paired", value: `${paired} of ${pairings.length}`, detail: "Paths resolve on the server running Ascent" },
    { label: "Registry", value: regPaired ? "Paired" : "Not paired", tone: regPaired ? "good" : "watch", detail: regPaired ? registry.status : "Pair it first" },
    { label: "GitHub App", value: registry.github.installed ? "Installed" : "Optional", detail: "Not required for paired repos" },
  ];
  return (
    <div data-role="pairing-v2" className="stagger-children space-y-10">
      <Masthead
        eyebrow="Admin · self-hosted"
        statement="Scans read from disk,"
        named="no GitHub round trip."
        lede="Pair the registry first, then each repository, with their working copies on this machine."
        figures={figures}
        pattern="dots"
      />
      <Frame aria-label="Registry">
        <SectionHead eyebrow="Step 1" title="Pair the registry," named="local first." />
        <div className="mt-5 space-y-6">
          <RegistryPairingCard org={slug} view={registry} />
          <RegistryGithubStep org={slug} github={registry.github} paired={regPaired} />
        </div>
      </Frame>
      <Frame edge="both" aria-label="Fleet repositories">
        <SectionHead
          eyebrow="Step 2"
          title="Pair each repository,"
          named="then scan from disk."
          lede="Commits carrying the Ascent-Resolves trailer close follow-ups immediately, before any push, and feed the registry's conformance sweep."
        />
        <div className="mt-5 space-y-6">
          <AddRepoForm org={slug} />
          <PairingList org={slug} initial={pairings} />
        </div>
      </Frame>
      <NextMoveLink href={orgTabHref(slug, "repositories")} to="repositories" />
    </div>
  );
}
