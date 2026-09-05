# 17 — Work-time registry over MCP: skills, governing subjects, invoke/citation write-back

size XL · effort 7 / impact 9 / risk 6 · gate **policy** · lane **W2-K** · wave **2**

## Premise check (verified against the tree, 2026-08-29)

Held: `MCP_TOOLS` is six read tools, header "READ-ONLY, DELIBERATELY" (`src/lib/mcp/tools.ts`);
`recallMemory` is a plain term overlap (`src/lib/mcp/handlers.ts`); `recall.ts`'s header still says a
citation counter "needs a schema column this module cannot add"; `POST /api/mcp` checks only
`mcp:read` and carries no plan gate; `grounding.ts` names the missing gate and refuses to fix another
door; `telemetry:write` is already a minted scope (`SKILL_TOKEN_SCOPES`); `OrgSkill` carries
`registryPath` / `registryVersion` / `registryHash` / `content`.

**FALSE — `applicability` is a type with no producer and no store.** `CatalogSkillEntry.applicability`
/ `adopters` / `invokes30d` exist only as an interface in `src/lib/registry/catalog.ts`; `grep
applicability src --include=*.ts` returns that one declaration. `recordIndexResult` persists counts,
`usageInvokes30d`, `usageContributors` and `bundlesJson` — no per-skill applicability, and
`org-registry-write.ts` drops `bySkill` (a known defect on the same backlog). So `find_skills` cannot
rank "against the repo's sub-band dims" from stored applicability. Redesigned below: ranking is built
from what IS persisted (category, tags, name/description, adoptions, downloads) plus a **declared,
stated** category→dimension affinity map, with the basis emitted in every result.

**FALSE — `OrgSkillEvent.type = "invoke"` is not merely unproduced, it was retired** (schema comment:
"`invoke` retired 2026-07-29 — it had no producer anywhere"). W1-D (#19) re-introduces it; this lane
is its second producer, not its first.

**Partly false — bundle subjects are not mirrored.** `readBundles` reads `meta` counts only
(`index-registry.ts`); nothing stores `subjects[slug].file` or `use_when`. `get_governing_subject`
therefore reads `OrgKnowledgeSubject`, which **W1-D lands in wave 1** (#18) — a hard precondition,
declared below.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/mcp/tools.ts` — 7 new tool defs, `mutates` marker, header rewrite.
- `src/lib/mcp/handlers.ts` — new handlers; `recallMemory` gains `id` per entry + delivery recording.
- `src/app/api/mcp/route.ts` — plan gates, write-scope enforcement, audit, per-token write ceiling.
- `src/lib/memory/recall.ts` — citation term (score v2) + header rewrite (deletes its own stated gap).
- `src/lib/athena/grounding.ts` — expose the new read tools, drop every `mutates` tool, neutralize +
  `wrapUntrusted` skill/lesson/subject bodies (today only recall is wrapped).
- `src/lib/mcp/tools.test.ts`, `src/app/api/mcp/route.test.ts`, `src/lib/memory/recall.test.ts`,
  `src/lib/athena/grounding.test.ts`.
- `docs/features/org-knowledge/skills.md` (MCP section), `docs/features/companion/README.md`.

**Files to create**
- `src/lib/mcp/skill-match.ts` — pure ranking (`rankSkills`) + `CATEGORY_DIMENSIONS`.
- `src/lib/mcp/write-gate.ts` — `WRITE_TOOL_POLICY` + `assertWriteAllowed` (**the extension seam
  W4-N #3 adds rows to**).
- `src/lib/mcp/registry-reads.ts` — skill/lesson/subject projections for the handlers.
- `src/app/api/mcp/gates.ts` — `resolveMcpGates(org)` (mirrors `resolveAthenaGates`, adds skills).
- `src/lib/db/org-memory-citations.ts` — citation writes/reads (only new db module this lane needs).
- Tests: `src/lib/mcp/skill-match.test.ts`, `src/lib/mcp/write-gate.test.ts`,
  `src/lib/mcp/handlers.registry.test.ts`, `src/lib/db/org-memory-citations.test.ts`.

**Prisma (landed by the wave-2 schema pass, never by this lane)**
- `model OrgMemoryCitation { id String @id @default(uuid()) · orgId String · memoryId String ·
  tokenId String? · actor String · sessionId String · used Boolean · note String? ·
  source String @default("mcp") · createdAt DateTime @default(now()) ·
  @@unique([memoryId, sessionId]) · @@index([orgId, createdAt]) · @@index([memoryId, used]) }`
- `OrgMemory.citedCount Int @default(0)`, `OrgMemory.notUsefulCount Int @default(0)`.
- `OrgSkillEvent.type` comment amended: `download | sync | invoke` (un-retire, W1-D is first producer).
- `prisma/init.sql` + the PGlite reconcile for all of the above; `wire-safe-dates.test.ts` gains
  `MemoryCitationRow` (its `createdAt` is `string`).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: re-export `recordMemoryCitation`, `citationCountsFor`,
  `type MemoryCitationRow` from `@/lib/db/org-memory-citations`.
- `context-map.json` → MCP Server context `filePaths`: the five new `src/lib/mcp/*` and
  `src/app/api/mcp/gates.ts` files (+ their tests); Entry Points gains `src/lib/mcp/write-gate.ts`.
- `scripts/docs/feature-doc-map.json`: **no change** — `src/lib/mcp/**` and `src/app/api/mcp/**`
  already map to `docs/features/org-knowledge/skills.md`.

**MUST NOT TOUCH** — `src/lib/registry/**`, `src/lib/db/org-registry*.ts`, `src/lib/org/skill-*.ts`
(all W1-D); `src/lib/report/{compare,exemplar}.ts` (W2-J1); `src/lib/org/followups.ts`,
`src/lib/local/loop-lane.ts` (W4-N); `src/lib/db/retention.ts` (W1-F); `prisma/**`,
`src/lib/db/index.ts`, `context-map.json`, `feature-doc-map.json` (Class B / Director).

**Handoffs to other lanes**
1. **W1-D (#18)** — export from its registry read module: `listOrgKnowledgeSubjects(orgSlug): Promise<
   { bundle, slug, title, file, useWhen: string[], summary: string|null }[] | null>` (null = no
   registry mapped) and `registryBlobUrl(orgSlug, path): Promise<string|null>`. Without these,
   `get_governing_subject` ships in absence-only form (step 6 below is the seam).
2. **W1-D (#19)** — add `"mcp"` to the validated `OrgSkillEvent.source` set; this lane is a producer.
3. **W1-D (#36)** — export `listSkillLessons(orgSlug, skillName)` for `get_skill_lessons`.
4. **W2-J1 (#34)** — export `exemplarDiff(org, repo, opts): Promise<ExemplarDiff | null>` from
   `src/lib/report/exemplar.ts`. `compare_against_exemplar` is built in step 8 **only after J1 merges**;
   if J1 slips, K stops at step 7 and the tool follows in the next wave.
5. **W1-F / Director (#32 retention)** — `eraseOrgData` must delete `OrgMemoryCitation` rows *before*
   `OrgMemory`; the purge path must include them in its counted preview. Requested as a Director line
   at wave-2 merge since `retention.ts` is outside this write set.

## Goal

Make the org's own registry — its skills, its governing subjects, its remembered decisions — readable
by any agent at the moment it decides how to write the next change, and make that agent able to tell
ascent what it actually *used*, through an audited, plan-gated, scope-gated write door. Competitive
angle: generic MCP servers are commodity; no vendor serves an org's **own** curated standard to any
agent through one neutral door and gets use-evidence back.

**Known gaps this deletes**
- `docs/features/companion/README.md:711` — "The MCP door still has no memory plan gate."
- `docs/features/companion/README.md:286` — the paragraph asserting the MCP door does not plan-gate
  memory ("that is a separate finding … not fixed here"). Rewritten to state the gate now exists on
  both doors, with Athena still the stricter (she also refuses the write tools).
- `docs/features/org-knowledge/skills.md` "What it deliberately does not do → **Read-only.**" — replaced
  by the write-door contract, not by silence.
- `src/lib/memory/recall.ts` header — "needs a schema column this module cannot add" (the column landed).
- `src/lib/athena/grounding.ts:19-24` — the "NOT fixed here" block becomes a pointer to the shipped gate.

## Behaviour

### Catalog (13 tools; `MCP_TOOLS` stays alphabetical — `tools.test.ts` asserts it)

| Tool | Scopes | Plan gate | Answers |
| --- | --- | --- | --- |
| `cite_memory` | `mcp:read`+`memory:read`+`telemetry:write` | memory | Records that a delivered memory was (or was not) used |
| `compare_against_exemplar` | `mcp:read` | — | Signal-level diff vs a peer repo (step 8, from J1) |
| `find_skills` | `mcp:read`+`skills:read` | skills | Which of the org's skills apply to this task/repo |
| `get_governing_subject` | `mcp:read`+`skills:read` | skills | The registry subject whose `use_when` governs this path/topic |
| `get_skill` | `mcp:read`+`skills:read` | skills | One skill's SKILL.md body, version, hash, registry path |
| `get_skill_lessons` | `mcp:read`+`skills:read` | skills | Lessons recorded against a skill (#36) |
| `report_skill_invoke` | `mcp:read`+`skills:read`+`telemetry:write` | skills | The agent's own invoke report |
| *(the six shipped read tools, unchanged)* | | | |

`McpToolDef` gains `mutates?: true` and `planGate?: "memory" | "skills"`. Scope filtering
(`toolsForScopes`) is unchanged; plan filtering is a second, route-resolved pass.

### The door (`POST /api/mcp`)

1. Origin → rate limit → bearer → `mcp:read` (all unchanged).
2. **New:** `resolveMcpGates(orgSlug)` (`src/app/api/mcp/gates.ts`) — one `getCreditState` read, then
   `workspaceAllowsMemory(org, plan)` and `workspaceAllowsSkills(org, plan)`, both `.catch(() => false)`.
   `selfHosted()` already opens both through `plans.ts`, so a self-hosted install sees every tool.
3. `tools/list` returns `toolsForScopes(scopes)` minus tools whose `planGate` is closed.
4. `tools/call`: an out-of-scope or unknown tool keeps today's opaque `Unknown tool` error (the door
   must not be an oracle). A **plan-closed** tool is answered *explicitly* with the plan reason
   (`isError: true`, HTTP 200) — the caller holds this org's own token and is owed the reason.
5. `mutates` tools additionally run `assertWriteAllowed({ tool, scopes, gates, tokenId, counters })`
   from `src/lib/mcp/write-gate.ts`, then, on success, `recordOrgAudit(org, { action:
   "mcp.tool.write", actorId: \`token:${token.name}\`, meta: { tool, tokenId, args: <redacted digest>,
   outcome } })`. **No `RegistryToolAudit` table** (the dossier proposed one): `AuditLog` already has
   the org audit viewer, the retention purge and the integrity chain, and a second audit store would
   fork both. The deviation is deliberate and stated in the doc.
6. Org identity is taken **only** from the verified token (`token.orgSlug`) — never from arguments.
   There is no `[id]` route here, so `id-routes-gated` does not apply, but the same rule holds: the
   caller supplies a row id (`cite_memory.id`) and the query is constrained by the token's org, so a
   foreign id is simply not found (gate-then-constrain).

### `write-gate.ts` — the seam W4-N extends

```ts
export interface WriteToolPolicy {
  resourceScope: SkillTokenScope;            // beyond mcp:read + telemetry:write
  planGate: "memory" | "skills" | null;
  auditAction: string;                       // AuditLog action id
  perTokenDailyMax: number;                  // anti-inflation ceiling
  idempotencyKey: (org: string, args: Args) => string | null;
}
export const WRITE_TOOL_POLICY: Record<string, WriteToolPolicy>;   // 2 rows now; N adds its own
export function assertWriteAllowed(input: WriteGateInput): { denied: string } | null;
```

Adding a write tool is one policy row plus one handler — that is the extension contract for #3's
`claim_followup` / `report_work`, and this lane ships no lease/claim semantics of its own.

### Data / honesty rules

- `cite_memory{ id, used, session, note? }` → one `OrgMemoryCitation` row. **Idempotent** on
  `@@unique([memoryId, sessionId])`: a re-cite in the same session is an upsert, not a second vote.
  In the same transaction, `used === true` bumps `OrgMemory.citedCount`, `false` bumps
  `notUsefulCount`. Per-token ceiling `perTokenDailyMax: 200` — an aggressive agent cannot inflate
  recall. A `note` is capped at 500 chars and is org-authored text: it is **never** re-served without
  `neutralize`.
- `recall_org_memory` now returns each entry's `id` (required for citation) and records deliveries via
  `bumpMemoryAccessCounts(org, ids)`. The MCP door did not count deliveries at all before; it does now,
  so `accessCount` finally means the same thing on both doors.
- **Recall score v2** (`recall.ts`, still pure, still no `Date.now()`): `RecallCandidate.citedCount?:
  number` (optional — an absent value is *no evidence*, scored as 0, never as "not useful"). The
  delivery bonus keeps its shape but its cap drops; a new evidence term
  `min(MAX_EVIDENCE_BONUS, 1 + CITED_WEIGHT·ln(1 + citedCount))` sits beside it with
  `CITED_WEIGHT > ACCESS_BONUS_WEIGHT`, so proven use outranks delivery and the **combined ceiling does
  not rise**. The header's honest-limit paragraph is rewritten, not deleted: the term is still named
  for exactly what it measures (a self-reported citation), and the self-report limit is stated.
- `report_skill_invoke{ skill, session, version?, repo? }` → `OrgSkillEvent{ type: "invoke",
  source: "mcp", repo }`, deduped per (skill, session) in the handler. `version` is recorded only when
  it matches the mirror row's `registryVersion`; a mismatch is reported back to the agent as a stale
  local copy rather than silently accepted.
- `find_skills` (`rankSkills`, pure): plain term overlap over name/description/tags (the same
  discipline `recallMemory` states — no second, divergent relevance model), plus a category-affinity
  boost when the named repo's latest scan has sub-band dimensions, via a **declared** map
  `CATEGORY_DIMENSIONS` (`security → D9`, `ci-cd → D8`, `testing → D6`, `ai-native → D1/D2`, …). Every
  result carries `why: string[]` and the response carries `dimensionBasis`, which is **null with a
  sentence** when the repo is unscanned or absent — never a zeroed dimension list. `registryPath` and
  `registryVersion` ride along so the agent can open the source of truth.
- `get_governing_subject{ path?, topic? }` resolves through the mirrored `file` column — **never by
  building a path from a slug** (the registry access contract). No registry mapped → explicit refusal
  ("no AI registry is mapped to this organization"), not an empty list.

### UI, self-hosted, privacy

No new UI surface. (Citation counts belong on the Memory tab's `sort=recalls` strip — that is W1-D/#36
territory and is deliberately left out.) `selfHosted()` opens both plan gates through `plans.ts`, so a
self-hosted install reaches every tool with a locally minted token. No aggregate crosses an org
boundary, so `CHAMPION_MIN_POP` does not bind; citations are per-org and are erased with the org.
Guardrails: nothing here touches scoring, the guardband or D9 (**G5**), and every absence is answered
in words rather than a fabricated zero (**G4**).

## Build order

1. **Plan gates at the door.** `src/app/api/mcp/gates.ts` + route wiring; `tools/list` filtering and
   the stated plan refusal on `tools/call`. Lands and gates alone; closes the companion README gap.
2. **`write-gate.ts` + the `mutates` marker**, with zero write tools registered yet — the seam and its
   tests land before anything can use them.
3. **`report_skill_invoke`** — first write tool: policy row, handler, `OrgSkillEvent` write, audit row.
4. **`cite_memory` + `org-memory-citations.ts`** — citation table writes, idempotent upsert,
   denormalized counter bumps, daily ceiling.
5. **Recall score v2** — `citedCount` threaded into `RecallCandidate`, the evidence term, the header
   rewrite; `recallMemory` returns ids and records deliveries.
6. **`find_skills` / `get_skill` / `get_skill_lessons`** — `skill-match.ts` + `registry-reads.ts` over
   `listOrgSkills` and the mirror columns; lessons behind handoff 3, absence-answering if it slips.
7. **`get_governing_subject`** — over `OrgKnowledgeSubject` (handoff 1), with the no-registry refusal
   path first so the tool is honest before it is useful.
8. **`compare_against_exemplar`** — thin projection of J1's `exemplarDiff`. **Conditional on J1 merged.**
9. **Athena + docs** — grounding exposes the new read tools, drops every `mutates` tool, wraps skill /
   lesson / subject bodies in `wrapUntrusted`; skills.md MCP section and companion README rewritten,
   the four known gaps deleted.

## Tests

- `src/lib/mcp/tools.test.ts` (extend): alphabetical order still holds with 13 tools; every `mutates`
  tool declares `telemetry:write`; no non-`mutates` tool declares it. **Fail-before:** add
  `report_skill_invoke` without `telemetry:write` → the scope assertion fails.
- `src/lib/mcp/write-gate.test.ts` (new): a token with `mcp:read`+`telemetry:write` but no
  `memory:read` is denied `cite_memory`; the daily ceiling denies the 201st write; every
  `WRITE_TOOL_POLICY` key exists in `MCP_TOOLS` and is marked `mutates` (structural).
- `src/app/api/mcp/route.test.ts` (extend): plan-closed memory → `recall_org_memory` absent from
  `tools/list` **and** a direct call answered with the stated reason; a `mutates` call writes exactly
  one `AuditLog` row; a scope-denied tool still returns the opaque `Unknown tool`. **Fail-before:**
  remove the gate call → a free-plan token reaches memory (this is the shipped bug).
- `src/lib/mcp/skill-match.test.ts` (new): ranking is deterministic and tie-breaks stably; an unscanned
  repo yields `dimensionBasis: null` and no dimension term. **Fail-before:** default `weakDims` to `[]`
  → the assertion that null is not `[]` fails.
- `src/lib/db/org-memory-citations.test.ts` (new): re-citing the same (memory, session) upserts and does
  not double-bump `citedCount`; a foreign-org `memoryId` writes nothing.
- `src/lib/memory/recall.test.ts` (extend): a memory with citations outranks one with equal deliveries
  and none; the combined bonus ceiling is unchanged from r-current. **Fail-before:** drop
  `MAX_EVIDENCE_BONUS` → the ceiling assertion fails.
- `src/lib/athena/grounding.test.ts` (extend): no `mutates` tool appears in `athenaToolCatalog`;
  a `get_skill` result is wrapped in the untrusted fence.
- Structural guards touched: `wire-safe-dates.test.ts` (`MemoryCitationRow`, Director-landed);
  `id-routes-gated` untouched (no `[id]` route); doc-sync satisfied by skills.md + companion README.
- Character journey: **Sam** (staff engineer) — point an agent at the door with a
  `mcp:read`+`skills:read`+`telemetry:write` token, ask "which of our skills applies to this file and
  what governs it", then have it report the invoke and cite the memory it used; the Skills tab shows an
  `invoke` event with `source: mcp` and the memory's cited count rises. Dana/Tomáš journeys unaffected.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (no `.tsx`
touched; every new `src/lib/mcp/*` file under 300 and, being outside `src/features/**`, not bound by
200 — keep each under 200 anyway). Done when: all 13 tools list and dispatch under the right scopes and
plan gates; every write produces exactly one audit row and is idempotent under replay; recall scores
move on citations without raising the ceiling; the four named known gaps are deleted in the same PR.

## Out of scope (explicitly)

- **#3 Agent-neutral work protocol (W4-N, accepted, wave 4)** — claim/lease/report of follow-ups. This
  lane ships the *door* (write scopes, plan gates, audit, the `WRITE_TOOL_POLICY` seam) and no claim
  semantics, no `FollowupClaim`, no lease columns.
- **#34 Exemplar diff (W2-J1)** — the diff engine is J1's; only the tool wrapper is here (step 8).
- **#18/#19/#36 (W1-D)** — subject mirroring, the invoke *channel*, the lessons store. This lane is a
  consumer and a second producer, never their owner.
- **#20 Athena as registry curator (deferred)** — no PR-proposing action, no write tool for Athena; she
  is explicitly denied every `mutates` tool.
- **#2 open benchmark corpus, #7 AI Trust Center, #23 agent behaviour ledger, #22 developer credential
  lane (concept-doc first)** — no cross-org aggregate, no public surface, no OTLP ingest, no
  user-to-server token path.
- **#6 signed attestation, #21 identity graph, #24 billing account (deferred)** — no DSSE over tool
  results, no team-scoped tokens, no per-call metering.
- OAuth 2.1 resource-server conformance stays out; the door remains honest bearer auth with a
  `WWW-Authenticate` challenge, and the doc keeps saying so.
