import { getRegistryView } from "@/lib/org/registry-view";
import { RegistryWorkspace } from "./RegistryWorkspace";

export async function RegistryV2Tab({ slug }: { slug: string }) {
  return <RegistryWorkspace slug={slug} view={await getRegistryView(slug)} />;
}
