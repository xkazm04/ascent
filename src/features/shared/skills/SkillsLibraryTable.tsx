"use client";

// The Skills catalog table — extracted from SkillsPanel per the 200-LOC .tsx cap. List state and the
// archive mutation stay in useSkillsLibrary and are passed in as props.
//
// "Uses" is the FOLDED total (`SkillUsage.useCount`) across both sinks, and it NAMES them plus the
// window: sink A (events API: copies, downloads, hook/CI/MCP invokes) is all-time (the DB groupBy
// has no window); sink B is the registry `usage/` lane every project writes its own counter into
// (`ascent-skills report --to-registry`, no token) over each contributor's declared window. That is
// a volume. The neighbouring Registry tab's `invokes30d` / `invokesDirect30d` are the 30d rates;
// this column must not borrow that label. It falls back to the denormalized `downloadCount` only
// when no verdict was computed for the row (persistence off, or a skill that arrived after the page
// loaded), so the column can never disagree with the status badge beside it — both read the same fold.

import { Fragment } from "react";
import { OrgTable } from "@/components/org/shared/ui";
import { SkillCard } from "@/features/shared/skills/SkillCard";
import { SkillDormancyBadge } from "@/features/shared/skills/SkillDormancyBadge";
import { OriginTag } from "@/features/shared/registry/RegistryOriginTag";
import { skillCategoryLabel } from "@/lib/org/skill-categories";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillAdoption, SkillRow } from "@/lib/db";

/** Sink A all-time + sink B as reported. Not the Registry tab's 30d invoke rate. */
export const USES_COLUMN_WINDOW = "all-time";

export const USES_COLUMN_TITLE =
  "All-time volume: sink A (events API: copies, downloads, hook, CI and MCP invokes) plus sink B (registry usage/ over each contributor's declared window). Distinct from the Registry tab's 30d invoke rate.";

export const USES_TABLE_CAPTION =
  "Org skills: name, category, use status, adoptions and all-time uses (sink A events API and sink B registry usage/, not the Registry 30d rate)";

export function SkillsLibraryTable({
  slug,
  skills,
  loading,
  filtered,
  expanded,
  setExpanded,
  adoption,
  usage,
  outcomes,
  repoOptions,
  isAdmin,
  archive,
  registryBase,
}: {
  slug: string;
  skills: SkillRow[];
  loading: boolean;
  filtered: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  adoption: Record<string, SkillAdoption>;
  usage: Record<string, SkillUsage>;
  outcomes: Record<string, SkillOutcome[]>;
  repoOptions: string[];
  isAdmin: boolean;
  archive: (id: string) => void;
  registryBase: string | null;
}) {
  if (skills.length === 0) {
    // The (O) destination for the panel header's value claim: a reader with nothing to look at is the
    // one who needs the argument for authoring a skill at all. It is absent once the table has rows.
    if (!loading && !filtered) {
      return (
        <div className="type-body text-slate-500">
          <p>No skills yet.</p>
          <p className="mt-1">
            Skills are not written here. Link the org&apos;s registry and every skill in its{" "}
            <span className="type-mono-sm text-slate-400">skills/</span> lane appears on the next sync;
            each project then reports its own use counts into the registry&apos;s{" "}
            <span className="type-mono-sm text-slate-400">usage/</span> lane, and this table sums them.
          </p>
        </div>
      );
    }
    return <p className="type-body text-slate-500">{loading ? "Loading…" : "No skills match your filters."}</p>;
  }

  return (
    <OrgTable
      caption={USES_TABLE_CAPTION}
      minWidth={660}
      head={
        <tr>
          <th className="px-3 py-2 text-left">Name</th>
          <th className="px-3 py-2 text-left">Category</th>
          <th className="px-3 py-2 text-left">Status</th>
          <th className="px-3 py-2 text-right">Adoptions</th>
          <th
            className="px-3 py-2 text-right"
            data-uses-window={USES_COLUMN_WINDOW}
            data-uses-sinks="A B"
            title={USES_COLUMN_TITLE}
          >
            Uses{" "}
            <span className="font-normal normal-case tracking-normal text-slate-600">{USES_COLUMN_WINDOW}</span>
          </th>
        </tr>
      }
    >
      {skills.map((s) => {
        const open = expanded === s.id;
        return (
          <Fragment key={s.id}>
            <tr onClick={() => setExpanded(open ? null : s.id)} className="cursor-pointer">
              <td className="px-3 py-2">
                <span className="font-medium text-slate-200">{s.name}</span>
                {s.version > 1 && <span className="ml-2 type-caption text-slate-500">v{s.version}</span>}
                {/* Only once a registry is mapped: before that every row is hosted and the tag is noise. */}
                {registryBase && (
                  <span className="ml-2">
                    <OriginTag origin={s.origin} path={s.registryPath} />
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="rounded border border-slate-700 px-1.5 py-0.5 type-caption text-slate-400">
                  {skillCategoryLabel(s.category)}
                </span>
              </td>
              <td className="px-3 py-2">
                {/* Server-computed, so it's absent for a skill authored since this page loaded — the
                    badge renders nothing rather than guessing a verdict. */}
                <SkillDormancyBadge usage={usage[s.id]} />
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s.adoptionCount}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">
                {usage[s.id]?.useCount ?? s.downloadCount}
              </td>
            </tr>
            {open && (
              <tr>
                <td colSpan={5} className="px-3 pb-3">
                  <SkillCard
                    skill={s}
                    slug={slug}
                    adoption={adoption[s.id]}
                    usage={usage[s.id]}
                    outcomes={outcomes[s.id]}
                    repoOptions={repoOptions}
                    canArchive={isAdmin}
                    onArchive={() => archive(s.id)}
                    registryBase={registryBase}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </OrgTable>
  );
}
