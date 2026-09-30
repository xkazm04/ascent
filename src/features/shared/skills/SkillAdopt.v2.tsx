"use client";

// Mark or unmark repos that reuse this skill. Optimistic, with rollback, same as the Altimeter card.
import { useState } from "react";
import { Chip, ChipRow, FormField, GhostAction, Select } from "@/components/kit";
import type { SkillAdoption } from "@/lib/db";

export function SkillAdoptV2({
  skillId,
  adoption,
  repoOptions,
}: {
  skillId: string;
  adoption: SkillAdoption | undefined;
  repoOptions: string[];
}) {
  const [applied, setApplied] = useState<string[]>(adoption?.adoptedRepos ?? []);
  const [pick, setPick] = useState("");
  const available = repoOptions.filter((r) => !applied.includes(r));
  const fieldId = `skill-adopt-${skillId}`;

  async function adopt() {
    const repo = pick;
    if (!repo || applied.includes(repo)) return;
    setApplied((a) => [...a, repo]);
    setPick("");
    try {
      const res = await fetch(`/api/org/skills/${skillId}/adopt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) setApplied((a) => a.filter((r) => r !== repo));
    } catch {
      setApplied((a) => a.filter((r) => r !== repo));
    }
  }

  async function unadopt(repo: string) {
    setApplied((a) => a.filter((r) => r !== repo));
    try {
      const res = await fetch(`/api/org/skills/${skillId}/adopt`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo }),
      });
      if (!res.ok) setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
    } catch {
      setApplied((a) => (a.includes(repo) ? a : [...a, repo]));
    }
  }

  return (
    <div className="mt-4 border-t border-divider pt-4">
      <p className="type-body-sm text-slate-200">
        Adopted by <span className="tabular-nums">{applied.length}</span> repo{applied.length === 1 ? "" : "s"}
      </p>
      {applied.length > 0 && (
        <ChipRow className="mt-2">
          {applied.map((r) => (
            <span key={r} className="inline-flex items-center gap-2">
              <Chip tone="neutral">{r.split("/").pop()}</Chip>
              <GhostAction onClick={() => unadopt(r)} aria-label={`Unmark ${r}`}>
                Unmark
              </GhostAction>
            </span>
          ))}
        </ChipRow>
      )}
      {available.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <FormField label="Mark a repo adopted" htmlFor={fieldId} className="min-w-[12rem] flex-1">
            <Select id={fieldId} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pick a repo">
              <option value="">Pick a repo…</option>
              {available.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </FormField>
          <GhostAction onClick={adopt} disabled={!pick} aria-label="Record that this repo adopted the skill">
            Mark adopted
          </GhostAction>
        </div>
      )}
    </div>
  );
}
