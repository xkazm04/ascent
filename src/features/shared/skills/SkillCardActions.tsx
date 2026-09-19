"use client";

// The action row on a skill card — extracted from SkillCard so that file stays under the 200-LOC
// features cap. Pure relocation: same markup, same className strings, same behavior.
//
// THE TWO INSTRUCTIONS LIVE HERE, ON THE CONTROLS THEY DESCRIBE. The Skills panel header used to
// carry "Copy a skill into Claude Code, or download it as a SKILL.md" above the whole table; the
// Download link already stated its own job in a `title`, and CopyForLlm's default title already
// named Claude Code. Both are now (D) disclosures on the buttons, where a reader is at the moment
// of acting rather than three screens above it.

import { chipButtonClass } from "@/components/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { OpenInRegistry, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import type { SkillRow } from "@/lib/db";

export function SkillCardActions({
  skill: s,
  canArchive,
  onArchive,
  onCopied,
  registryBase,
}: {
  skill: SkillRow;
  canArchive: boolean;
  onArchive: () => void;
  /** Counts a "use" (§8.7). Best-effort, fire-and-forget — it never blocks the copy. */
  onCopied: () => void;
  registryBase: string | null;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <CopyForLlm
        text={s.content}
        label="Copy"
        ariaLabel={`Copy "${s.name}" for LLM`}
        title="Copy this skill's SKILL.md body to paste into Claude Code or another LLM"
        onCopied={onCopied}
      />
      <a href={`/api/org/skills/${s.id}/download`} className={chipButtonClass()} title="Download the skill as a SKILL.md file">
        <span aria-hidden>↓</span> Download
      </a>
      {/* A registry-origin skill is a mirror of a file in a repo the customer owns: archiving it here
          would be undone by the next index pass, so the affordance is the file itself. Hosted rows
          keep archive exactly as before. */}
      {s.origin === "registry" ? (
        <OpenInRegistry href={registryBlobHref(registryBase, s.registryPath)} />
      ) : (
        canArchive && (
          <button
            onClick={onArchive}
            className="type-mono-sm text-slate-600 hover:text-orange-300"
            title="Archive this skill (admins only)"
          >
            archive
          </button>
        )
      )}
    </div>
  );
}
