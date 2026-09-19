# Agent behaviour ledger: OTLP sessions as UC3's second sensor

_Concept doc · deck item **#23** (`concept-doc first`, XL, gate `policy`) · 2026-08-29 · written against the
working tree on `fix/gate-lint-unescaped-entities-20260827`. Every `file:line` below was re-read; where the
finding's premise drifted it is corrected in §1. Companion docs: the credential lane concept doc
[`docs/resolutions/developer-credential-lane.md`](developer-credential-lane.md) (deck **#22**) and
[`docs/REGISTRY-AND-CARE-IMPL.md` §5](../REGISTRY-AND-CARE-IMPL.md) (UC3 Care)._

---

## The question

The org already receives per-session Claude Code telemetry and throws away everything about *how the
agent was used* — model, tools, permission decisions, every `/v1/logs` event. Reinstating those
dimensions is a two-day parser change. **The reason this needs a doc before code is the identity
question, not the parsing question.**

`AgentSession.userKey` today holds a developer's raw work email, written by whoever holds the org's
ingest token, read by nobody. The moment anything resolves that key to a person, ascent turns an
org-held telemetry stream into a per-person behaviour record — which is exactly the manager-first
product shape the Developer route was built to refuse (`developer-view.ts:1-20`). The design must
answer three things a spec cannot decide on its own:

1. **What proves a link?** The ingest token is org-wide. Anyone holding it can post a session
   asserting any `user.email`. A link built on "paste the email your exporter sends" therefore lets a
   developer claim a colleague's sessions, and lets an admin fabricate a person's behaviour record.
2. **What may the org see?** Session shape is far more revealing than commit counts. `CHAMPION_MIN_POP`
   floors a *list of names*; there is no floor today on a *distribution*.
3. **What is stored at all?** OTLP log events can carry prompt text when the operator sets
   `OTEL_LOG_USER_PROMPTS=1`. The privacy ledger promises, in the negative and permanently, that
   transcripts never leave the machine (`developer-view.ts:181-192`). A parser that reads a `prompt`
   key would break that promise silently, on someone else's configuration change.

---

## Ground truth in code today

**All six premises in the finding hold.** Two are sharper than the finding stated.

- **Logs are accepted and discarded.** `src/app/api/integrations/ingest/v1/logs/route.ts:12-19` —
  `guardIngest` → bounded drain → `202 { accepted: true, persisted: false }`. No parser exists.
- **The metrics path reads four resource attributes and one datapoint attribute.**
  `otlp.ts:153,160` (`git.repository`, `user.email|user.id`); `sessions.ts:125,127,132`
  (`session.id`, `git.repository`, `user.email|user.id`); `sessions.ts:176-178` — `type` on
  `claude_code.lines_of_code.count` is the only datapoint attribute read anywhere. `KNOWN_METRICS`
  (`otlp.ts:104`) and `SESSION_METRICS` (`sessions.ts:44-50`) are both closed allowlists, so
  `claude_code.code_edit_tool.decision` and `claude_code.active_time.total` are counted as
  `unknown-metric` and dropped by value.
- **`AgentSession` carries no behaviour dimension.** `prisma/schema.prisma:841-866`: tokens, cost,
  commits, PRs, lines. No model, tool, decision, turn or error column.
- **`userKey` is stored in the clear and only counted.** `schema.prisma:847-849` documents it as "an
  opaque per-user key (email or id as the exporter sent it)" — *opaque* is aspirational; it is a
  plaintext email. `agent-sessions.ts:139-141,181` select it solely to size a `Set` for `people`.
  It is exposed by no route. **Correction to the finding:** the work is not "resolve an existing
  hash", it is "stop storing the plaintext and introduce a keyed hash".
- **The care loop is honestly empty.** `developer-view-load.ts:19-21` (the real path is the git-side
  slice only), `:75-78` (`getCareOrgAggregate` → `emptyOrgView(totalContributors)`).
  `CareSessionShape` (`developer-view.ts:58-65`) and `CareOrgView.shapeBands` (`:146`) have no
  producer; `activity` is unfloored by an explicit rationale (`:98-103`) — *the floors exist to stop
  the org reading a person, not to stop a person reading themself*. That sentence is the whole
  licence this proposal runs on.
- **`CHAMPION_MIN_POP = 3`** with the producer-side contract in `champions.ts:1-24`: the floor is
  enforced by data producers, never re-derived at call sites.

Two facts the finding did not carry, both material:

- **Nothing purges `AgentSession`.** `retention.ts` deletes `Scan` (+ dimensions/recommendations)
  and `AuditLog` only (`:215-219,247-251`); grepping `agentSession` across `src/lib` returns
  `db/agent-sessions.ts` and nothing else. Today's plaintext `userKey` rows are kept forever, and
  an org erase does not reach them. This is a defect *now*, independent of #23.
- **Ingest is not plan-gated.** No `plans.ts` / `entitlement.ts` reference to ingest exists, so the
  behaviour ledger inherits "on wherever the connector is configured" — including self-hosted.

---

## Design options

### Option A — Dimensions without identity

Retain model / tool / decision counters and the log-event counts on `AgentSession` +
`AgentSessionEvent`; expose **only** repo-scoped cost-by-model and floored org aggregates. Never
resolve `userKey`. `DeveloperView.shape` stays empty until the local `/mentor` skill (C2/C3) ships.

*For:* zero new surveillance surface; smallest diff; unblocks the Tiger lens-C question (cost per
produced-code session, by model) at fleet scale on Delivery; can land in one wave.
*Against:* the item's headline claim — "a developer sees how they actually work" — is not delivered.
UC3's second sensor stays a first sensor for the org only, which is the inversion the Developer route
exists to prevent.

### Option B — Self-asserted email link (the finding's proposal)

`UserTelemetryLink(login ↔ userKey)`, created by the developer pasting the `user.email` their exporter
sends, from their own Developer page.

*For:* trivial; no new machine-side configuration.
*Against:* **it is unauthenticated in both directions.** A developer can paste a colleague's address
and read their sessions; an admin holding the ingest token can post sessions under any address and
manufacture a behaviour record for a named person. The link is a claim about a string an untrusted
party wrote. Fixing it by verifying the address against the viewer's GitHub verified emails needs a
user-to-server token, i.e. it becomes dependent on deck **#22**
([`developer-credential-lane.md`](developer-credential-lane.md)) rather than being self-contained.

### Option C — Claim-code link, keyed hash, floored distributions (**recommended**)

Three parts, each independently landable:

1. **Proof by possession, not by assertion.** The Developer page mints a one-shot
   `ascent.claim = asc_<22 random chars>` and shows the one line to add to the machine's exporter
   config (`OTEL_RESOURCE_ATTRIBUTES=...,ascent.claim=asc_…`). The next export carrying that
   attribute binds *that machine's* `userKey` to the login that minted the code; the code is consumed
   on first use and expires in 24h. The claim proves the linker controls the machine that sends the
   telemetry — the only thing worth proving here — and no colleague's key can be claimed by typing it.
   `pending → linked` is visible on the page, so a claim that never arrives says so.
2. **`userKey` becomes unreadable by construction.** Store `userKeyHash = HMAC-SHA256(secret, lower(userKey))`
   and stop persisting the plaintext (backfill: hash-then-null in a migration step). `UserTelemetryLink`
   holds `login + userKeyHash`. Resolution is one-way: the owner's own link resolves; there is no query
   from a hash to a person, and no org-side read selects the column. This upgrades the *existing*
   plaintext-email defect at the same time.
3. **A floor on distributions, not just on lists.** `CHAMPION_MIN_POP` extends from "may we name
   individuals" to "may we emit a band": a `CareBand` is produced only from ≥ `CHAMPION_MIN_POP`
   *distinct linked developers*, and quartiles are suppressed wholesale below it (`belowFloor`, the
   shape `emptyOrgView` already carries). `CareOrgView` gains no per-person field — the type stays
   structurally incapable of carrying one (`developer-view.ts:130-136`).

*For:* delivers the developer-facing half honestly; the org side is strictly weaker than what
Contributors already shows; the plaintext-key defect is repaired rather than built upon.
*Against:* one manual step on the developer's machine; a fleet using a shared collector that rewrites
resource attributes cannot link at all (honest "not linkable here" state, not a fallback guess).

**Against the guardrails.** G4 binds hardest: every dimension is honest-null when the exporter's
version does not emit it (a Claude Code build without `code_edit_tool.decision` yields `null` denials,
never `0` — "unknown ≠ 0"), and no band is emitted from a sub-floor population. G2: the counted
evidence line behind a move ("11 denials on `Bash(npm test)` in 30 days") is a count with its
denominator, not a catalogue label. G1/G5/G6/G9 are untouched (nothing here goes near the scoring
guardband or the PDF). G8 untouched.

**Self-hosted.** `selfHosted()` turns plan gates off; it must **not** touch the floors. A single-tenant
self-hosted instance is exactly where a two-person org would otherwise get a readable "distribution".
The floor is a privacy property, not an entitlement — same reasoning as the escape-hatch-flag rule in
`AGENTS.md` (the constraint lives with the definition, not at the call site).

**Fit with the accepted deck.** #11 (unified LLM meter) prices **ascent's own** inference lanes; this
ledger measures **the developer's own agent** running on their machine. They must never be summed into
one number: the two carry different provenance (`measured` connector vs. metered lane) and different
payers. Where both appear on Delivery, they are separate rows with their existing provenance groups.
#27 (remediation economics) is the third cost surface — ascent's autopilot lanes — and is likewise
disjoint. #19's invoke channel is the natural producer for `skillInvokes30d`; this doc does not
duplicate it.

---

## Recommendation

**Adopt Option C, split across two waves.** Land A's substrate first (dimensions, event counts,
retention, the hash migration) — it is unblocked, useful on its own, and carries no identity risk.
Land the claim-code link and the developer-facing shape second, once the substrate has real rows to
read. Do not adopt Option B in any form: a link that can be asserted by a third party is worse than
no link, because it produces a per-person record that *looks* authoritative.

Ship order inside C: parser + storage → retention/erase → hash migration → claim link →
`DeveloperView.shape` → floored `shapeBands` → cost-by-model → the two rule-based move producers
(which need C3's `moves` table and should sequence after it, not carry it).

---

## Decisions for the owner

1. **Adopt Option C over A or B?** — recommended **yes** (C, phased as above).
2. **Claim code on the machine, or pasted email?** — recommended **claim code** (A/B: A = claim code).
   Accept the one-line exporter edit as the cost of a link nobody else can forge.
3. **Stop storing plaintext `userKey`, hashing existing rows in place?** — recommended **yes**, and
   land it whether or not the rest of #23 proceeds.
4. **Extend `CHAMPION_MIN_POP` to gate quartile bands, not only named lists?** — recommended **yes**.
5. **Do the floors apply on self-hosted?** — recommended **yes** (floors are not plan gates).
6. **Retain behaviour rows for 180 days by default, and include them in org erase?** — recommended
   **yes**; today's answer is "forever, and erase misses them".
7. **Parse `/v1/logs` at all, or derive turns/errors from metrics only?** — recommended **parse, with a
   key allowlist**: only `claude_code.{user_prompt,tool_result,api_request,api_error,tool_decision}`
   events, only their numeric/enum attributes, never a free-text value. A guard test asserts the
   parser cannot emit a string outside the allowlisted enums even when the payload carries `prompt`.
8. **May the org see a per-repo model/tool footprint?** — recommended **yes for cost by model**
   (spend, already repo-scoped and visible today) and **no for behaviour dimensions** below the floor
   (denials, plan-mode share) — a one-developer repo is a person.
9. **Is the link listed as a revocable row on the privacy ledger?** — recommended **yes**, with unlink
   deleting the link row *and* the derived shape cache, leaving the anonymous session rows intact.
10. **Does #23 wait on #22?** — recommended **no**: Option C is deliberately independent of the
    credential lane. If #22 lands first, its GitHub-verified emails become a *second*, optional link
    path — never a replacement for the claim code.

---

## Preconditions

- **A live exporter with a known Claude Code version.** The attribute names this design reads
  (`claude_code.code_edit_tool.decision`, its `tool`/`decision` attributes, the log event names) must
  be confirmed against one real export captured from the current CLI before the parser is written —
  the same discipline `sessions.ts:113-120` applied to `session.id`. Capture it into a fixture; every
  parser test runs off that fixture, not off a hand-written body.
- **Decision 3 lands first.** The hash migration must precede any read path that resolves a key,
  or the plaintext window widens instead of closing.
- **C3's personal tables** (`MentorMove` / journal, `docs/REGISTRY-AND-CARE-IMPL.md` §5.4) exist
  before the move producers write rows. Until then the shape strip renders and the moves board stays
  the honest empty state.
- **A named HMAC secret** with a documented rotation story (rotation re-links nothing; it orphans
  existing links, so rotation implies a re-claim prompt — decide this before the first rotation, not
  during one).

---

## Write set if accepted

- **Prisma (schema pass, never a builder):** `AgentSession` + `model String?`, `toolMixJson String?`
  (TEXT, no jsonb), `permissionDenials Int?`, `turns Int?`, `apiErrors Int?`, `userKeyHash String?`
  (`@@index([orgId, userKeyHash])`), and `userKey` retired to nullable-then-dropped.
  New `AgentSessionEvent { id, orgId, sessionId, kind, count Int, durationMsTotal Int?, day DateTime,
  @@unique([orgId, sessionId, kind, day]) }`.
  New `UserTelemetryLink { id, orgId, login, userKeyHash, claimCode String?, claimedAt DateTime?,
  createdAt, @@unique([orgId, login]), @@unique([orgId, userKeyHash]) }`. Plus `prisma/init.sql` and
  the PGlite reconcile.
- **Edit:** `src/lib/integrations/otlp.ts` (widen `KNOWN_METRICS`, keep the skip accounting honest),
  `src/lib/integrations/sessions.ts` (model/tool/decision attributes; `ascent.claim` passthrough),
  `src/app/api/integrations/ingest/v1/logs/route.ts` (parse instead of drain; `persisted` becomes
  true), `src/lib/db/agent-sessions.ts` (write the new columns; cost-by-model rollup;
  `buildUnitEconomics` split), `src/lib/db/retention.ts` (behaviour rows in purge + erase),
  `src/lib/org/developer-view.ts` (no new field on `CareOrgView`; `sharing` ledger rows for the link),
  `src/lib/org/developer-view-load.ts` (`shape`, `orgBands`, `shapeBands`),
  `src/features/bought/contributors/CareOrgAggregate.tsx` (bands render real data).
- **Create:** `src/lib/integrations/logs.ts` (pure event parser + allowlist),
  `src/lib/integrations/session-shape.ts` (pure: rows → `CareSessionShape`, rows → `CareBand` under
  the floor), `src/lib/db/telemetry-link.ts`, `src/app/api/me/telemetry-link/route.ts` (POST/DELETE,
  identity-gated exactly like `/api/me/watch/route.ts:49-53` — the target is the viewer's own login).
- **Director-owned lines requested:** `src/lib/db/index.ts` exports for `telemetry-link.ts`;
  `context-map.json` `filePaths` for the two new pure modules; `feature-doc-map.json` glob for
  `src/lib/integrations/**` → `docs/features/org-dashboard/developer.md`;
  `src/lib/db/wire-safe-dates.test.ts` entries for any new client-crossing row type (all timestamps
  declared `string`).
- **Tests:** extend `src/lib/integrations/sessions.test.ts` and `otlp.test.ts`; new
  `src/lib/integrations/logs.test.ts` with the content-leak guard (fail-before: a body carrying
  `prompt` yields a stored string) and `session-shape.test.ts` with the floor guard (fail-before:
  a two-person population emits quartiles).
- **Docs:** `docs/features/org-dashboard/developer.md` — the "care loop has no data layer" gap is
  narrowed, not deleted (the org-side sensor lands; C3's personal tables are still pending), and the
  privacy ledger section gains the link row.
- **MUST NOT TOUCH:** `prisma/schema.prisma`, `init.sql`, `src/lib/db/index.ts`, `context-map.json`,
  `feature-doc-map.json` (all Director-owned); `src/components/org/shared/champions.ts` beyond adding
  a band predicate beside the existing floor.
- **Handoffs:** #19's lane (W1-D) owns `skillInvokes30d`'s producer — request the read, do not build
  a second counter. #11's lane (W1-C) owns `/usage`; the cost-by-model row on Delivery must land
  beside its provenance groups, not inside its meter.

---

## Out of scope

- **#22 Developer-held credential lane** (concept-doc, [`developer-credential-lane.md`](developer-credential-lane.md))
  — user-to-server GitHub tokens. This doc deliberately does not depend on it.
- **#21 GitHub identity graph sync + scoped membership** (deferred) — no team/RBAC derivation here.
- **#11 Unified LLM meter** (accepted) — ascent's own inference lanes stay a separate ledger with
  separate provenance.
- **#27 Remediation economics** (accepted) — autopilot lane cost is a third, disjoint cost surface.
- **#24 Billing account above the tenant** (deferred) — nothing here pools or bills agent spend.
- **C2/C3, the local `/mentor` skill and its personal tables** — this is the *second* sensor; it does
  not replace the first, and it never reads a transcript.
