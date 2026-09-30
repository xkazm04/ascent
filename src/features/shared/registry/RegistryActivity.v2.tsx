import { Frame, HairlineList, SectionHead } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import type { RegistryActivityKind, RegistryView } from "@/lib/org/registry-view";

const KIND_TAG: Record<RegistryActivityKind, string> = {
  "skill-version": "skill",
  lesson: "lesson",
  practice: "practice",
  memory: "memory",
  catalog: "catalog",
  index: "index",
};

export function RegistryActivityV2({ view, limit = 8 }: { view: RegistryView; limit?: number }) {
  const rows = view.activity.slice(0, limit);
  return (
    <Frame>
      <SectionHead eyebrow="Registry activity" title="What changed" named="in the repo." />
      {rows.length === 0 ? (
        <p className="mt-4 type-body-sm text-slate-400">
          Nothing indexed yet. The first entry appears when ascent reads the registry&apos;s default branch.
        </p>
      ) : (
        <HairlineList className="mt-4 list-none">
          {rows.map((a, i) => (
            <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="w-16 shrink-0 type-body-sm text-slate-400">{KIND_TAG[a.kind]}</span>
              <span className="min-w-0 flex-1 type-body-sm text-slate-200">
                {a.url ? (
                  <a href={a.url} className="text-slate-200 hover:text-white">
                    {a.title}
                  </a>
                ) : (
                  a.title
                )}
              </span>
              <span className="type-caption tabular-nums text-slate-400">{timeAgo(a.at)}</span>
            </li>
          ))}
        </HairlineList>
      )}
    </Frame>
  );
}
