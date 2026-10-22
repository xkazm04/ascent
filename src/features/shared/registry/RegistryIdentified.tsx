import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryActivity } from "./RegistryActivity";
import { RegistryArtifacts } from "./RegistryArtifacts";
import { RegistryFleet } from "./RegistryFleet";
import { RegistryHowTo } from "./RegistryHowTo";
import { RegistryKnowledge } from "./RegistryKnowledge";
import { RegistryReadout } from "./RegistryReadout";
import { RegistryTelemetry } from "./RegistryTelemetry";
import { RegistryTreeView } from "./RegistryTreeView";

export function RegistryIdentified({ view, slug }: { view: RegistryView; slug: string }) {
  return (
    <>
      <RegistryTreeView view={view} />
      <RegistryArtifacts view={view} slug={slug} />
      <RegistryReadout view={view} />
      <RegistryFleet view={view} slug={slug} />
      <RegistryTelemetry view={view} />
      <RegistryKnowledge view={view} slug={slug} />
      <RegistryActivity view={view} limit={10} />
      <RegistryHowTo view={view} />
    </>
  );
}
