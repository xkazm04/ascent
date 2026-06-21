// Compact tech-stack badges (Feature 3a) — the detected role/framework chips shown next to a repo on
// the leaderboard (and reusable elsewhere). Server-safe (no client hooks). Renders nothing when there's
// no detected stack, so an un-scanned/unknown repo stays clean.

import { techChips } from "@/lib/org/tech-stack";
import type { TechStack } from "@/lib/types";

export function TechBadges({ stack, max = 5 }: { stack: TechStack | null | undefined; max?: number }) {
  if (!stack) return null;
  const chips = techChips(stack);
  if (chips.length === 0) return null;
  const shown = chips.slice(0, max);
  const extra = chips.length - shown.length;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {shown.map((c) => (
        <span key={c} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-400">
          {c}
        </span>
      ))}
      {extra > 0 && <span className="font-mono text-xs text-slate-600">+{extra}</span>}
    </span>
  );
}
