import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryActivityV2 } from "./RegistryActivity.v2";
import { RegistryArtifacts } from "./RegistryArtifacts.v2";
import { RegistryFleetV2 } from "./RegistryFleet.v2";
import { RegistryHowToV2 } from "./RegistryHowTo.v2";
import { RegistryKnowledgeV2 } from "./RegistryKnowledge.v2";
import { RegistryReadout } from "./RegistryReadout.v2";
import { RegistryTelemetryV2 } from "./RegistryTelemetry.v2";
import { RegistryTreeV2 } from "./RegistryTree.v2";

export function RegistryIdentified({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <>
      <RegistryTreeV2 view={view} />
      <RegistryArtifacts view={view} slug={slug} />
      <RegistryReadout view={view} />
      <RegistryFleetV2 view={view} slug={slug} />
      <RegistryTelemetryV2 view={view} />
      <RegistryKnowledgeV2 view={view} slug={slug} />
      <RegistryActivityV2 view={view} limit={10} />
      <RegistryHowToV2 view={view} />
    </>
  );
}
