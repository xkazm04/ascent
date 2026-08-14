# Org Skills Library

A curated, versioned library of `SKILL.md` entries an org's members author,
adopt against repos, and sync with CLI/CI tooling, plus the org API tokens
that let non-browser callers (CLIs, agents, CI jobs) read and write it
without a cookie session.

## UI entry point

`src/app/org/[slug]/skills/page.tsx` (server component, `dynamic =
"force-dynamic"`). It parallel-fetches the skill list, per-skill adoption
data, per-skill dormancy/usage data (degrades to `{}` on failure), per-skill
outcome data (degrades to `{}` on failure), the org's repo list (for the
adopt-picker), plan/credit state, and membership/admin role. It renders
`SkillsPanel` with `canAuthor = isMember && planAllowed`, then, only for
members, `ApiTokensPanel`.

`SkillsPanel` (`src/components/org/skills/SkillsPanel.tsx`, client) debounces
(250ms) a server-side refetch of `GET /api/org/skills` on search/category/sort
changes, renders a filter bar and a table (Name / Category / Status /
Adoptions / Uses), and expands a `SkillCard` beneath a clicked row.

## SKILL.md frontmatter contract

`src/lib/org/skill-frontmatter.ts` parses a `---`-fenced block at the top of
the document using a small flat-scalar line parser, deliberately not a full
YAML parser, since the content is user-authored.

```
---
name: pr-review-checklist
description: "One sentence telling an agent when to use this skill."
category: workflow
tags: review, pull-request
---
```

| Field | Required | Rule |
| --- | --- | --- |
| `name` | yes | kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), max 100 chars. |
| `description` | yes | single line, max 1000 chars. |
| `category` | no | must normalize to one of the closed set below; if declared but unrecognized, it's an error. Omitted entirely → `null`. |
| `tags` | no | comma list, bracket list, or YAML block-sequence; max 20 tags, 40 chars each. |

Categories (`src/lib/org/skill-categories.ts`): `ci-cd`, `testing`,
`security`, `ai-native`, `docs`, `workflow`, `other`.

Three ways this contract is applied:

- **Validate** (`parseSkillFrontmatter`): read-only check, used for
  diagnostics.
- **Backfill** (`ensureFrontmatter`): injects a block if one is missing, or
  repairs an invalid one from supplied defaults. This is applied at
  **download time**, not write time: a legacy skill row stored without a
  block still downloads as a conformant `SKILL.md`, but the fix is never
  written back to storage.
- **Reconcile on write** (`reconcileSkillWrite`, shared by create/edit/push/
  promote): the rule is: if the document declares a block and it's invalid,
  reject the write with the specific errors (never silently "fixed"); if a
  valid block is present, it wins over the request's separate `name`/
  `description`/`category`/`tags` fields (those DB columns are synced *from*
  the frontmatter); if no block is present at all, one is injected from the
  request, but `name` and `description` must be explicitly supplied, never
  fabricated.

## Primary user flows

### Author a skill

The author form (`SkillsPanel.AuthorForm.tsx`) offers a template picker
(`SKILL_TEMPLATES`, `src/lib/org/skill-templates.ts`) that prefills the form,
then posts `{ org, name, category, content, description?, tags? }` to `POST
/api/org/skills`. If `!canAuthor`, the form renders only an upsell line when
the plan doesn't allow it ("Authoring the Skills Library is a Team-plan
feature. Members can browse, copy and download existing skills."); nothing
renders if the plan allows it but the viewer just isn't a member.

### Promote a repo's generated onboarding skill into the library

`POST /api/org/skills/promote` takes `{ org, repo: "owner/name[@sha]" }` and
turns a repo's already-generated onboarding skill (from a saved scan report)
into a library entry:

- It runs through the **same entitlement chain as a normal create**
  (plan/personal-cap check); promotion is treated as a create, not a way
  around those limits.
- The source repo is read-gated **by session**, even if the caller
  authenticated with a machine token that can write the destination org's
  library: a private report the caller's own session can't see is treated
  as absent (404 "No saved scan for this repository yet. Scan it first, then
  promote.").
- The generated skill's `name:` is discarded and replaced with a
  repo-derived slug (`ascent-onboard-<owner>-<repo>`), so re-promoting the
  same repo lands on the same name (and correctly 409s instead of
  duplicating), while two different repos in the same org don't collide.
  Category is always forced to `ai-native`. The generator's own
  `description:` is kept if it declared one; otherwise a fallback sentence
  citing the scan date, maturity level, and overall score is used. Tags are
  `["ascent", "onboarding", <owner>, ...trackIds]`.
- A duplicate name returns 409: `"<name>" is already in the library. Edit or
  archive it before promoting again.`

### Adopt a skill against a repo

`POST /api/org/skills/:id/adopt` with `{ repo }` (session-gated, member-
level; there is no token-bearer path for adopt/unadopt at all) upserts an
`OrgSkillAdoption` row (unique per skill+repo, so re-adopting just updates
`adoptedBy`/`adoptedAt`). `DELETE` on the same route removes it
unconditionally (no existence check). The `SkillCard` renders adopted repos
as removable chips plus a select-and-add control for the remaining repos in
the org, both optimistic with rollback on failure.

### Copy / download a skill ("use")

`SkillCard` offers a "Copy for LLM" button and a direct download link
(`GET /api/org/skills/:id/download`). Both count as a "use": copy calls
`POST /api/org/skills/:id/download` (records a use without serving content),
and a normal `GET` fire-and-forgets the same record unless the caller passes
`?count=0` (used by the sync CLI, so a background sync never inflates the
"most used" tally). Recording a use writes **three rows in one transaction**:
an `OrgSkillEvent` of type `download` (source `web`), the rolling
`OrgSkillDownload` tally, and the denormalized `OrgSkill.downloadCount`. That
single write is why the card's "N uses" counter and the dormancy badge beside
it can no longer contradict each other: before 2026-07-29 the web path wrote
only the counters, so a skill copied 40 times rendered "40 uses" and "dormant"
inches apart. The downloaded body is always run through the
frontmatter backfill described above, and the response is served as
`text/markdown` with a sanitized `<name>.SKILL.md` filename (stripped to
`[a-z0-9._-]`, capped at 80 chars) to prevent header injection via the skill
name.

### Sync from a CLI/CI client

Two routes exist specifically for a non-interactive client:

- `GET /api/org/skills/manifest` returns `{ skills: [{ id, name, category,
  version, contentHash, updatedAt }] }` for every non-archived skill,
  ordered by name, with no content bodies; a client diffs this against a
  local lockfile and only calls `/:id/download` for entries whose version or
  content hash changed.
- `POST /api/org/skills/push` registers or updates a skill by name, with an
  optional `baseVersion` for optimistic-concurrency: if the org already has a
  skill by that name and the caller's `baseVersion` doesn't match the current
  version, the route returns `409` ("Server has version {version}; you
  pushed against {baseVersion}. Pull and retry.") without writing. If the
  content hash is unchanged, it reports `unchanged` without bumping the
  version; otherwise it increments `version` by 1. Unlike every other
  skills-write route, push gates directly on `planAllowsSkillsLibrary`
  rather than the personal-workspace-inclusive `workspaceAllowsSkills`; the
  CLI/CI push path does not extend the personal-workspace free tier.

### Usage telemetry

`POST /api/org/skills/events` accepts a batch (`{ org, events: [{ skillId,
type, repo?, source? }] }`, capped at 500 per call) under a distinct
`telemetry:write` token scope. `type` must be `download` or `sync`; anything
else is dropped (a batch containing at least one valid event is still
recorded; a batch of only invalid events is a 400). Events for skill ids
outside the caller's org are silently dropped (tenant boundary). Only
`download` events bump the rolling use counters; `sync` events are logged but
never count toward "most used," since a background CLI sync would otherwise
make every adopted skill look permanently active. The whole handler is
best-effort: telemetry failures never fail the caller's real work.

A third type, `invoke`, was **retired on 2026-07-29**. It ranked highest in
the dormancy verdict but had no producer anywhere: not the app, not the
distributed CLI (`scripts/ascent-skills.mjs` emits `sync` only), not the
hooks, so `active` was unreachable for every skill in production. It is gone
from the type union, its validator, this route and every reader;
`prisma/migrations/20260729150000_retire_skill_invoke_event` folds any legacy
row into `download` so historical activity keeps counting. The CLI's wire
contract is unaffected (it never sent `invoke`).

### Dormancy status

`src/lib/org/skill-usage.ts` classifies each skill as `new`, `active`, or
`dormant`:

1. A real use (`download`, a copy or download from the web UI or a CLI, but
   never a `sync`) within the last 30 days (`DORMANCY_WINDOW_DAYS`) →
   **active**.
2. Otherwise, if the skill has never been used and is younger than 30 days
   (measured from creation, or from its most recent adoption if that's
   later, since re-adopting an old skill into a new repo restarts its chance to
   prove itself) → **new**, so a brand-new skill isn't punished for having
   no uses yet.
3. Otherwise → **dormant**.

`SkillDormancyBadge` renders this with `active` in emerald, `dormant` in
amber, and `new` deliberately neutral (slate) rather than green, since it
hasn't earned "active" yet. The badge and the "N uses" counter beside it are
folded from the same `download` events, so `active` is reachable through a
path that exists today (a web copy/download, or a CLI-reported `download`).

### Outcome tracking (score movement since adoption)

`src/lib/org/skill-outcomes.ts` pairs, per adopted repo, the latest scan
strictly before the adoption timestamp with the latest scan at-or-after it,
and reports the overall-score delta and the largest-moving dimension delta
between them. If either side of the pair is missing, the status is
`no-before-scan` or `no-after-scan` rather than a fabricated delta: the code
explicitly treats inventing one as turning the library into "a lie
generator." `SkillOutcomes` renders this with an explicit disclaimer that the
movement is correlational, not causal ("Movement in the same window as the
adoption: correlation, not proof of cause").

`skill-outcomes-load.ts` issues one `getRepositoryHistory` read (newest 100
scans) per **distinct** adopted repo, run through `mapPool` at
`HISTORY_CONCURRENCY = 6` lanes. Every adopted repo is still read: the bound
is on how many reads are in flight, not on how many repos are visited, so no
repo is ever dropped from the outcome numbers and nothing needs to be
disclosed as truncated. Before 2026-07-29 this was an uncapped `Promise.all`,
so a widely-adopted skill in a large org meant hundreds of concurrent DB
round-trips from one page render: the Skills page got slower exactly as a
skill spread.

## Org API tokens

Minted via `POST /api/org/tokens` (session-only, member-gated; no token can
mint another token). The raw value (`askl_` + 24 random bytes, base64url) is
returned exactly once; only its SHA-256 hash and a 12-character display
prefix are stored. Scopes: `skills:read`, `skills:write`,
`telemetry:write`, `memory:read` (org-memory recall, see
[memory.md](./memory.md)); an empty/invalid scope list defaults to
`["skills:read"]` (never a zero-scope token). `DELETE
/api/org/tokens/:id` soft-revokes it (`revokedAt` set; the row survives for
audit). `GET /api/org/tokens` lists summaries only, never the raw value or
hash.

Authorization (`src/lib/api-token-auth.ts`): a request with `Authorization:
Bearer askl_...` is verified against the stored hash; an invalid or revoked
token is a **hard denial** (401/403): it never silently falls back to
session auth. A request with no bearer token (or one not starting with
`askl_`) falls back to the normal session gates (`requireOrgRead` for reads,
`requireOrgAccess` for writes), so the token path is additive, not a
replacement for the login wall.

Most skills routes accept either a token or a session: create, list, get,
patch, download, manifest, push, promote, events. Two write paths are
session-only with no token-bearer path at all: archiving a skill (admin
role required) and adopt/unadopt (member role). All of `/api/org/tokens*`
(minting, listing, revoking) is likewise session-only.

## API surface

| Route | Method | Scope/gate | Purpose |
| --- | --- | --- | --- |
| `/api/org/skills` | `POST` | `skills:write` + plan/cap | Create a skill. |
| `/api/org/skills` | `GET` | `skills:read` | List/filter/sort (`category`, `search`, `sort`). |
| `/api/org/skills/[id]` | `GET` | `skills:read` | Fetch one skill. |
| `/api/org/skills/[id]` | `PATCH` | `skills:write` + plan | Edit; frontmatter reconciled with current values as fallback. |
| `/api/org/skills/[id]` | `DELETE` | admin session only | Archive (soft-delete). |
| `/api/org/skills/promote` | `POST` | `skills:write` + plan/cap + source-repo session read | Promote a repo's onboarding skill into the library. |
| `/api/org/skills/push` | `POST` | `skills:write` + `planAllowsSkillsLibrary` (no personal path) | Create/update by name with optimistic-concurrency (`baseVersion`). |
| `/api/org/skills/manifest` | `GET` | `skills:read` | Lockfile-style index for sync clients. |
| `/api/org/skills/[id]/adopt` | `POST`/`DELETE` | member session only | Adopt/unadopt against a repo. |
| `/api/org/skills/[id]/download` | `GET`/`POST` | `skills:read` | Serve/copy the skill body; counts a use. |
| `/api/org/skills/events` | `POST` | `telemetry:write` | Batch usage events (`download`/`sync`). |
| `/api/org/tokens` | `POST`/`GET` | member session only | Mint/list org API tokens. |
| `/api/org/tokens/[id]` | `DELETE` | member session only | Revoke a token. |

## Data model

| Model | Purpose | Key fields |
| --- | --- | --- |
| `OrgSkill` | The library entry. | `name` (unique per org), `description`, `content`, `category`, `tags` (JSON string), `version`, `contentHash`, `archived`, `downloadCount` (denormalized), `createdBy`. |
| `OrgSkillAdoption` | One row per (skill, repo). | `skillId`, `repoFullName`, `adoptedBy`, `adoptedAt`; unique on `[skillId, repoFullName]`. |
| `OrgSkillDownload` | Rolling per-skill use tally. | `skillId` (unique), `count`, `lastSeen`. |
| `OrgSkillEvent` | Append-only per-use event log. | `skillId`, `orgId`, `type` (`download`/`sync`), `repo`, `source`, `createdAt`. |
| `OrgApiToken` | Machine-access credential. | `orgId`, `name`, `tokenHash` (unique), `tokenPrefix`, `scopes` (comma-joined), `lastUsedAt`, `revokedAt`. |
| `SkillGeneration` | A standalone log of per-repo onboarding-`SKILL.md` generations. | `repoFullName`, `headSha`, `trackIds`, `generatedAt`. No relation fields to `OrgSkill` or an org. |

`OrgSkillEvent.source` is documented in the schema comment as one of `cli |
hook | ci | web`, but it is not enum-validated in code: it's clipped to 200
characters as free text, not enforced as a closed set.

## Tier gating

`planAllowsSkillsLibrary(plan)` in `src/lib/plans.ts` returns `true` only for
`team` and `enterprise`; reads are open to all members regardless.

Most write routes use `workspaceAllowsSkills(slug, plan)`
(`src/lib/db/personal.ts`): `planAllowsSkillsLibrary(plan) ||
isPersonalOrg(slug)`. A personal workspace can author/edit/promote/archive
regardless of plan, capped at 10 non-archived skills
(`PERSONAL_SKILL_LIMIT`); exceeding it returns 402 ("Personal skills are
capped at 10. Archive one to author another."). A Team+ org has no such cap.

The **push** route is the one exception: it gates directly on
`planAllowsSkillsLibrary`, not `workspaceAllowsSkills`: a personal workspace
cannot use the CLI/CI push path even though it can author through the UI.

## The agent door — MCP server (W5, 2026-08-14)

`POST /api/mcp` is an MCP server implementing revision **2026-07-28**. It exists because ascent
already ships the org's standard as *files in a PR* (the `.ai/` foundation, practice starters,
pushed skills), which reaches an agent at setup time, not at the moment it is deciding how to write
the next change. That moment is where Port's *"make the governed route the fastest route"* either
happens or does not.

### Why there is no MCP SDK dependency

The 2026-07-28 revision made MCP **stateless**: it removed the `initialize`/`notifications/initialized`
handshake, protocol-level sessions and the `Mcp-Session-Id` header, the standalone GET/SSE stream,
and stream resumability (`Last-Event-ID`). Every request self-describes through `_meta`, and list
results may not vary per-connection.

For a Next.js app on serverless that is decisive: **a single `force-dynamic` POST handler is a
conformant server.** No session store, no sticky routing, no long-lived connection fighting a
function timeout: the three things that used to make hosting MCP real infrastructure work in this
deployment shape. An SDK would import transport and session machinery this revision deleted.

What the revision *adds* is header/body validation, and it is implemented rather than skipped:
`Mcp-Method` and `Mcp-Name` mirror body fields so intermediaries can route without parsing, and a
mismatch **must** be rejected with `-32020`, otherwise a load balancer and this server could act on
different requests. `validateHeaders` (`src/lib/mcp/protocol.ts`) enforces it, including the
`=?base64?…?=` sentinel decode before comparison.

Also implemented per the revision: `server/discover` (mandatory), `resultType` on every result,
`ttlMs` + `cacheScope` on `tools/list`, deterministic tool ordering, Origin validation (403), and
`405` on GET/DELETE.

### Tools, and the scope model

| Tool | Requires | Answers |
| --- | --- | --- |
| `get_ai_stance` | `mcp:read` | Permitted tools/models, no-AI zones, review tiers, approval requirement |
| `get_gate_verdict` | `mcp:read` | Would this repo clear the org's gate, and what fails |
| `get_practice_shape` | `mcp:read` | The reusable *shape* of a practice the org already does well |
| `get_repo_standing` | `mcp:read` | Level, adoption vs rigor, per-dimension scores |
| `list_open_recommendations` | `mcp:read` | Gaps the org has already decided matter |
| `recall_org_memory` | `mcp:read` **+** `memory:read` | Decisions, incidents and conventions already ruled on |

`mcp:read` is the **door** scope and is deliberately separate from the resource scopes beside it: a
token holding it alone sees only the org-standing tools, and `memory:read` unlocks recall *on top*.
So granting an agent the door does not silently grant it the org's memory, and an existing memory
token does not silently become an agent door. `tools/list` filters to what the token holds, which
the revision explicitly permits, since credentials are per-request input rather than connection
state, so an agent is never shown a tool it would then be refused.

An out-of-scope tool is answered with the **same** `Unknown tool` error as a nonexistent one, so the
door does not become an oracle for which tools an org has that this token cannot reach.

### What it deliberately does not do

- **Read-only.** A write tool is a governance surface: it needs the stance model to authorize it, a
  machine audit actor, and an answer to *"what stops an agent closing its own recommendation"*.
  Shipping reads first answers the distribution question without pre-committing any of those.
- **Bearer tokens, not OAuth 2.1.** The revision describes MCP servers as OAuth resource servers
  validating tokens from a paired authorization server. This uses the org API tokens that already
  exist and emits a `WWW-Authenticate` challenge on 401. That is honest bearer auth, not resource-server
  conformance, and the distinction is stated rather than glossed.
- **No `subscriptions/listen`.** The catalog is a compile-time constant, so `listChanged: false` is
  the truthful capability declaration rather than advertising a channel that never fires.

Every handler is a **projection of a shipped read**: the gate tool runs the same `evaluateGateLite`
against the same persisted policy the CI gate and dashboard use, so an agent is never told it would
clear a bar CI then blocks. Absence is always answered explicitly ("this repo has never been
scanned", "no stance published, absence is not permission") rather than as an empty object a model
would read as *nothing to worry about*.

## Known gaps

- `OrgSkillEvent.source` is documented as `cli | hook | ci | web` but is
  never validated against that set in code; any string up to 200 characters
  is accepted. Whether real CLI/CI clients consistently send one of those
  four values could not be confirmed, since the sync client's own source
  code was not part of the files examined.
- The relationship between the `SkillGeneration` Prisma model and the
  onboarding-skill generation log referenced in a comment in
  `src/lib/db/org-skills.ts` (as `src/lib/db/skill-history.ts`) is unclear;
  it was not established from the files read whether these are the same
  store viewed two ways or two separate logs.

## Key files

| File | Role |
| --- | --- |
| `src/app/api/org/skills/route.ts` | Create + list. |
| `src/app/api/org/skills/[id]/route.ts` | Get/patch. |
| `src/app/api/org/skills/promote/route.ts` | Repo → library promotion. |
| `src/app/api/org/skills/push/route.ts` | CLI/CI create-or-update with version conflict detection. |
| `src/app/api/org/skills/manifest/route.ts` | Sync index. |
| `src/app/api/org/skills/[id]/adopt/route.ts` | Adopt/unadopt against a repo. |
| `src/app/api/org/skills/[id]/download/route.ts` | Serve/copy + use accounting. |
| `src/app/api/org/skills/events/route.ts` | Batched usage telemetry. |
| `src/app/api/org/tokens/route.ts`, `.../[id]/route.ts` | Mint/list/revoke org API tokens. |
| `src/lib/org/skill-frontmatter.ts` | Frontmatter parse/backfill/reconcile contract. |
| `src/lib/org/skill-promote.ts` | Promotion naming/description/tag derivation. |
| `src/lib/org/skill-usage.ts` / `skill-usage-load.ts` | Dormancy classification (pure logic / Prisma read split). |
| `src/lib/org/skill-outcomes.ts` / `skill-outcomes-load.ts` | Before/after adoption score deltas. |
| `src/lib/org/skill-categories.ts` | Closed category set. |
| `src/lib/org/skill-templates.ts` | Author-form starter templates. |
| `src/lib/db/org-skills.ts` | CRUD, `toRow()` read-time frontmatter resolution. |
| `src/lib/db/org-api-tokens.ts` | Token mint/verify/revoke, hashing. |
| `src/lib/api-token-auth.ts` | `authorizeOrgApi()`: token-or-session gate for skills routes. |
| `src/components/org/skills/SkillsPanel.tsx` | Client orchestrator. |
| `src/components/org/skills/SkillCard.tsx` | Per-skill detail, adopt/copy/download/archive actions. |
| `src/components/org/skills/SkillDormancyBadge.tsx` | Dormancy status chip. |
| `src/components/org/skills/SkillOutcomes.tsx` | Score-movement-since-adoption display. |
| `src/components/org/skills/ApiTokensPanel.tsx` | Token mint/list/revoke UI. |
| `src/app/org/[slug]/skills/page.tsx` | Page composition. |
