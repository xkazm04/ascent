# Org Knowledge & Skills

Shared org memory and the skills library — the parts of ascent that accumulate
across sessions rather than being recomputed per scan.

Context-map group: **Org Knowledge & Skills** (`feature`).

| Doc | Covers | Freshness |
| --- | --- | --- |
| [memory.md](memory.md) | Memory kinds, create/check/recall/reflect/decay, scoring and budget packing | CURRENT |
| [skills.md](skills.md) | Registry, promote/adopt/push, dormancy, telemetry, org API tokens | CURRENT |

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Org Memory | `/org/[slug]/memory`, `/api/org/memory[/check,/recall,/reflect]` | `src/lib/memory/**`, `src/lib/db/org-memory.ts`, `org-memory-lifecycle.ts`, `src/components/org/Memory*.tsx` |
| Skills Registry | `/org/[slug]/skills`, `/api/org/skills*` | `src/lib/org/skill-*.ts`, `src/lib/db/org-skills.ts`, `src/components/org/skills/**` |
| API Tokens | `/api/org/tokens` | `src/lib/api-token-auth.ts`, `src/lib/db/org-api-tokens.ts` |

Backing models: `OrgMemory`, `OrgSkill`, `OrgSkillAdoption`, `OrgSkillDownload`,
`OrgSkillEvent`, `OrgApiToken`, `SkillGeneration`.

Both surfaces are tier-gated — `planAllowsMemory` and `planAllowsSkillsLibrary` in
`src/lib/plans.ts` (Team and above; see [`../billing/billing.md`](../billing/billing.md)).

## Known gaps

Carried up from the per-doc "Known gaps"; each was verified as *unresolved* rather
than assumed:

- **Reflect may not be reachable from the UI.** The `/api/org/memory/reflect`
  endpoint is implemented, but no wiring to it was found in the memory components —
  it may currently be API-only.
- **Decay has no scheduled trigger.** Auto-archive runs only as a side effect of a
  reflect call with `decay: true`; no cron drives it.
- `OrgSkillEvent.source` documents a `cli|hook|ci|web` convention that is not
  enum-validated in code.
- The relationship between the `SkillGeneration` model and a `skill-history.ts`
  module referenced in a source comment is unresolved.
