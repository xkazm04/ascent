// The one inline share meter the Contributors tab uses (champions, per-person AI share, top-share).
// Co-located extraction from page.tsx (300-LOC rule) — behavior unchanged. Server-safe.

import { MeterRow } from "@/components/org/shared/ui";

export function AiBar({ pct, color }: { pct: number; color?: string }) {
  return <MeterRow layout="inline" value={pct} display={`${pct}%`} color={color} meterClassName="w-24" />;
}
