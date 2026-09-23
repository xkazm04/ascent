"use client";

// The correction half of useMemoryLibrary: which row the author form is correcting, and the two actions
// that start and cancel it. Co-located rather than inlined for the 200-LOC src/features cap; the form,
// verdict and supersede state stay in useMemoryLibrary and are driven through the setters passed in.

import { useState, type Dispatch, type SetStateAction } from "react";
import type { CheckResponse } from "@/features/shared/memory/memoryCheck";
import { correctionDraft, supersedeAfterCheck } from "@/features/shared/memory/memoryCorrectionModel";
import type { MemoryFormState } from "@/features/shared/memory/MemoryTypes";
import type { MemoryRow } from "@/lib/db";

export function useMemoryCorrection(
  emptyForm: MemoryFormState,
  lib: {
    setFormState: Dispatch<SetStateAction<MemoryFormState>>;
    setSupersedeId: Dispatch<SetStateAction<string | null>>;
    setVerdict: Dispatch<SetStateAction<CheckResponse | null>>;
    /** Abort a running duplicate check: its verdict would land on the new draft. */
    cancelCheck: () => void;
  },
) {
  const [correcting, setCorrecting] = useState<MemoryRow | null>(null);

  /** Load `row` into the author form with it armed as the supersede target. No model call. */
  function startCorrection(row: MemoryRow) {
    lib.cancelCheck();
    const draft = correctionDraft(row);
    setCorrecting(row);
    lib.setFormState(draft.form);
    lib.setSupersedeId(draft.supersedeId);
    lib.setVerdict(null);
  }

  /** Back to an empty form with nothing armed. */
  function cancelCorrection() {
    lib.cancelCheck();
    setCorrecting(null);
    lib.setFormState(emptyForm);
    lib.setSupersedeId(null);
    lib.setVerdict(null);
  }

  return {
    correcting,
    startCorrection,
    cancelCorrection,
    /** After a save: the correction is done, the form is reset by the caller. */
    endCorrection: () => setCorrecting(null),
    /** The row a check verdict (or its dismissal) leaves armed. */
    armedAfter: (verdict: CheckResponse | null) =>
      verdict ? supersedeAfterCheck(verdict, correcting?.id ?? null) : (correcting?.id ?? null),
  };
}
