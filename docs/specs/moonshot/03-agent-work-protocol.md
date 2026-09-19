# 03 — Agent-neutral work protocol: claim / brief / report over MCP + tokens

XL · effort 8 · impact 9 · risk 6 · gate **policy** · lane **W4-N** · wave **4** (runs alone, after
W2-G and W2-K have merged)

## Premise check (verified against the tree, 2026-08-29)

| Dossier claim | Verdict |
| --- | --- |
| `runClaudeAgent` spawns `claude -p`; the loop is `selfHosted()` + `ASCENT_AUTOPILOT` only | **holds** — `spawn(bin, ["-p", …, "--permission-mode", "acceptEdits", …])` in `local/agent.ts`; `startLoopRun` throws on both guards. |
| MCP catalog is six read tools, "READ-ONLY, DELIBERATELY" | **holds** — `MCP_TOOLS` has exactly six entries, all `mcp:read` (+`memory:read` on recall). |
| `handoff` route is session-only; `api-token-auth.ts` models scoped machine tokens | **holds** — `requireOrgAccess` only on that route; `authorizeOrgApi` + `OrgApiPrincipal` exist but are not wired to it, and `SKILL_TOKEN_SCOPES` has no write scope for follow-ups. |
| The claim/release discipline is already precise | **holds** — `runLane`'s `claimedIds` / `releaseClaims` block and `decideInProgress`. |
| `LoopRunLane.executor` exists | **FALSE** — the model has no `executor`, `claimedBy` or `leaseUntil`; all three are new columns. |
| "`LoopRun.phase='curating'` finally used" | **half false** — `curating` is the schema default and `getActiveLoopRun` reads it, but **no code path ever writes a row in it** (`live.md` §Known gaps says so). This spec is what first writes one. |
| `AiStanceReviewTier` can decide who may claim | **partly false as stated** — `reviewTiers` is free text per tier on the *org* stance, not an authorization value. The authorizable value is the **repo's derived autonomy tier** (`StanceRepoFacts.autonomyTier`, from `passport.autonomy.tier`). The gate is built on that, with `reviewTiers[tier].review` carried into the brief as text. |
| Ledger has no lease anywhere | **holds** — a claim is `status: "in_progress"` with no owner and no expiry; `runLane`'s zombie-release exists precisely because nothing expires. |

Nothing here is already built. Redesign needed only for the last two rows (recorded above).

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/db/org-api-tokens.ts` — add `followups:write` to `SKILL_TOKEN_SCOPES`.
- `src/lib/api-token-auth.ts` — `authorizeOrgCapability(request, org, {scope, mode})`: the existing
  `authorizeOrgApi` plus an `executor` discriminator on the token principal (`agent:<token name>`).
- `src/lib/org/followups.ts` — pure additions only: `LeaseState`, `leaseExpired`, `claimability`,
  `buildAgentBrief` (wraps `buildFixPrompt` with the context block), `ATTEMPT_VERDICTS`.
- `src/lib/mcp/tools.ts` — three new catalog entries (alphabetical order is load-bearing).
- `src/lib/mcp/handlers.ts` — three handlers + their `runTool` cases; `runTool` gains a `principal`
  argument (write tools need the actor and the scopes; reads ignore it).
- `src/app/api/mcp/route.ts` — pass the verified token into `runTool`; keep `mcp:read` as the door.
- `src/lib/local/loop-lane.ts` — replace the inline claim/release block with the shared claim path.
- `src/app/api/org/loop/route.ts` — accept `executor: "local" | "remote-agent"`; the self-hosted +
  autopilot guards apply to `local` only.
- `src/lib/local/loop-engine.ts` — `startRemoteRun` beside `startLoopRun` (no worktree, no process).
- `src/lib/db/loop-runs-types.ts`, `loop-runs-write.ts`, `loop-runs-read.ts` — the three lane columns
  in the record type (all timestamps `string`) and their projections.
- `src/features/inflight/live/cockpit/{loopTypes.ts,LaneRail.tsx,CockpitRunPanel.tsx}` — remote lane
  rendering (executor chip, lease countdown, claimant).
- `src/components/org/followups/{FollowupChips.tsx,followupsModel.ts}` — `needs human` chip and the
  "claimed by agent:… , lease expires in 42m" line.
- `docs/features/org-followups/README.md`, `docs/features/org-knowledge/skills.md` (MCP section),
  `docs/features/org-planning/live.md` (known gaps).

**Files to create**
- `src/lib/db/followup-claims.ts` — the single claim path (see Behaviour §1).
- `src/lib/db/followup-claims.test.ts`
- `src/lib/org/followups-lease.test.ts`
- `src/lib/mcp/handlers-write.test.ts`
- `src/app/api/mcp/write-scope.test.ts`
- `scripts/ascent-work.mjs` — zero-dep `npx ascent work` wrapper (no ascent-repo assumptions).
- `examples/ascent-work.action.yml` — reference GitHub Action, deliberately **not** under `.github/`
  so it never runs in this repo.

**Prisma models/columns needed (landed by the wave-4 schema pass, not by this lane)**
- `Recommendation` += `claimActor String?`, `claimExecutor String?` (`local | remote-agent | human`),
  `leaseUntil DateTime?`, `needsHuman Boolean @default(false)`; `@@index([status, leaseUntil])`.
- `LoopRunLane` += `executor String @default("local")`, `claimedBy String?`, `leaseUntil DateTime?`.
- No new table: a claim is a state of the row it claims. A `FollowupClaim` side table would give two
  places to ask "who holds this", which is the race the item exists to prevent.
- `wire-safe-dates.test.ts`: `LoopLaneRecord` (already string-typed) plus the new
  `FollowupClaimRow` — timestamps declared `string`, mapped with `.toISOString()`.

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: `export { claimFollowups, releaseFollowups, reportAttempt, sweepExpiredLeases, type FollowupClaimRow } from "./followup-claims";`
- `scripts/docs/feature-doc-map.json`: add `src/lib/db/followup-claims.ts` to the `org-followups`
  entry's `sourceGlobs`.
- `context-map.json`: `src/lib/db/followup-claims.ts` + `scripts/ascent-work.mjs` into the
  **Follow-ups Ledger** context's `filePaths`; the three MCP write tools noted on **MCP Server**.

**MUST NOT TOUCH** — `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`,
`context-map.json`, `feature-doc-map.json` (request the lines above); `src/lib/scoring/gate.ts` and
`src/lib/org/admission.ts` (**W4-O**); `src/lib/memory/recall.ts` and the memory plan gate on
`/api/mcp` (**W2-K**, already merged — do not re-shape it); `src/lib/local/agent.ts` (its cost
envelope belongs to #27/W2-G); `src/lib/practices/**`.

**Handoffs to other lanes**
- **W4-O (#8)**: `get_ai_stance` gains no fields here; the admission compiler may want
  `claim_followups` to consult a compiled `RepoAdmission` instead of the derived autonomy tier —
  `claimability()` is a pure function with one input struct so O can swap its source.
- **W2-G (#27)**: remote lanes have no local cost envelope. `costCents` stays null on a
  `remote-agent` lane (unknown ≠ 0); if G later wants agent-reported cost, `report_attempt` is the
  place to add an optional `costCents` and that field is G's to request, not N's to invent.
- **W1-D**: `scripts/ascent-work.mjs` is a **separate file** from `scripts/ascent-skills.mjs`; the
  eventual single `npx ascent` binary that merges them is D's distributable work, not this lane's.

## Goal and the Known gaps this deletes

Make the Follow-ups ledger a pull-based work queue that any coding agent — Claude Code, Copilot,
Codex, Cursor, a CI job — can claim from over MCP with a scoped token, while Ascent keeps the only
thing that matters and runs no code: adjudication by the default-branch rescan. Competitive angle:
Factory remediates only with its own Droids; Ascent becomes the vendor-neutral referee's work queue
every agent can pull from, which a scorer that upsells its own agent cannot copy without conceding
the agent.

Known gaps deleted in this PR:
- `docs/features/org-planning/live.md` → **"No hosted dispatch."** (cloud orgs get remote-executor
  runs; the sandboxed-executor sentence goes with it) and **"`curating` is reserved, unused."**
- `docs/features/org-knowledge/skills.md` → the MCP section's read-only framing is replaced by the
  scoped write door (the *sentence* that says a write tool needs an answer to "what stops an agent
  closing its own recommendation" is answered, not deleted — the answer is that it cannot).
- `docs/features/org-followups/README.md` → no gap is deleted; a **Protocol** section is added.
  ("Only the trailer and title-disappearance close a row" stays true and is now load-bearing.)

## Behaviour

### 1. One claim path — `src/lib/db/followup-claims.ts`

```ts
export type ClaimExecutor = "local" | "remote-agent" | "human";
export interface FollowupClaimRow {          // wire-safe: no Date
  id: string; repo: string; title: string;
  claimActor: string | null; claimExecutor: ClaimExecutor | null;
  leaseUntil: string | null; needsHuman: boolean;
}
export async function claimFollowups(args: {
  org: string; ids: readonly string[]; actor: string;
  executor: ClaimExecutor; leaseMs: number; note: string;
}): Promise<{ claimed: FollowupClaimRow[]; refused: { id: string; reason: ClaimRefusal }[] }>;
export async function releaseFollowups(ids: readonly string[], why: string, actor: string): Promise<number>;
export async function reportAttempt(args: {
  org: string; id: string; actor: string;
  verdict: "resolved" | "skipped" | "needs_human";
  reason: string; branch?: string | null; prUrl?: string | null;
}): Promise<{ status: string; needsHuman: boolean } | null>;
export async function sweepExpiredLeases(org: string): Promise<number>;
```

- **The claim is a compare-and-set.** `updateMany({ where: { id, status: "open", OR: [{leaseUntil: null},{leaseUntil: {lt: now}}] }, data: {...} })`; `count === 1` won,
  `0` lost. This is the whole answer to "lease races with the local engine": both executors call
  this function and the database decides. `runLane`'s current unconditional
  `updateRecommendation(id, {status:"in_progress"})` is replaced by it — the local engine gets the
  same refusal path a remote agent gets, so a lane that starts while an agent holds three rows works
  the other two and logs the refusal rather than stealing them.
- **Every claim writes a `RecommendationEvent`** (`kind: "status"`, `toValue: "in_progress"`,
  `actor`, note naming executor + lease expiry) inside the same call, and a `recordAudit`
  (`action: "followup.claim"`, meta `{ ids, executor, tokenId, leaseUntil }`, `orgId`) — this door
  is a machine write path, so it is audited like every other one.
- **`sweepExpiredLeases`** flips `status: "in_progress" AND leaseUntil < now` back to `open`, clears
  the lease columns, and writes a `RecommendationEvent` per row ("Lease expired — released"). It is
  **lazy**, called at the top of `claimFollowups`, `openBatch` and the ledger read — the same
  precedent `markStaleRunsStopped` sets on `GET /api/org/loop`. No cron entry is requested; a cron
  backstop is a later, separate line (W3-L owns the cron surface).
- **Honest nulls.** `leaseUntil: null` on an in-progress row means *a human took it* (the browser
  hand-off route), not "expired". The sweep only touches rows with a non-null lease.
- **Retention/erase.** Claims are columns on `Recommendation`, so purge and erase behaviour is
  unchanged — no new retention rule, nothing new to erase.

### 2. Pure predicates — `src/lib/org/followups.ts`

```ts
export const AGENT_LEASE_MS_DEFAULT = 45 * 60_000;         // one working session
export const AGENT_LEASE_MS_MAX = 4 * 60 * 60_000;
export function leaseExpired(leaseUntil: string | null, now: Date): boolean;
export type ClaimVerdict =
  | { allowed: true; requiresHumanReview: boolean }
  | { allowed: false; reason: "tier-blocked" | "tier-unknown" | "no-ai-zone" };
export function claimability(f: {
  autonomyTier: AutonomyTierId | null; executor: ClaimExecutor; zonesTouched?: readonly string[];
}): ClaimVerdict;
export function buildAgentBrief(items, ctx, perimeter): string;   // buildFixPrompt + context block
```

`claimability` rules: `remote-agent` on **T0 → refused**; **null tier → refused** (`tier-unknown` —
a repo with no passport is not a repo that has proven it can be worked unattended; unknown ≠ green);
**T1/T2 → allowed with `requiresHumanReview: true`**; **T3 → allowed, no flag**. `local` and `human`
executors are unaffected (self-hosted consent is the operator's own box). The tier comes from
`StanceRepoFacts.autonomyTier` (`src/lib/db/org-stance.ts`), which is `passport.autonomy.tier`.

`buildAgentBrief` = `buildFixPrompt(items, ctx)` + a **perimeter block** carrying, verbatim: the
org's `noAiZones`, `permittedTools`/`permittedModels`, `reviewTiers[tier].review` text, the repo's
autonomy tier, the lease expiry, and the two protocol rules ("commit the trailer", "call
`report_attempt` before your lease expires; a lease you let expire releases the rows"). No new
prose is generated — every line is a stored value.

### 3. MCP tools (catalog stays alphabetical)

| Tool | Scopes | Args | Effect |
| --- | --- | --- | --- |
| `claim_followups` | `mcp:read` + `followups:write` | `{ repo, ids?: string[], count?: 1–10, leaseMinutes?: 5–240 }` | `sweepExpiredLeases` → `claimability` per repo → `claimFollowups(executor:"remote-agent", actor:"agent:<token name>")`. Returns claimed rows, refusals with reasons, lease expiry. `ids` omitted → the top `count` of `openBatch(org, repo)`. |
| `get_fix_brief` | `mcp:read` + `followups:write` | `{ ids: string[] }` | `buildAgentBrief` for rows **this token holds**; a row claimed by someone else is refused by id, not silently dropped. |
| `report_attempt` | `mcp:read` + `followups:write` | `{ id, verdict, reason, branch?, prUrl? }` | Writes a `RecommendationEvent` (`kind: "attempt"`, `toValue: verdict`, note carrying reason/branch/PR). **Never closes a row.** `resolved` → stays `in_progress`, lease cleared (the rescan owns it now). `skipped` → back to `open`, lease cleared. `needs_human` → stays `in_progress`, `needsHuman = true`, lease cleared. |

Answering the catalog comment's own question — *what stops an agent closing its own recommendation*:
the write path has no verb that closes one. `status: "done"` is reachable only from
`scans-persist`'s `decideInProgress`, i.e. a rescan of the branch that both stops restating the gap
and measures the dimension moving. The trailer stays a claim, not a verdict (`followups.ts` module
note); `report_attempt` is a second claim of the same weight.

Door mechanics unchanged: bearer `askl_` token → org, per-tool scope filtering already hides what a
token cannot call, `GATE_RATE_LIMIT` already charged before body handling, origin check, no session.
A write tool crashing still returns `isError: true` inside a 200, per the revision.

### 4. Remote lanes and the hosted run

- `POST /api/org/loop` body gains `executor?: "local" | "remote-agent"` (default `local`).
  `local` keeps both guards (`selfHosted()`, `autopilotEnabled()`); `remote-agent` requires neither —
  Ascent starts no process, opens no worktree and touches no filesystem for such a run.
- `startRemoteRun({org, repos, batches, actor})` creates a `LoopRun` in **`curating`** with one
  `LoopRunLane` per repo (`executor: "remote-agent"`, `phase: "queued"`, `batchIds` = the proposed
  batch from `/propose`). The run flips to `running` on the first successful `claim_followups`
  against one of its repos; the lane records `claimedBy` + `leaseUntil` and moves to `dispatching`.
  `report_attempt` appends to the lane log; the lane goes `done` when the repo's next scan lands
  (`afterScanId`), exactly as a local lane does.
- Cockpit (`LaneRail`, `CockpitRunPanel`): an executor chip (`local` / `agent`), the claimant label
  and a lease countdown, built from `Tile`/`TILE_LEDGER` and `@/components/ui` primitives, mono
  `tabular-nums` for the countdown, colour only via `LEVEL_HEX`/`scoreHex`. A remote lane shows
  "cost —" rather than a zero (#27's envelope does not exist for it).
- Follow-ups ledger: a `needs human` chip in `FollowupChips.tsx` and the claimant/lease line in the
  worklist row. Both read the same `FollowupClaimRow`.

### 5. Gates, self-hosted, privacy

- **Plan gate.** The MCP door's plan gate is W2-K's (already merged); `followups:write` inherits it.
  `selfHosted()` turns plan gates off, so a self-hosted org gets the write tools with a token and no
  entitlement check — the point of the open-source mode.
- **Token minting.** `followups:write` is offered in the token UI beside the existing scopes and is
  never implied by `mcp:read` (the module's own rule: the door is not the resource).
- **Privacy floors.** No aggregate is published by this lane, so `CHAMPION_MIN_POP` does not apply.
  The brief carries one org's own rows to a token that org minted; nothing crosses tenants — every
  id is org-checked exactly as the handoff route checks it.
- **Audit.** `followup.claim`, `followup.attempt`, `loop.remote_run_started` — all via `recordAudit`
  with `orgId` resolved, so they are visible in the audit viewer.

## Build order

1. **Scope + principal.** `followups:write` in `SKILL_TOKEN_SCOPES`; `authorizeOrgCapability` in
   `api-token-auth.ts` returning an executor-tagged principal. Gateable alone (types + one test).
2. **Pure lease/claimability layer** in `followups.ts` + `followups-lease.test.ts`. No IO.
3. **`src/lib/db/followup-claims.ts`** — compare-and-set claim, release, sweep, attempt; events and
   audit rows. Tests against the PGlite dev DB.
4. **Cut `loop-lane.ts` over to it.** The inline claim loop and `releaseClaims` become calls; the
   zombie-release behaviour must be byte-equivalent in outcome (its test stays green unchanged).
   *This is the step that makes the claim path single;* everything after it is additive.
5. **MCP write tools** — catalog entries, handlers, `runTool(principal)`, route wiring, per-tool
   scope test.
6. **Remote run + lane columns** — `startRemoteRun`, the `executor` branch on `POST /api/org/loop`,
   record projections, `curating` → `running` transition.
7. **Cockpit + ledger UI** — executor chip, lease countdown, `needs human` chip.
8. **`scripts/ascent-work.mjs` + `examples/ascent-work.action.yml`** — `claim → brief → run any
   agent CLI → report`, driven by `ASCENT_TOKEN` + `ASCENT_URL`, zero deps, exits non-zero only on
   protocol failure.
9. **Docs** — the three files, with the two `live.md` known gaps deleted.

## Tests

- `src/lib/org/followups-lease.test.ts` (new) — `claimability` table over T0/T1/T2/T3/null ×
  executor; `leaseExpired` boundary. **Fail-before:** `claimability` does not exist.
- `src/lib/db/followup-claims.test.ts` (new) — **the race guard:** two concurrent
  `claimFollowups` calls on the same id yield exactly one `claimed` and one `refused: "held"`.
  **Fail-before:** with the old unconditional `updateRecommendation`, both succeed and the second
  silently steals the row. Also: sweep releases only non-null expired leases; a human hand-off
  (`leaseUntil: null`) survives the sweep.
- `src/lib/mcp/handlers-write.test.ts` (new) — `report_attempt` with every verdict never produces
  `status: "done"`. **Fail-before:** an implementation that closes on `resolved`.
- `src/app/api/mcp/write-scope.test.ts` (new) — a `mcp:read`-only token neither sees nor can call the
  three write tools (`tools/list` filtered; `tools/call` answers "Unknown tool" so the door is not an
  oracle). **Fail-before:** tools listed unconditionally.
- `src/lib/mcp/tools.test.ts` (extend) — alphabetical order and the ≥80-char description rule hold
  with eight tools.
- `src/lib/local/loop-lane.test.ts` (extend, existing) — a lane whose batch is partly held by a
  remote agent works the rest and releases only what it claimed.
- `src/app/api/org/loop/route.test.ts` (extend, existing) — `executor: "remote-agent"` is accepted
  with `selfHosted()` false; `executor: "local"` still 404s there.
- Structural guards: **wire-safe-dates** (`FollowupClaimRow`, `LoopLaneRecord` additions — add to its
  list), **id-routes-gated** (`/api/org/loop/[id]` unchanged; no new `[id]` route), **doc-sync**
  (three docs in the same turn), `scripts/docs/__tests__/check-doc-sync.test.mjs` after the doc-map
  glob line lands.
- UAT: re-run **Sam** (staff engineer) — "hand five gaps to my agent and see them adjudicated" now
  through a token instead of a paste; and **Tomáš** on the neutrality claim ("does it work with the
  agent I already pay for"). Dana's journey is untouched (no briefing/PDF change).

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (200 under
`src/features/**` for the cockpit edits, 300 `.tsx` elsewhere) → e2e for the cockpit + ledger chips.
Done when: a token holding `mcp:read + followups:write` can claim, brief and report against a cloud
org with no self-hosted flag anywhere; the local engine and a remote agent contend for the same row
and exactly one wins; no code path can move a row to `done` except the rescan; the two `live.md`
known gaps are gone.

## Out of scope

- **#8 Agent-admission compiler** (W4-O, next) — compiled `RepoAdmission`, rulesets/CODEOWNERS
  proposals, gate-verdict changes. This lane reads the *derived* autonomy tier and nothing else.
- **#17 Work-time registry over MCP** (W2-K, merged) — `invoke`/citation write-back, memory plan
  gate, Athena grounding exposure. Not re-shaped here.
- **#25/#26/#27** (W2-G, merged) — lane briefs, the improvement ledger, and remediation economics.
  A remote lane deliberately carries no cost envelope; `costCents` stays null, never zero.
- **#34 Exemplar diff** — `compare_against_exemplar` was handed to W2-K, not to this lane.
- Deferred deck items this must not absorb: **#6** signed maturity attestation, **#20** Athena as
  registry curator (PR-proposing actions), **#21** GitHub identity graph / scoped membership,
  **#28** durable scheduled drives, **#29** score-input ledger, **#30** reproducibility certificate,
  **#31** signed tenant history bundle, **#12** purchasable artifacts, **#24** billing account above
  the tenant, **#37** data-bound deck diagrams.
- Concept-doc items not pre-empted: **#5** gate-as-code, **#23** agent behaviour ledger / OTLP, and
  **#22** developer-held credential lane — this lane authenticates agents with org tokens only.
- **Ascent never executes remote work.** No sandbox, no hosted runner, no container — if a design
  question here is answered by "Ascent runs the agent", it is the wrong answer for this lane.
