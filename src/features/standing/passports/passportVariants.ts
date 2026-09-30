"use client";

// The four prototype views, and the one piece of state that picks among them. Both compositions call
// this hook so the default (Baseline) and the labels cannot drift.
import { useState } from "react";

export type PassportVariantId = "baseline" | "clearance" | "capabilities" | "controls";

// Doctor checks is a sibling of Capabilities, not folded into it: Capabilities is what the repo
// declares, Doctor checks is what its own CI judged. "Controls" collided with Security's D9 battery
// and Governance's ledger (MC-B10), so this view is named for its source.
export const PASSPORT_VARIANTS: { id: PassportVariantId; label: string; note: string }[] = [
  { id: "baseline", label: "Baseline", note: "current automation × production portfolio" },
  { id: "clearance", label: "Clearance", note: "the passport as a security clearance, per repo" },
  { id: "capabilities", label: "Capabilities", note: "what each repo declares, and what its own doctor proved" },
  { id: "controls", label: "Doctor checks", note: "per-check doctor findings, reported by each repo's own CI" },
];

export function usePassportVariant() {
  return useState<PassportVariantId>("baseline");
}
