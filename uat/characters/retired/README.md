# Retired Characters

Characters in this folder are **out of the active roster**. `/uat run` enumerates
`uat/characters/*.md`, so a Character parked one level down is not scored, not scheduled, and not
counted in a run's coverage — without being deleted.

## Why a retired lane instead of `git rm`

A Character is the durable IP of this overlay: a real role, grounded in cited external research,
with a time-saved baseline and a senior-quality bar that took a research pass to establish. When the
*product* drops a surface, that research does not become wrong — it becomes unattached. Deleting it
throws away the expensive half (the grounding) to remove the cheap half (the route list), and the
next person to build a comparable surface writes a weaker version of the same Character from
scratch.

Keeping them here also keeps the historical runs honest: `uat/runs/**` contains scored journals for
these Characters, and a reader who follows a finding back to its author must be able to find them.

## The rule

- A retired file carries `promotion: retired` (the vocabulary the template already declares),
  plus `retired: <date>` and `retired_reason:` in its frontmatter, plus a blockquote at the top stating **what is preserved**, **what is now false**,
  and **what would have to change to un-retire it**. Everything below that blockquote is the
  original Character, unedited — it is a record, not a draft.
- Never score a retired Character. If a run needs one back, un-retire it deliberately: rewrite the
  parts its blockquote names, drop the retirement frontmatter and the blockquote, and `git mv` it
  up one level.
- Retiring is not the same as a Character who simply found nothing. A Character is retired when the
  **product surface their job-to-be-done depends on no longer exists**.

## Roster

| Character | Retired | Why |
| --- | --- | --- |
| [Mei (OSS Maintainer)](mei-oss-maintainer.md) | 2026-08-29 | Her central job — the README maturity badge — was removed from the product. Her PR-gate job survives and is the natural seed for a narrower successor. |
| [Kenji (OSS foundation steward)](kenji-oss-foundation.md) | 2026-08-29 | His recurring loop was *re-scan the portfolio, refresh the badges*; the badge half is gone, so his time-saved arithmetic overstates what ships today. His monetization read ("where is the meter?") is still sharp and can carry over. |
