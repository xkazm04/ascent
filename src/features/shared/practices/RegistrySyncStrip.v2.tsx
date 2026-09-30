// Prism registry line. Hairline frame, not the rounded card Altimeter keeps. Same three facts.
import { Frame, GhostAction, MonoPath } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistrySync } from "@/lib/org/registry-sync";

const NOUN = { skills: "Skills", practices: "Practices", memory: "Memory" } as const;

function Count({ n, label }: { n: number; label: string }) {
  return (
    <>
      <span className="tabular-nums text-slate-100">{n}</span> {label}
    </>
  );
}

function Counts({ sync }: { sync: RegistrySync }) {
  const c = sync.counts;
  return (
    <span className="text-slate-400">
      <Count n={c.skills} label="skills" />
      {" · "}
      <Count n={c.practices} label="practices" />
      {" · "}
      <Count n={c.memory} label="memory notes" />
      {c.lessons > 0 && (
        <>
          {" · "}
          <Count n={c.lessons} label="lessons" />
        </>
      )}
    </span>
  );
}

export function RegistrySyncStripV2({
  sync,
  slug,
  artifact,
}: {
  sync: RegistrySync;
  slug: string;
  artifact: "skills" | "practices" | "memory";
}) {
  const href = orgTabHref(slug, "registry");
  if (!sync.mapped) {
    return (
      <Frame edge="both" pad="sm" aria-label="Registry">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <p className="text-slate-400">
            Nothing is backed by a registry yet: {NOUN[artifact]}, and everything beside it, lives only in ascent.
          </p>
          <GhostAction href={href}>Set up the registry</GhostAction>
        </div>
      </Frame>
    );
  }
  const indexed = sync.lastIndexedAt ? `indexed ${timeAgo(sync.lastIndexedAt)}` : "mapped, not indexed yet";
  return (
    <Frame edge="both" pad="sm" aria-label="Registry">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-slate-400">
          <span>Backed by</span>
          <a href={sync.url ?? "#"} target="_blank" rel="noreferrer" className="text-slate-100 hover:underline">
            <MonoPath>{sync.fullName}</MonoPath>
          </a>
          <span className="type-caption text-slate-400">{indexed}</span>
          <Counts sync={sync} />
        </p>
        <GhostAction href={href}>Registry</GhostAction>
      </div>
    </Frame>
  );
}
