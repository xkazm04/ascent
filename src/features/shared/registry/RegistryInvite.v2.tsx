import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryActivityV2 } from "./RegistryActivity.v2";
import { RegistryHowToV2 } from "./RegistryHowTo.v2";
import { RegistryTreeV2 } from "./RegistryTree.v2";

/** Nothing is counted until a registry is identified. */
export function RegistryInvite({ view }: { view: RegistryView }) {
  return (
    <>
      <RegistryTreeV2 view={view} />
      <RegistryHowToV2 view={view} />
      <RegistryActivityV2 view={view} limit={10} />
    </>
  );
}
