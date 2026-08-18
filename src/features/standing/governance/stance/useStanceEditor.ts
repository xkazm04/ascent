"use client";

// State/handlers for the AI-stance editor, extracted from StanceEditor.tsx (the same split
// GatePolicyEditor keeps with useGatePolicyEditor). Owns no JSX. The pure form↔stance codecs are
// exported for their unit test; the SERVER's sanitizeStance remains the authority — the form is
// re-seeded from the server's echoed row after every save, never from the request.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AiStance, AiStanceZone, AutonomyTierId } from "@/lib/types";

export interface ZoneForm {
  repoGlobs: string;
  pathGlobs: string;
  reason: string;
}

export const TIER_ORDER: AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

/** Comma/newline separated entry field → trimmed list (the form's list codec). */
export function parseList(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Assemble the POST payload from form state. Empty pieces are omitted so the server's sanitizer
 *  sees the same shape a hand-written stance would carry. */
export function stanceFromForm(form: {
  tools: string;
  models: string;
  zones: ZoneForm[];
  reviews: Partial<Record<AutonomyTierId, string>>;
  requireTrailer: boolean;
  requireHumanApproval: boolean;
}): AiStance {
  return {
    permittedTools: parseList(form.tools),
    permittedModels: parseList(form.models),
    noAiZones: form.zones
      .map((z) => ({
        repoGlobs: parseList(z.repoGlobs),
        pathGlobs: parseList(z.pathGlobs),
        ...(z.reason.trim() ? { reason: z.reason.trim() } : {}),
      }))
      .filter((z) => z.repoGlobs.length > 0 || z.pathGlobs.length > 0),
    reviewTiers: TIER_ORDER.flatMap((tier) => {
      const review = form.reviews[tier]?.trim();
      return review ? [{ tier, review }] : [];
    }),
    provenance: { requireTrailer: form.requireTrailer, requireHumanApproval: form.requireHumanApproval },
  };
}

/** Seed form state from a stored stance (draft or active), or blank when none exists. */
export function formFromStance(stance: AiStance | null): {
  tools: string;
  models: string;
  zones: ZoneForm[];
  reviews: Partial<Record<AutonomyTierId, string>>;
} {
  const zoneToForm = (z: AiStanceZone): ZoneForm => ({
    repoGlobs: z.repoGlobs.join(", "),
    pathGlobs: z.pathGlobs.join(", "),
    reason: z.reason ?? "",
  });
  return {
    tools: stance?.permittedTools.join("\n") ?? "",
    models: stance?.permittedModels.join("\n") ?? "",
    zones: stance?.noAiZones.map(zoneToForm) ?? [],
    reviews: Object.fromEntries((stance?.reviewTiers ?? []).map((t) => [t.tier, t.review])),
  };
}

export function useStanceEditor(org: string, initial: AiStance | null, nextVersion: number) {
  const router = useRouter();
  const seed = formFromStance(initial);
  const [tools, setTools] = useState(seed.tools);
  const [models, setModels] = useState(seed.models);
  const [zones, setZones] = useState<ZoneForm[]>(seed.zones);
  const [reviews, setReviews] = useState<Partial<Record<AutonomyTierId, string>>>(seed.reviews);
  const [requireTrailer, setRequireTrailer] = useState(Boolean(initial?.provenance.requireTrailer));
  const [requireHumanApproval, setRequireHumanApproval] = useState(Boolean(initial?.provenance.requireHumanApproval));
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);

  function syncForm(stance: AiStance) {
    const f = formFromStance(stance);
    setTools(f.tools);
    setModels(f.models);
    setZones(f.zones);
    setReviews(f.reviews);
    setRequireTrailer(stance.provenance.requireTrailer);
    setRequireHumanApproval(stance.provenance.requireHumanApproval);
  }

  async function post(action: "draft" | "publish") {
    setBusy(action);
    setMsg(null);
    try {
      const stance = stanceFromForm({ tools, models, zones, reviews, requireTrailer, requireHumanApproval });
      const res = await fetch("/api/org/ai-stance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, action, stance }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; stance?: { version: number; stance: AiStance } };
      if (!res.ok) throw new Error(d.error ?? "Failed to save the stance.");
      // Re-seed from the server's echo (the stored, sanitized stance) — never from the request.
      if (d.stance) syncForm(d.stance.stance);
      setMsg({
        kind: "note",
        text:
          action === "publish"
            ? `Published v${d.stance?.version ?? nextVersion}. The fleet readout now evaluates against it.`
            : `Draft saved (will publish as v${d.stance?.version ?? nextVersion}).`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to save the stance." });
    } finally {
      setBusy(null);
    }
  }

  return {
    tools,
    setTools,
    models,
    setModels,
    zones,
    setZone: (i: number, patch: Partial<ZoneForm>) =>
      setZones((prev) => prev.map((z, j) => (j === i ? { ...z, ...patch } : z))),
    addZone: () => setZones((prev) => [...prev, { repoGlobs: "", pathGlobs: "", reason: "" }]),
    removeZone: (i: number) => setZones((prev) => prev.filter((_, j) => j !== i)),
    reviews,
    setReview: (tier: AutonomyTierId, value: string) => setReviews((prev) => ({ ...prev, [tier]: value })),
    requireTrailer,
    setRequireTrailer,
    requireHumanApproval,
    setRequireHumanApproval,
    busy,
    msg,
    saveDraft: () => post("draft"),
    publish: () => post("publish"),
  };
}
