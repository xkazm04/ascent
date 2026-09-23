// Pure model behind "Correct" on a Memory card. The store's contract is correct-by-supersede, never
// edit-in-place (docs/features/org-knowledge/memory.md), and a correction is a supersede aimed at ONE
// known row. Before this, the only way to arm a supersede target was the duplicate check's
// duplicates[0], which compares only the 50 newest rows of one namespace past an overlap floor, so an
// older or reworded memory could not be corrected from the product at all.
//
// No React and no server imports (`import type` is erased), so the hook and the card share it and a
// node test pins it.

import { EMPTY_FORM } from "@/features/shared/memory/memoryLibraryApi";
import type { CheckResponse } from "@/features/shared/memory/memoryCheck";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow } from "@/lib/db";
import { CONFIDENCE_BANDS, normalizeMemoryKind, normalizeMemoryVisibility } from "@/lib/org/memory-kinds";

export interface CorrectionDraft {
  form: MemoryFormState;
  supersedeId: string;
}

/** A human correction is the highest evidence grade (memory-governance), so it starts at High. */
const CORRECTION_CONFIDENCE = CONFIDENCE_BANDS.find((b) => b.id === "high")!.value;

/**
 * The author form prefilled from the row being corrected, with that row armed as the supersede target.
 * Content, kind, namespace, visibility and tags carry over (the corrector edits what is wrong, not what
 * is right); `source` starts blank because the provenance of a correction is the person making it, not
 * the pipeline or agent that wrote the original.
 */
export function correctionDraft(
  row: Pick<MemoryRow, "id" | "content" | "kind" | "namespace" | "visibility" | "tags" | "confidence">,
): CorrectionDraft {
  return {
    form: {
      ...EMPTY_FORM,
      content: row.content,
      kind: normalizeMemoryKind(row.kind),
      namespace: row.namespace,
      visibility: normalizeMemoryVisibility(row.visibility),
      tagsText: row.tags.join(", "),
      confidence: CORRECTION_CONFIDENCE,
      source: "",
    },
    supersedeId: row.id,
  };
}

/** Whether the card offers Correct: a hosted row the viewer can write. A registry mirror is changed by
 *  pull request (the server answers 409 registry-origin), so the card keeps "Open in registry". */
export function canCorrectMemory(row: Pick<MemoryRow, "origin">, canWrite: boolean): boolean {
  return canWrite && row.origin !== "registry";
}

/**
 * Which row a check verdict leaves armed. With a correction in progress the author already named the
 * target, so a verdict never re-aims it at a different row. Otherwise the check's own rule stands: only
 * a `supersede` recommendation pre-selects its strongest match; a merely related one arms nothing.
 */
export function supersedeAfterCheck(
  verdict: Pick<CheckResponse, "recommendation" | "duplicates">,
  correctingId: string | null,
): string | null {
  if (correctingId) return correctingId;
  return verdict.recommendation === "supersede" && verdict.duplicates[0] ? verdict.duplicates[0].id : null;
}
