"use client";

// The stored segment color. Identity the user picked, not a status and not a dimension.
import { PALETTE } from "./RepoSegmentsPanel.parts";

export function SegmentSwatchesV2({
  value,
  onPick,
  label,
}: {
  value: string;
  onPick: (color: string) => void;
  /** "Color" on create, "Recolor" while editing. Matches the v1 accessible names. */
  label: "Color" | "Recolor";
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`${label} segment`}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label} ${c}`}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
          className={`h-5 w-5 rounded-full border ${value === c ? "border-white" : "border-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
