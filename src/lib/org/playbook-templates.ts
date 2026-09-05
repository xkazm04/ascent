// Starter playbook templates (PLAY-4) so authoring a company standard isn't a blank form. Seeded from
// the same leak-free practice starters the derived Practice Library uses (PRACTICES) — one per
// dimension — so the templates can't drift from the rubric. The author edits from there. Pure +
// client-safe (PRACTICES only imports a type), so PlaybooksPanel can prefill its form inline.

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
