// What the Altimeter stepper drew under an open step. Rendered once: under the list, or on the open level.

import { MonoPath } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import type { RegistryStep } from "./registryModel";
import { RegistryOutbound } from "./RegistryOutcome.v2";
import { RegistrySetupV2 } from "./RegistrySetup.v2";

export function RegistryStepActions({ view, slug, step }: { view: RegistryView; slug: string; step: RegistryStep }) {
  if (step.id === "choose" && step.state === "active") return <RegistrySetupV2 view={view} slug={slug} />;
  if (step.id === "permissions" && step.state === "blocked" && view.capabilities.installUrl) {
    return <RegistryOutbound href={view.capabilities.installUrl}>Grant contents:write</RegistryOutbound>;
  }
  if (step.id === "scaffold" && step.state === "active" && view.scaffoldPrUrl) {
    return <RegistryOutbound href={view.scaffoldPrUrl}>Review scaffold PR</RegistryOutbound>;
  }
  if (step.id === "point" && step.state === "active") {
    return (
      <p className="max-w-2xl type-body-sm text-slate-400">
        No bulk action for this yet. Add <MonoPath>{view.howTo.pointer}</MonoPath> to a repo&apos;s{" "}
        <MonoPath>.ai/manifest.yaml</MonoPath>, or have a developer run <MonoPath>{view.howTo.syncCmd}</MonoPath>. That is
        what makes a repo count as pointing.
      </p>
    );
  }
  return null;
}
