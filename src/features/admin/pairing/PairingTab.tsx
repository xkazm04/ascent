// Org dashboard "Pairing" tab — LOCAL MODE scope management (self-hosted deployments only).
// SERVER component, filename PINNED (docs/ORG-TABS-REFACTOR.md).
//
// What it manages, in order: (1) the org's REGISTRY paired to its checkout — local first, so every
// registry module reads it without a GitHub App — with (2) GitHub as an optional step; then (3) the
// mapping from each fleet repo to a working copy on THIS SERVER's filesystem.
// A paired repo can be scanned from disk (no GitHub round trip — `git ls-files`/`git log` are the
// source), which is what lets a local agent's trailer commits close follow-ups before they are ever
// pushed, and is the prerequisite for the war room's autopilot.
//
// Guard order mirrors SettingsTab: deployment mode first (the tab is hidden from the rail on managed
// cloud, but a deep link still resolves — explain, don't 404, since the URL was honestly shared),
// then the owner gate, then data.

import { OrgEmpty } from "@/components/org/shared/ui";
import { listLocalPairings } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { selfHosted } from "@/lib/env";
import { orgTabHref } from "@/lib/org/orgTabs";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { getRegistryCapabilities } from "@/lib/registry/capabilities";
import { resolveLocalRegistry } from "@/lib/registry/local-source";
import { getTheme } from "@/lib/theme/server";
import { pairingV1 } from "./PairingTab.v1";
import { pairingV2 } from "./PairingTab.v2";
import type { PairingData } from "./pairingData";
import type { RegistryPairingView } from "./pairingClient";

/** The registry step's server read. Every part degrades on its own — a failed probe is "not connected". */
async function registryPairingView(slug: string): Promise<RegistryPairingView> {
  const [row, caps, suggested] = await Promise.all([
    getOrgRegistry(slug).catch(() => null),
    getRegistryCapabilities(slug, { probeCreate: false }).catch(() => null),
    resolveLocalRegistry().catch(() => null),
  ]);
  return {
    fullName: row?.fullName ?? null,
    localPath: row?.localPath ?? null,
    suggestedPath: suggested?.dir ?? null,
    status: row?.status ?? "unmapped",
    lastIndexedAt: row?.lastIndexedAt ?? null,
    lastIndexSha: row?.lastIndexSha ?? null,
    counts: row?.counts ?? { skills: 0, practices: 0, memory: 0, lessons: 0 },
    lastError: row?.lastError ?? null,
    github: {
      appConfigured: caps?.appConfigured ?? false,
      installed: caps?.installed ?? false,
      canWrite: caps?.canWrite ?? false,
      installUrl: caps?.installUrl ?? null,
    },
  };
}

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

  const [pairings, registry, theme] = await Promise.all([listLocalPairings(slug), registryPairingView(slug), getTheme()]);
  const data: PairingData = { pairings, registry };
  return theme === "prism" ? pairingV2(slug, data) : pairingV1(slug, data);
}
