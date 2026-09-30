"use client";

// Copy, download, archive, or open the registry file. Actions sit on the open level, never inside the row.
import { Caption, GhostAction } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { OpenInRegistry, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import type { SkillRow } from "@/lib/db";

export function SkillActionsV2({
  skill: s,
  canArchive,
  onArchive,
  registryBase,
}: {
  skill: SkillRow;
  canArchive: boolean;
  onArchive: () => void;
  registryBase: string | null;
}) {
  function countCopy() {
    fetch(`/api/org/skills/${s.id}/download`, { method: "POST" }).catch(() => {});
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <CopyForLlm
          text={s.content}
          label="Copy"
          ariaLabel={`Copy "${s.name}" for LLM`}
          title="Copy this skill's SKILL.md body to paste into Claude Code or another LLM"
          onCopied={countCopy}
        />
        <GhostAction href={`/api/org/skills/${s.id}/download`} aria-label="Download the skill as a SKILL.md file">
          Download
        </GhostAction>
        {s.origin === "registry" ? (
          <OpenInRegistry href={registryBlobHref(registryBase, s.registryPath)} />
        ) : (
          canArchive && (
            <GhostAction onClick={onArchive} aria-label="Archive this skill (admins only)">
              Archive
            </GhostAction>
          )
        )}
      </div>
      <Caption className="mt-2">
        Copy pastes this skill&apos;s SKILL.md body into Claude Code or another LLM. Download saves it as a file.
        {s.origin === "registry"
          ? " A registry skill changes by pull request, not by archiving it here."
          : " Archive removes a hosted skill. Admins only."}
      </Caption>
    </div>
  );
}
