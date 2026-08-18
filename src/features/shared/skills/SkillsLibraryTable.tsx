"use client";

// The Skills catalog table — extracted from SkillsPanel per the 200-LOC .tsx cap. Pure relocation: same
// markup, className strings and row-expansion behavior; list state and the archive mutation stay in
// useSkillsLibrary and are passed in as props.

import { Fragment } from "react";
import { OrgTable } from "@/components/org/shared/ui";
import { SkillCard } from "@/features/shared/skills/SkillCard";
import { SkillDormancyBadge } from "@/features/shared/skills/SkillDormancyBadge";
import { OriginTag } from "@/features/shared/registry/RegistryOriginTag";
import { skillCategoryLabel } from "@/lib/org/skill-categories";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import type { SkillAdoption, SkillRow } from "@/lib/db";

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
    return (
      <p className="text-base text-slate-500">
        {loading ? "Loading…" : filtered ? "No skills match your filters." : "No skills yet. Author your org's first reusable skill below."}
      </p>
    );
  }

  return (
    <OrgTable
      caption="Org skills: name, category, use status, adoptions and downloads"
      minWidth={660}
      head={
        <tr>
          <th className="px-3 py-2 text-left">Name</th>
          <th className="px-3 py-2 text-left">Category</th>
          <th className="px-3 py-2 text-left">Status</th>
          <th className="px-3 py-2 text-right">Adoptions</th>
          <th className="px-3 py-2 text-right">Uses</th>
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
                {s.version > 1 && <span className="ml-2 font-mono text-xs text-slate-500">v{s.version}</span>}
                {/* Only once a registry is mapped: before that every row is hosted and the tag is noise. */}
                {registryBase && (
                  <span className="ml-2">
                    <OriginTag origin={s.origin} path={s.registryPath} />
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                  {skillCategoryLabel(s.category)}
                </span>
              </td>
              <td className="px-3 py-2">
                {/* Server-computed, so it's absent for a skill authored since this page loaded — the
                    badge renders nothing rather than guessing a verdict. */}
                <SkillDormancyBadge usage={usage[s.id]} />
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s.adoptionCount}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s.downloadCount}</td>
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
