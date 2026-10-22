import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryActivity } from "./RegistryActivity";
import { RegistryHowTo } from "./RegistryHowTo";
import { RegistryTreeView } from "./RegistryTreeView";

/** Nothing is counted until a registry is identified. */
export function RegistryInvite({ view }: { view: RegistryView }) {
  return (
    <>
      <RegistryTreeView view={view} />
      <RegistryHowTo view={view} />
      <RegistryActivity view={view} limit={10} />
    </>
  );
}
