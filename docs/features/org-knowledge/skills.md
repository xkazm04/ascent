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

`SkillsPanel` (`src/features/shared/skills/SkillsPanel.tsx`, client) debounces
(250ms) a server-side refetch of `GET /api/org/skills` on search/category/sort
changes — the debounce covers the timer and an `AbortController` covers the
request it starts, so a superseded read cannot land its rows after a newer one — renders a filter bar and a table (Name / Category / Status /
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

### Usage telemetry — one event contract, two sinks, one repo rule

The event is `{ skill, version?, event: "invoke" | "download" | "sync", ts,
session?, source, repo? }`, identified by `(session, skill, ts)`. Every
producer emits that shape; it lands in one of two places, and only one of them
may carry `repo`.

**Sink A — the events API.** `POST /api/org/skills/events` accepts a batch
(`{ org, events: [{ skillId, type, repo?, source?, session?, ts? }] }`, capped
at 500 per call) under a distinct `telemetry:write` token scope. Tenant-private:
it lands in the org's own database, and it is the **only** sink that may carry a
repo name. Events for skill ids outside the caller's org are silently dropped
(the tenant boundary). An unknown `type` is dropped without rejecting its
batch-mates; a batch of only invalid events is a 400. The whole handler is
best-effort — telemetry failures never fail the caller's real work.

**Sink B — the registry's `usage/` lane.** `ascent-skills report --to-registry`
aggregates the same events into `usage/<contributor>.json` in the customer's
registry repo: **counts only — no repo, no path, no login, no per-project
breakdown.** The registry's own contract
(`docs/usage-lane.md`) forbids all of it and its `scripts/check-usage.mjs` gate
enforces it on what is usually a public repo; the CLI refuses to write a payload
containing any `/`- or `@`-shaped value rather than scrubbing one. Ascent READS
that lane at index time (`aggregateUsage`) and never writes to it from the
server.

The two are reported **separately and never summed** — an installation may
contribute to both, and adding them would count it twice. `telemetry/<repo>/<yyyy-mm>.jsonl`
(sketched in `docs/GOLDEN-USE-CASES.md`) is deliberately **not built**: it is
repo-dimensioned data in a repo whose privacy the operator does not control, and
sink A already serves that need.

**`invoke` is back (2026-08-29).** It was retired on 2026-07-29 for having no
producer: nothing in the app, the CLI or the hooks emitted it, so `active` was
unreachable for every skill in production, and a documented-but-unemittable type
is worse than none. That reasoning still stands and is why the type only
returned once producers existed — the `Skill` PreToolUse hook (below), the MCP
tool path, and the registry lane read as samples. `invoke` and `download` both
count as real uses and both bump the rolling use counters; `sync` is logged but
never counts toward "most used," since a background CLI sync would otherwise
make every adopted skill look permanently active.

Three writer invariants make a chatty producer safe:

- **`source` is a closed vocabulary** — `cli | hook | ci | web | registry | mcp`
  (`src/lib/org/skill-event-source.ts`), validated in `recordSkillEvents` rather
  than at each call site. The shipped CLI reported `cli:<drift state>`, so an
  unrecognized value is **normalized by prefix** (`cli:diverged` → `source: "cli"`,
  `detail: "diverged"`) rather than rejected; a value with no recognizable prefix
  still records the event with `source: null` and the raw text in `detail`.
  Nothing rewrites the rows already written — legacy strings are normalized on
  read, so there is no destructive migration.
- **`ts` is clamped** to `[now − 90d, now]`. A hook drains asynchronously, so an
  older timestamp is normal; the clamp is a floor against clock skew, which could
  otherwise bury a live skill in dormancy or pin a dead one to `active` forever.
- **`(session, skill, ts)` is the event's identity.** A sessioned event carries a
  `dedupeKey`; duplicates are filtered before the insert *and* by a nullable-unique
  constraint at it. The pre-filter is what keeps a retried batch from double-bumping
  the use tally. A producer that supplies no session keeps today's at-least-once
  behaviour.

### The invoke hook (`ascent-skills hooks`)

`ascent-skills hooks install` writes a `PreToolUse` matcher on `Skill` into the
project's `.claude/settings.json`, marked `_ascent: true`, and generates
`.ascent/skill-hook.mjs` from an embedded template (so the hook never depends on
where the CLI lives). The hook appends one line
`{skill, event:"invoke", ts, session}` to `.ascent/skill-events.jsonl` and
**exits 0 unconditionally**: it never blocks a tool call, never reads a prompt or
file content, records no user or path, and never phones home. `hooks remove`
deletes only entries carrying the marker — a project's own `Skill` hook is not
ours to take away — and leaves the spool alone, since it may hold unreported
events. `hooks status` prints installed/absent plus the pending count.

`ascent-skills report` drains the spool by **byte watermark**
(`.ascent/skill-events.offset`), not by truncation, so the hook may append while
a report is running. It dedupes on `(session, skill, ts)`, resolves skill names
to ids through the manifest (a name the library does not publish is reported as
skipped, never guessed at), and posts batches of ≤500 to sink A with
`source: "hook"`. The watermark advances only after the server acknowledges, so
a failed report re-sends — at-least-once, which the dedupe key turns into
exactly-once. `--dry-run` prints and drains nothing.

### Registry usage samples (sink B, persisted)

Each index pass snapshots the `usage/` lane into `OrgSkillUsageSample`, upserted
on `(registryId, contributor, skillName)` — **a snapshot, never an append**, so
re-indexing the same head is a no-op and cannot double-count. Contributors whose
file vanished are purged in the same pass, mirroring `archiveVanishedRegistryRows`;
the write and the purge are both skipped wholesale when GitHub truncated the tree,
because "not in this pass" would otherwise delete a live installation's counts.

`lastUsedAt` is `NULL` when the file omitted `lastUsed`, and **`generatedAt` is
never substituted for it**. A sample with no reported instant contributes a count
and no recency, so a skill whose only evidence is such a sample stays `unused`
rather than flipping to `active` every time the registry regenerates its files.
The samples are folded into the verdict at **read** time (`skillUsageMap`), never
materialized as `OrgSkillEvent` rows — the registry publishes a running total with
no event identity, so an append-shaped mirror would inflate on the second pass.

### Dormancy status

`src/lib/org/skill-usage.ts` classifies each skill as `new`, `active`, or
`dormant`:

1. A real use — `invoke` (the skill RAN) or `download` (a copy or download from
   the web UI or a CLI), but never a `sync` — within the last 30 days
   (`DORMANCY_WINDOW_DAYS`) → **active**. Where both exist, the **more recent**
   decides `lastUsedType`; `invoke` outranks `download` only on an exact tie,
   because running a skill is stronger evidence than reading it while a later
   download is still the last thing that happened.
2. Otherwise, if the skill has never been used and is younger than 30 days
   (measured from creation, or from its most recent adoption if that's
   later, since re-adopting an old skill into a new repo restarts its chance to
   prove itself) → **new**, so a brand-new skill isn't punished for having
   no uses yet.
3. Otherwise → **dormant**, which splits into three *states* (2026-08-20):
   **abandoned** (really used at least once, then silence), **unused** (never
   used, but this org's event pathway demonstrably works) and **unmeasured**
   (no skill event of any kind has ever been recorded for this org, so nothing
   is known about any skill's use). `SkillUsage.state` carries the split;
   `verdict` stays the coarse three-value badge vocabulary, so the badge is
   unchanged. Only **abandoned** is a prune candidate (`isPruneCandidate`) —
   deleting a skill because its telemetry pathway is uninstrumented is an
   unrecoverable action taken on absent data, and `unused` is a discovery
   problem whose remedy is surfacing the skill, not removing it.
   `usageSummary` reports the three counts beside `dormant`.

The 30-day window is now a **floor, not a constant** (2026-08-20): a skill's
own cadence derives its window (`dormancyWindowFor`) — a declared
`cadenceDays` if the skill has one, else its observed rhythm
(`ageDays / useCount`, needing at least two uses) — times two, clamped to
`[DORMANCY_WINDOW_DAYS, DORMANCY_WINDOW_MAX_DAYS]` (30…120). A
release-checklist skill used correctly once a quarter used to read `dormant`
for two months of every three and become a prune candidate for being used
exactly as intended. Both halves of the rule (the silence threshold and the
"still new" age guard) read the same derived `windowDays`, so a skill can
never be `new` and `dormant` at once.

`SkillDormancyBadge` renders this with `active` in emerald, `dormant` in
amber, and `new` deliberately neutral (slate) rather than green, since it
hasn't earned "active" yet. The badge and the "N uses" counter beside it are
folded from the same events, so `active` is reachable through every path that
exists: a web copy/download, a CLI-reported `download`, a hook/MCP `invoke`, or
a registry sample. The badge says "invoked", "used" or "synced" for the three
kinds rather than collapsing them.

`SkillInvokeChip` shows how often a skill actually **ran**, beside how often it
was read. It is deliberately not labelled "30d": the rollup has no window and
each registry contributor counts over one it chose for itself, so it is a volume,
not a rate — the windowed claim lives in the badge next to it.

### Outcome tracking (score movement since adoption)

`src/lib/org/skill-outcomes.ts` pairs, per adopted repo, the latest scan
strictly before the adoption timestamp with the latest scan at-or-after it,
and reports the overall-score delta and the largest-moving dimension delta
between them. If either side of the pair is missing, the status is
`no-before-scan` or `no-after-scan` rather than a fabricated delta: the code
explicitly treats inventing one as turning the library into "a lie
generator."

**Instrument identity (2026-08-20).** A delta is only a statement about the
practice if both scores came off the same instrument, so the pair must now
agree on `rubricVersion` **and** `engineProvider`. Two further statuses carry
the cases where it cannot: `instrument-mismatch` (both sides declare an
instrument and they differ — `SCORING_RUBRIC_VERSION` has already moved
r6→r7, so part of any cross-version delta is re-weighting, not the practice)
and `instrument-unknown` (at least one side records no instrument at all —
silence about provenance is not evidence of comparability). Both null out
`overallDelta` *and* `dimensionDeltas`. `COMPARABLE_RUBRIC_GROUPS` is the
declared equivalence table and is deliberately **empty**: an unjustified
entry would restore the silent error under a legitimising label.

**First-invoke anchors (2026-08-29).** A repo that demonstrably *runs* a skill but
was never marked adopted — the common case for a fleet driven by the hook rather
than by the tab — is anchored at its **first reported invocation**
(`listSkillInvokeAnchors`, sink A only: the registry lane has no repo dimension by
construction). The anchor is used **only** where that `(skill, repo)` pair has no
adoption row, so an invocation can add an outcome and can never silently re-date
one: the human record always wins. Every check an adoption-anchored row faces —
the pairing bound, the statuses, the instrument match — applies unchanged, and
`SkillOutcome.anchor` says which of the two it was.

**Pairing distance and coverage (2026-08-20).** Each outcome carries
`beforeGapDays` / `afterGapDays` and `withinPairingBound`
(`PAIRING_MAX_DISTANCE_DAYS = 180`, overridable per call): an eighteen-month-old
"before" scan used to be selected as readily as last week's. The bound
**flags, it does not filter** — filtering on an uncalibrated bound would empty
the view in one commit. `aggregateOutcomes` returns the mean delta *inside* an
object that also carries `measured` / `unpaired` / `byStatus`, and
`meanDeltaLine` renders both as one string, so a mean cannot be published
without the population it excluded ("+5 pts mean · 2 of 4 adoptions
measured…") — the point where selection bias would otherwise enter silently.

`SkillOutcomes` renders this with an explicit disclaimer that the
movement is correlational, not causal ("Movement in the same window as the
adoption: correlation, not proof of cause"), and — since 2026-08-29 — marks a
row whose pair straddles the bound with a "wide window" flag carrying both gap
distances in its title. Until then the bound flagged nothing that reached a
reader: the module documents `withinPairingBound` as something "a consumer that
shows the number must show beside it", and the only consumer showed the number
alone.

**Known gap:** the aggregation half (`aggregateOutcomes`, `coverageLabel`,
`meanDeltaLine`, `outsidePairingBound`) has no caller anywhere in `src/`. It is
written and tested so a mean cannot be published without its coverage, but no
surface publishes a mean yet — so the selection-bias guard is currently a
guarantee about a number nobody renders.

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
| `/api/org/skills/events` | `POST` | `telemetry:write` | Batch usage events (`invoke`/`download`/`sync`), sink A. |
| `/api/org/tokens` | `POST`/`GET` | member session only | Mint/list org API tokens. |
| `/api/org/tokens/[id]` | `DELETE` | member session only | Revoke a token. |

## Data model

| Model | Purpose | Key fields |
| --- | --- | --- |
| `OrgSkill` | The library entry. | `name` (unique per org), `description`, `content`, `category`, `tags` (JSON string), `version`, `contentHash`, `archived`, `downloadCount` (denormalized), `createdBy`. |
| `OrgSkillAdoption` | One row per (skill, repo). | `skillId`, `repoFullName`, `adoptedBy`, `adoptedAt`; unique on `[skillId, repoFullName]`. |
| `OrgSkillDownload` | Rolling per-skill use tally. | `skillId` (unique), `count`, `lastSeen`. |
| `OrgSkillEvent` | Append-only per-use event log. | `skillId`, `orgId`, `type` (`invoke`/`download`/`sync`), `repo`, `source` (enum), `detail`, `sessionId`, `dedupeKey` (nullable-unique with `skillId`), `createdAt`. |
| `OrgSkillUsageSample` | Snapshot of the registry `usage/` lane, one row per (registry, contributor, skill). | `registryId`, `orgId`, `contributor`, `skillName`, `invokes`, `windowDays`, `lastUsedAt` (nullable), `generatedAt`; unique on `[registryId, contributor, skillName]`. |
| `OrgApiToken` | Machine-access credential. | `orgId`, `name`, `tokenHash` (unique), `tokenPrefix`, `scopes` (comma-joined), `lastUsedAt`, `revokedAt`. |
| `SkillGeneration` | A standalone log of per-repo onboarding-`SKILL.md` generations. | `repoFullName`, `headSha`, `trackIds`, `generatedAt`. No relation fields to `OrgSkill` or an org. |

`OrgSkillEvent.source` is a validated closed set — `cli | hook | ci | web |
registry | mcp` — normalized in `recordSkillEvents` (see *Usage telemetry*).

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

| Tool | Requires | Plan | Answers |
| --- | --- | --- | --- |
| `cite_memory` ✎ | `mcp:read` + `memory:read` + `telemetry:write` | memory | Records that a delivered memory was (or was not) used |
| `claim_followups` ✎ | `mcp:read` + `followups:write` + `telemetry:write` | — | Leases open follow-ups in one repo so this agent works them and nobody else does |
| `compare_against_exemplar` | `mcp:read` | — | Signal-level diff against a peer repo, the org's best, or a public cohort |
| `find_skills` | `mcp:read` + `skills:read` | skills | Which of the org's skills apply to this task/repo, and why |
| `get_ai_stance` | `mcp:read` | — | Permitted tools/models, no-AI zones, review tiers, approval requirement |
| `get_fix_brief` | `mcp:read` + `followups:write` | — | The working brief + the org's perimeter, for rows this caller HOLDS |
| `get_gate_verdict` | `mcp:read` | — | Would this repo clear the org's gate, and what fails |
| `get_governing_subject` | `mcp:read` + `skills:read` | skills | The registry subject whose `use_when` governs this path/topic |
| `get_practice_shape` | `mcp:read` | — | The reusable *shape* of a practice the org already does well |
| `get_repo_standing` | `mcp:read` | — | Level, adoption vs rigor, per-dimension scores |
| `get_skill` | `mcp:read` + `skills:read` | skills | One skill's body, version, hash and registry path |
| `get_skill_lessons` | `mcp:read` + `skills:read` | skills | Lessons recorded against a skill (its `LESSONS.md`) |
| `list_open_recommendations` | `mcp:read` | — | Gaps the org has already decided matter |
| `recall_org_memory` | `mcp:read` + `memory:read` | memory | Decisions, incidents and conventions already ruled on |
| `report_attempt` ✎ | `mcp:read` + `followups:write` + `telemetry:write` | — | What this agent did with one follow-up it holds. **Cannot close it.** |
| `report_skill_invoke` ✎ | `mcp:read` + `skills:read` + `telemetry:write` | skills | The agent's own report that it ran a skill |

✎ = writes. Sixteen tools; the catalog is a compile-time constant in alphabetical order, so a client
can cache `tools/list` and an LLM's prompt cache stays warm.

`get_fix_brief` sits between the two halves and the placement is deliberate: it **mutates nothing**,
so it carries no `mutates` marker, no `telemetry:write` and no policy row — but it is only ever
answerable for rows the caller HOLDS, and only a token that can claim can hold one, so it is scoped
with `followups:write` all the same.

`mcp:read` is the **door** scope and is deliberately separate from the resource scopes beside it: a
token holding it alone sees only the org-standing tools, and `memory:read` / `skills:read` unlock
their families *on top*. So granting an agent the door does not silently grant it the org's memory or
its curated skills. `tools/list` filters to what the token holds, which the revision explicitly
permits, since credentials are per-request input rather than connection state, so an agent is never
shown a tool it would then be refused.

### Two authorizations: scopes and the plan

A token's **scopes** say what this caller may do; the workspace's **plan** says what this org has.
The door used to check only the first — so an `mcp:read` + `memory:read` token reached an org's
Shared Memory on any plan, while `POST /api/org/memory` refused the same read. Where two doors onto
one store disagree, the looser one is the policy. `resolveMcpGates` (`src/app/api/mcp/gates.ts`)
now resolves `workspaceAllowsMemory` and `workspaceAllowsSkills` once per request, `tools/list`
drops plan-closed tools, and `tools/call` refuses them.

The two refusals are **different in kind, on purpose**:

- **Out of scope** → the same opaque `Unknown tool` a nonexistent tool gets, so the door cannot be
  used to enumerate what an org has that this token cannot reach.
- **Plan-closed** → the reason, in words, on a 200 with `isError`. The caller already holds this
  org's own token, so it has proven it belongs here, and "your plan does not include the Skills
  Library" is a fact somebody can act on. Hiding it would only make the agent report a capability as
  broken.

`selfHosted()` opens both gates through `plans.ts`, so a self-hosted install reaches every tool with
a locally minted token.

### The write door

Four tools write. Two report **the agent's own behaviour** — "I ran this skill", "I used this
memory". Two (moonshot #3) operate the org's **work queue**: they lease follow-ups and record what
happened to them. Neither kind changes a judgement the org made — no practice is adopted, no memory
edited, and **no recommendation is ever closed**. The write door is for evidence and for work
claims, not for decisions, and that boundary is what made shipping writes possible at all.

A write must clear four gates, in order (`src/lib/mcp/write-gate.ts`):

1. `telemetry:write` — never implied by `mcp:read`. A read token stays a read token.
2. The tool's own resource scope. A caller may only write evidence *about* a resource it may read.
3. The plan gate for that resource.
4. A per-token daily ceiling (200 citations, 500 invoke reports, 600 attempt reports, **60 claims**),
   counted from the audit trail. For the evidence writes the ceiling is anti-inflation: self-reported
   evidence feeds a ranking, so volume must not bury the honest signal. For `claim_followups` it is
   anti-**hoarding**: a claim inflates nothing, but an agent looping on it could lease every open row
   in the fleet and make the ledger read empty to everyone else until the leases lapsed.

Then exactly one `AuditLog` row per accepted write, action `mcp.write.<tool>`, actor
`token:<name>`, meta carrying the argument *key shape* and the idempotency key — never the raw
arguments, because a citation `note` is free text an agent wrote. **There is no separate registry
audit table**: `AuditLog` already has the org audit viewer, the retention purge and the integrity
chain, and a second store would fork all three.

`WRITE_TOOL_POLICY` is a **table, not an if-chain**, and that is the extension contract: adding a
write tool is one policy row plus one handler, and a structural test fails the build if a `mutates`
tool has no row or a row has no `mutates` tool. #3 exercised it exactly as written — two rows, three
handlers, and not one line of the gate's own logic touched.

### The work protocol: claim → brief → report

The Follow-ups ledger is a **pull queue any coding agent can serve**. Claude Code, Copilot, Codex,
Cursor, a CI job or a person: they all speak the same four calls, and Ascent runs none of the work.
That is the competitive shape of it — a remediation vendor that only fixes things with its own agent
cannot copy this without conceding the agent.

1. **`claim_followups { repo, ids? | count?, leaseMinutes? }`** — takes rows under a time-limited
   lease (default 45 min, max 4 h). One compare-and-set (`src/lib/db/followup-claims.ts`) arbitrates
   between every worker, the local loop engine included: `count === 1` won, `0` lost, and a row
   somebody else holds comes back in `refused` rather than being stolen.
2. **`get_fix_brief { ids }`** — each gap as the scan stated it, plus the **perimeter**: the org's
   permitted tools and models, its no-AI path zones, the repo's autonomy tier and the org's own review
   sentence for that tier, and the lease expiry. Every line is a stored value; nothing is generated.
3. Your agent does the work, in your harness.
4. **`report_attempt { id, verdict, reason, branch?, prUrl? }`** — `resolved`, `skipped` or
   `needs_human`, the same verdict vocabulary the local lane's `.ascent/lane-report.json` v1 uses
   (one contract, extended, never forked).

**Who may claim.** `claimability()` (`src/lib/org/followups.ts`) authorizes a remote agent against the
repo's **derived autonomy tier**: **T0 refused**, **no assessed tier refused** (unknown is not green —
a repo with no passport has not proven it can be worked unattended), **T1/T2 allowed and flagged for
human review**, **T3 allowed**. A repo matching a declared no-AI zone is refused whatever its tier.
`local` and `human` executors are unaffected: self-hosted consent is the operator's own box.

**What a lease means.** An expired lease releases its rows back to the queue — that is the recovery
path for a crashed agent, not a penalty. The sweep is **lazy** (it runs at the top of a claim), so no
cron is required for the protocol to be correct. A `null` lease on an in-progress row is **not**
expiry: it means a human took the row from the browser hand-off, and the sweep never touches it.

**And this is the answer to the question this catalog used to defer** — *what stops an agent closing
its own recommendation.* **The write path has no verb that closes one.** `status: "done"` is reachable
only from `scans-persist`'s `decideInProgress`: a rescan of the default branch that both stops
restating the gap and measures its dimension moving. `resolved` leaves the row in progress with its
lease cleared; `skipped` returns it to the queue; `needs_human` flags an escalation and leaves the
work visibly open. A commit trailer is a hint, an attempt report is a claim of exactly the same
weight, and neither is a verdict.

Every claim and every attempt writes a `RecommendationEvent` on the row and a `recordAudit` row
(`followup.claim` / `followup.attempt`) with the org resolved, so both are visible in the audit
viewer. `scripts/ascent-work.mjs` is the zero-dependency client (`npx ascent work claim|brief|report|run`)
and `examples/ascent-work.action.yml` is a reference GitHub Action — deliberately outside `.github/`
so it never runs in this repository.

Both writes are idempotent under replay. A citation is unique on `(memoryId, sessionId)` — one
session gets one vote per memory, and changing that vote *moves* it between `citedCount` and
`notUsefulCount` rather than adding to both. An invoke report carries the session plus an
hour-bucketed timestamp, so `OrgSkillEvent`'s `(session, skill, ts)` dedupe key survives a retried
call; the cost is that the event is recorded up to 59 minutes early, which nothing reading these at
day granularity can observe.

### What `find_skills` actually ranks on

Persisted fields only — name, description, tags, category, adoption and download counts — plus one
**declared** map, `CATEGORY_DIMENSIONS`, from the closed skill-category set to the maturity
dimensions a skill in that category plausibly moves. (`CatalogSkillEntry.applicability` / `adopters`
/ `invokes30d` are interface fields with no producer anywhere; ranking on them would have ranked on
`undefined`.) Every result carries a `why`, and the response carries `dimensionBasis`, which is
**`null` with a sentence** when the repo is unscanned or not in the fleet — never a zeroed dimension
list a model would read as a clean bill of health.

`get_governing_subject` resolves through the `file` column the registry index mirrored, **never** by
building a path from a slug — the registry access contract. No registry mapped is an explicit
refusal, not an empty list.

### `compare_against_exemplar`

A thin projection of the exemplar diff engine
([`docs/features/reporting/report.md`](../reporting/report.md)): every number comes from
`diffAcrossRepos`, every resolution from `resolveExemplar`, and this door computes no comparison of
its own — two doors onto one diff must not be able to disagree. It answers what a score cannot: not
*how good is this repo* but *what specifically does a better one have that this one does not*, joined
to the practice that carries each dimension.

Three rules the door adds on top of the engine's contract:

- **The org comes from the token.** There is no `org` input and there must never be one: the resolver
  gates `repo:` and `org:best` on exactly the slug it is given, so an org argument would be a
  caller-supplied tenancy claim.
- **A `cohort:` ref is refused when the subject repository is private.** The refusal protects the
  *subject*, not the cohort (which is aggregate-only and floored at 5 repos across 3 orgs): the answer
  would state a private repository's per-dimension position inside a cross-tenant public
  distribution. The refusal names the two exemplars that *are* available to a private repo.
- **Every non-`ok` resolution is a sentence** — `not-found`, `forbidden`, `below-floor`,
  `unavailable` — and none substitutes another exemplar. A `below-floor` refusal states the
  population it actually had and the floor it needed; an unparseable ref is answered with the real
  options for that repo rather than a guess. A substituted comparison is undetectable to the caller,
  which is why the engine returns a discriminated union rather than a best-effort profile.

When the subject's own latest scan is outside the eligible set (a mock-engine or old-rubric run) the
comparison still renders, with the basis line saying the two sides were produced by different
instruments. House patterns are deliberately not mined here — `get_practice_shape` already serves the
org's own reusable shape, and a second producer of the same thing is how two answers start to
disagree.

### What it deliberately does not do

- **No decisions, only evidence.** No write tool closes a recommendation, adopts a practice, edits a
  memory or opens a PR. Claim/lease semantics for follow-ups are a separate, later item; the
  `WRITE_TOOL_POLICY` seam is where they will attach.
- **Athena is stricter than this door.** The companion dispatches the same handlers in-process and is
  offered **no** write tool on any plan, derived from the `mutates` marker rather than from a list
  that could be forgotten. Skill, lesson, subject and memory bodies reach her model inside the
  untrusted fence: the org wrote that text, ascent did not.
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

## Registry-backed state (UC2, 2026-08-18)

This tab is a **consumer of the org's registry repo** (`docs/features/org-registry/README.md`). One
loader, `src/lib/org/registry-sync.ts`, answers "where does this content live?", and one component,
`src/features/shared/registry/RegistrySyncStrip.tsx`, says it identically here, on Skills and on
Practices — so the three tabs cannot drift in what they claim.

| Registry | What the tab shows |
| --- | --- |
| Not mapped | A pointer strip: "Nothing is backed by a registry yet — … lives only in ascent," linking to the Registry tab. It is a pointer, **not a gate**: hosted rows and the author form render below exactly as before, and nothing on screen names a repo that may not exist. |
| Mapped | The strip becomes the live status — the repo (linked), `indexed <relative time>` (or "mapped, not indexed yet" before the first pass), and the counts the last index pass read out of the repo. |

Per row, once a registry is mapped, an origin marker (`src/features/shared/registry/RegistryOriginTag.tsx`)
distinguishes the two worlds, and the affordances follow it:

- `origin: "hosted"` — ascent's own row; every in-app affordance (edit, archive) is unchanged.
- `origin: "registry"` — a mirror of a file in a repo the customer owns. In-app archive is **replaced**
  by **Open in registry** (a blob deep link built from `registryPath`, rendered only when the indexer
  actually recorded a path, so the link cannot 404 by construction). Editing here would be overwritten
  by the next index pass, so it is not offered.

Before a registry is mapped the marker is not rendered at all — every row is hosted, and "hosted" is
only news once the other world exists.

### Trace — a registry skill's own history (2026-08-30)

A **registry-origin** skill card carries a `Trace` disclosure: the commits over
`skills/<name>/SKILL.md`, grouped by the version each declared, with the lessons
from `LESSONS.md` hanging on the version they were learned against. It is
fetched on open, served from a cache keyed on the registry head, and it renders
`—` wherever a version could not be resolved rather than carrying the
neighbouring one backwards. Full contract:
[`docs/features/org-registry/README.md`](../org-registry/README.md) §The
improvement channel.

A **hosted** skill is offered no Trace. It lives in ascent's own table and has no
git history; offering one would be a promise the shape of the data cannot keep.

`SkillGeneration` is a different store and always was: `src/lib/db/skill-history.ts`
is its only accessor and it logs per-repo onboarding-`SKILL.md` **generations**
(STD-6), not registry skill versions. **Registry skill history is git**, surfaced
as Trace.

## Known gaps

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
| `src/lib/org/skill-event-source.ts` | The closed `source` vocabulary + prefix normalizer. |
| `src/lib/registry/usage-samples.ts` | Registry `usage/` samples → per-skill `invoke` stats (pure). |
| `src/lib/db/org-skill-usage-samples.ts` | `OrgSkillUsageSample` snapshot read/upsert/purge. |
| `scripts/ascent-skills.mjs` | The distributable: sync/push/list/status + `hooks` and `report`. |
| `src/lib/org/skill-outcomes.ts` / `skill-outcomes-load.ts` | Before/after adoption score deltas. |
| `src/lib/org/skill-categories.ts` | Closed category set. |
| `src/lib/mcp/tools.ts` | The tool catalog: scopes, plan gates, the `mutates` marker. |
| `src/lib/mcp/write-gate.ts` | `WRITE_TOOL_POLICY` + `assertWriteAllowed` — the write door's policy table. |
| `src/lib/mcp/registry-reads.ts` | Skill / lesson / subject projections. |
| `src/lib/mcp/registry-writes.ts` | The two write handlers. |
| `src/lib/mcp/skill-match.ts` | Pure ranking + the declared `CATEGORY_DIMENSIONS` map. |
| `src/lib/mcp/exemplar-tool.ts` | `compare_against_exemplar` — the door's projection of the #34 diff. |
| `src/app/api/mcp/gates.ts` | Per-request plan gates + the per-token write ceiling. |
| `src/lib/db/org-memory-citations.ts` | `OrgMemoryCitation` writes/reads + counter bumps. |
| `src/lib/org/skill-templates.ts` | Author-form starter templates. |
| `src/lib/db/org-skills.ts` | CRUD, `toRow()` read-time frontmatter resolution. |
| `src/lib/db/org-api-tokens.ts` | Token mint/verify/revoke, hashing. |
| `src/lib/api-token-auth.ts` | `authorizeOrgApi()`: token-or-session gate for skills routes. |
| `src/features/shared/skills/SkillsPanel.tsx` | Client orchestrator. |
| `src/features/shared/skills/SkillCard.tsx` | Per-skill detail, adopt/copy/download/archive actions. |
| `src/features/shared/skills/SkillDormancyBadge.tsx` | Dormancy status chip. |
| `src/features/shared/skills/SkillInvokeChip.tsx` | "N ran" — the invocation half of the use count. |
| `src/features/shared/skills/SkillOutcomes.tsx` | Score-movement-since-adoption display. |
| `src/features/shared/skills/ApiTokensPanel.tsx` | Token mint/list/revoke UI. |
| `src/app/org/[slug]/skills/page.tsx` | Page composition. |
