"use client";

// Prism bulk-tag bar. Same selection target, add, and clear as RepoLeaderboardBulkBar.
import { useId } from "react";
import { FormField, Frame, GhostAction, PrimaryAction, Select } from "@/components/kit";
import type { SegmentItem } from "./useRepoLeaderboard";

export function RepoLeaderboardBulkBarV2({
  count,
  segments,
  target,
  setTarget,
  busy,
  error,
  onAdd,
  onClear,
}: {
  count: number;
  segments: SegmentItem[];
  target: string;
  setTarget: (v: string) => void;
  busy: boolean;
  error: string | null;
  onAdd: () => void;
  onClear: () => void;
}) {
  const fieldId = useId();
  return (
    <div className="sticky bottom-4 z-10 mt-3">
      <Frame edge="both" pad="sm" aria-label="Add selected repositories to a segment">
        <div className="flex flex-wrap items-end gap-3">
          <p className="pb-2 type-body-sm text-white">{count} selected</p>
          <FormField label="Segment" htmlFor={fieldId} className="min-w-48" error={error ?? undefined}>
            <Select
              id={fieldId}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Add selected repos to segment"
            >
              <option value="">segment…</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormField>
          <PrimaryAction onClick={onAdd} disabled={busy || !target}>
            {busy ? "Adding…" : "Add"}
          </PrimaryAction>
          <GhostAction onClick={onClear}>Clear</GhostAction>
        </div>
      </Frame>
    </div>
  );
}
