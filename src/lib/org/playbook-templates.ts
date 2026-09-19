// Starter playbook templates (PLAY-4) so authoring a company standard isn't a blank form. Seeded from
// the same leak-free practice starters the derived Practice Library uses (PRACTICES) — one per
// dimension — so the templates can't drift from the rubric. The author edits from there. Pure +
// client-safe (PRACTICES only imports a type), so PlaybooksPanel can prefill its form inline.
//
// POST /api/org/playbooks also seeds from these: `fromDim` picks a row, `fromRec` uses the briefing's
// ranked next move (title + dim) and THIS checklist. Steps are never invented (G4).

import { PRACTICES } from "@/lib/practices";

export interface PlaybookTemplate {
  title: string;
  dimId: string;
  summary: string;
  steps: string[];
}

export const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = PRACTICES.map((p) => ({
  title: p.label,
  dimId: p.dimId,
  summary: p.what,
  steps: p.starter,
}));

export type PlaybookSeed = {
  title: string;
  dimId: string;
  summary: string;
  steps: string[];
};

export type PlaybookCreateBody = {
  title?: string;
  dimId?: string;
  summary?: string;
  steps?: string[];
  fromDim?: string;
  fromRec?: boolean;
};

/** The leak-free starter for one dimension, or null when the id is not on the spine. */
export function playbookTemplateForDim(dimId: string): PlaybookTemplate | null {
  return PLAYBOOK_TEMPLATES.find((t) => t.dimId === dimId) ?? null;
}

function applyOver(t: PlaybookTemplate, over: { title?: string; summary?: string; steps?: string[] }): PlaybookSeed {
  return {
    title: over.title?.trim() || t.title,
    dimId: t.dimId,
    summary: over.summary?.trim() ? over.summary : t.summary,
    steps: Array.isArray(over.steps) && over.steps.length > 0 ? over.steps : t.steps,
  };
}

/**
 * Prefill a create payload from a dimension template (and, when `fromRec` is set, from the ranked
 * next-move rec). Explicit title/summary/steps win when non-empty so an author can edit first.
 * `rec` is null when the briefing has no qualifying move — callers must not fabricate one.
 */
export function seedPlaybookCreate(
  body: PlaybookCreateBody,
  rec: { title: string; dimId: string } | null = null,
): { ok: true; input: PlaybookSeed } | { ok: false; error: string } {
  const over = {
    title: body.title,
    summary: body.summary,
    steps: Array.isArray(body.steps) ? body.steps : undefined,
  };

  if (body.fromRec) {
    if (!rec) return { ok: false, error: "No ranked next move to seed from." };
    const t = playbookTemplateForDim(rec.dimId);
    if (!t) return { ok: false, error: "dimId must be D1..D9." };
    // Rec title is the move the briefing named; steps stay the template (never rec.explore).
    return { ok: true, input: applyOver(t, { ...over, title: over.title?.trim() || rec.title }) };
  }

  if (body.fromDim) {
    const t = playbookTemplateForDim(body.fromDim);
    if (!t) return { ok: false, error: "dimId must be D1..D9." };
    return { ok: true, input: applyOver(t, over) };
  }

  const title = body.title?.trim() ?? "";
  const dimId = body.dimId ?? "";
  if (!title || !dimId) return { ok: false, error: "Provide { org, title, dimId }." };
  return {
    ok: true,
    input: {
      title,
      dimId,
      summary: body.summary ?? "",
      steps: Array.isArray(body.steps) ? body.steps : [],
    },
  };
}
