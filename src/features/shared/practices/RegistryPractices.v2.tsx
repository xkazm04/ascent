// Registry-origin practices as a ruled list. Nothing here edits the registry. Copy still opens a
// draft pull request in a different repository, through the same apply control as Altimeter.
import { Caption, DimensionMark, Frame, HairlineList, SectionHead, parseDimension } from "@/components/kit";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { PracticeShapeRow } from "@/lib/db/org-practice-shapes";
import { OpenInRegistry, OriginTag, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import { RegistryPracticeApply } from "./RegistryPracticeApply";

function dimensionName(id: string): string {
  return DIMENSIONS.find((d) => d.id === id)?.name ?? id;
}

export function RegistryPracticesV2({
  rows,
  registryBase,
  repoOptions = [],
}: {
  rows: readonly PracticeShapeRow[];
  registryBase: string | null;
  repoOptions?: string[];
}) {
  const fromRegistry = rows.filter((r) => r.origin === "registry");
  if (fromRegistry.length === 0) return null;
  const noun = fromRegistry.length === 1 ? "practice" : "practices";
  return (
    <Frame>
      <SectionHead
        eyebrow="Registry"
        title="From your registry,"
        named={`${fromRegistry.length} declared ${noun}.`}
        lede="These files live in your registry repository and change by pull request there. Ascent indexes them and never writes back. Copy opens a draft in a different repository."
      />
      <HairlineList className="mt-4">
        {fromRegistry.map((r) => {
          const dim = parseDimension(r.dimension);
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-100">{r.title || r.slug}</span>
                  {dim ? <DimensionMark id={r.dimension} label={dimensionName(r.dimension)} /> : <Caption>{r.dimension}</Caption>}
                  <Caption>{dimensionName(r.dimension)}</Caption>
                  <OriginTag origin={r.origin} path={r.registryPath} />
                </div>
                {r.appliesWhen && <p className="mt-1 max-w-[62ch] text-slate-400">{r.appliesWhen}</p>}
                <RegistryPracticeApply slug={r.slug} title={r.title || r.slug} repoOptions={repoOptions} />
              </div>
              <OpenInRegistry href={registryBlobHref(registryBase, r.registryPath)} />
            </li>
          );
        })}
      </HairlineList>
    </Frame>
  );
}
