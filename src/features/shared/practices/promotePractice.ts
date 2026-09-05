// G7-25: the mined-practice → authored-playbook hand-off. The Practice Library and the playbook author
// form were two disconnected surfaces: an org that had PROVEN a mined practice out across its fleet had
// to re-type it from scratch to make it a first-party standard. This is the mapping between them.
//
// Pure (no JSX, no hooks) so the field mapping and its bounds are unit-testable, and so the draft
// respects the SAME limits `createPlaybook` enforces server-side (src/lib/db/playbooks.ts: single-line
// title ≤200, summary ≤1000, ≤20 steps of ≤300 chars). Producing a draft the server would silently
// truncate is how a "promote" quietly loses the last three steps of a checklist.

import type { OrgPractice } from "@/lib/db";

/** The prefill handed to the author form — exactly the shape `POST /api/org/playbooks` accepts. */
export interface PlaybookDraft {
  title: string;
  dimId: string;
  summary: string;
  steps: string[];
}

const TITLE_MAX = 200;
const SUMMARY_MAX = 1000;
const STEPS_MAX = 20;
const STEP_MAX = 300;

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/**
 * Seed a playbook draft from a mined practice.
 *
 * - `title` keeps the practice's own label — the org already recognises it by that name, and renaming
 *   at promotion time would break the mental link to the ledger row it came from.
 * - `summary` is the practice's "what" plus, when there is one, the EXEMPLAR repo. The exemplar is the
 *   whole reason this practice is worth promoting ("we already do this well in X"), and it is the one
 *   fact the author form has no other way to recover once the modal is open.
 * - `steps` are the practice's leak-free reusable starter, which is exactly what a playbook's checklist
 *   is: `playbookStarterFile` renders each step as one `- [ ]` line, hence the single-line coercion.
 */
export function practiceToPlaybookDraft(p: OrgPractice): PlaybookDraft {
  const summary = [p.what, p.exemplar ? `Proven in ${p.exemplar.fullName} (${p.exemplar.score}/100).` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    title: oneLine(p.label).slice(0, TITLE_MAX),
    dimId: p.dimId,
    summary: summary.trim().slice(0, SUMMARY_MAX),
    steps: p.starter
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => oneLine(s).slice(0, STEP_MAX))
      .slice(0, STEPS_MAX),
  };
}
