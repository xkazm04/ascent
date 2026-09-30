import { Chip, Frame, HairlineList, MonoPath, SectionHead } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { registryTree } from "./registryTree";

export function RegistryTreeV2({ view }: { view: RegistryView }) {
  const nodes = registryTree(view);
  const unmapped = view.status === "unmapped";
  return (
    <Frame>
      <SectionHead
        eyebrow="Repo layout"
        title="The files"
        named="a registry is."
        lede={unmapped ? "Not scaffolded: this is what the pull request adds." : "Counts are files in the registry. A generated file is marked."}
      />
      <HairlineList className="mt-4 list-none">
        {nodes.map((n) => (
          <li key={n.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <MonoPath>{n.path}</MonoPath>
            {n.generated ? <Chip tone="neutral">generated</Chip> : null}
            {n.count != null ? <span className="tabular-nums text-slate-200">{n.count}</span> : null}
            <span className="type-body-sm text-slate-400">{n.note}</span>
          </li>
        ))}
      </HairlineList>
    </Frame>
  );
}
