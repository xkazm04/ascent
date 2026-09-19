import { Kicker } from "@/components/ui";
import type { PracticePreviewShape } from "./practiceApplyShared";

/**
 * One-line provenance for a practice preview. "House pattern from 3 exemplars" and
 * "Generic starter (no mined pattern yet)" are different claims; the generate payload's
 * `shape` is which one this preview actually is.
 */

export function practicePreviewKicker(shape: PracticePreviewShape): string {
  return shape.kind === "house"
    ? `House pattern from ${shape.exemplars} exemplars`
    : "Generic starter (no mined pattern yet)";
}

export function previewShapeFromPayload(data: unknown): PracticePreviewShape {
  if (!data || typeof data !== "object") return { kind: "generic" };
  const raw = (data as { shape?: unknown }).shape;
  if (!raw || typeof raw !== "object") return { kind: "generic" };
  const rec = raw as { kind?: unknown; exemplars?: unknown };
  if (rec.kind !== "house") return { kind: "generic" };
  const n = rec.exemplars;
  const exemplars = typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return { kind: "house", exemplars };
}

export function PracticePreviewKicker({ shape }: { shape: PracticePreviewShape }) {
  return (
    <p data-testid="practice-preview-shape">
      <Kicker tone="muted" as="span">
        {practicePreviewKicker(shape)}
      </Kicker>
    </p>
  );
}
