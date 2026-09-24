# Scan-sweep backlog plan — 2026-09-22

Scope: the 2026-09-17 develop wave only. Its catalog has 270 findings, and prior waves selected 222 distinct titles. One selected card (viewer roster access) was skipped for a policy decision, while the Polar customer portal was built in its place. Two unpicked entries are already implemented: the Polar portal and Athena memory prefetch. This leaves **47** titles, so this wave cannot supply the requested 100 new items.

Resolution on 2026-09-22: **16 of these 47 findings were committed; 31 remain open.** The latest-wave backlog register now reads 239 built of 270, including prior waves. Each code fix has its own commit and scoped verification. The 16 resolved rows are:

| Plan # | Commit | Plan # | Commit | Plan # | Commit | Plan # | Commit |
| ---: | --- | ---: | --- | ---: | --- | ---: | --- |
| 3 | `95105469` | 6 | `36e085ce` | 7 | `803d103b` | 9 | `cef6ff91` |
| 10 | `9639e85d` | 11 | `c3c40fe8` | 13 | `acfba5dd` | 15 | `280b7f58` |
| 17 | `bcb8d060` | 18 | `a7660a56` | 19 | `b94a1f40` | 21 | `e9905721` |
| 24 | `666b980e` | 33 | `d0f82c72` | 36 | `99a8a217` | 38 | `feae2b35` |

Row 24 now excludes public repos from monthly allowance usage, matching the documented free-public policy. Private BYOM scans still use allowance; changing that would need a product policy decision. The other 31 rows remain in risk order below. Rows 1, 4, 43, and 45-47 are human decisions. Rows 39 and 41 make opposing assumptions about watched repositories with another owner; resolve that policy together. Other rows still need implementation and verification, with their recorded contract and coordination gates respected. No older-outbox finding is counted here.

Order: ascending recorded risk, then S before M before L, then descending impact. Recheck every card against the current tree before editing. `Build` is marked buildable with no hot-file flag; `Coordinate` touches a shared file or contract; `Human` is held by the skill's architecture, irreversible, or unverified-contract gate. Make one verified commit per fix and update the coupled feature doc for user-visible behavior.

| # | Risk | Size | Route | Context | Finding |
| ---: | ---: | :---: | --- | --- | --- |
| 1 | 1 | S | Human | First-Run Onboarding Wizard | Re-judge wizard-flows: mid-scan resume now re-attaches |
| 2 | 3 | S | Coordinate | Maturity Model & Scoring Engine | Score D6 CI enforcement from gitlab-ci, Jenkinsfile, and lefthook, not only Actions |
| 3 | 3 | M | Build | MCP Server | Make recall_org_memory call recallMemories over lifecycleWorkingSet |
| 4 | 3 | M | Human | Members & Access Control | Let viewers read the org roster; keep role writes owner-only |
| 5 | 3 | M | Build | MCP Server | Allow report_skill_invoke to record a registry name that is not yet an OrgSkill row |
| 6 | 3 | M | Build | Repositories & Segments | Auto-tag repos into a segment by CODEOWNERS team, not only language |
| 7 | 3 | M | Build | Trends & Comparison | Diff scoreIntegrity between compared scans |
| 8 | 3 | M | Build | CI Gate & Status Checks | Expose non-D9 dimension floors as gate query and Action inputs |
| 9 | 3 | M | Build | Goals (read-only since 2026-08-17) | Flatten listGoals' latest-scan snapshot the way getOrgBacklog does |
| 10 | 3 | M | Build | Provider Integrations | Fold ingested user/team usage rows into the org rollup or stop accepting them |
| 11 | 3 | M | Build | Scan Pipeline & Ingestion | Grade OSV exposure from pnpm-lock.yaml and Cargo.lock, not only npm |
| 12 | 3 | M | Build | Scan Pipeline & Ingestion | Inventory check suites on recent PR heads, not only the scored commit |
| 13 | 3 | M | Build | Members & Access Control | Let a non-owner member leave the org (reuse last-owner guard) |
| 14 | 3 | M | Build | GitHub App Installation & Webhooks | Page past MAX_PAGES so >5000-repo installs can still reconcile |
| 15 | 3 | M | Build | Roadmap & Recommendation Tracking | Refresh the tracker after a sandbox commit without reload |
| 16 | 3 | M | Build | Fleet Alerts & Digests | Render digest mail as HTML from the weekly digest artifact, not Slack text |
| 17 | 3 | M | Build | Executive Briefing | Replace the no-grade empty state that claims the fleet was never scanned |
| 18 | 3 | M | Build | Live War Room | Retire the wall AutopilotBand as a second start control over the same loop engine |
| 19 | 3 | M | Build | Dev Inspector | Stream seed-history progress instead of a silent 120s wait |
| 20 | 4 | S | Coordinate | Database Client & Schema | Add @@unique([scanId, dimId]) on ScanDimension |
| 21 | 4 | S | Build | Quotas & Rate Limiting | Default trustedProxyHops to 0 unless a platform witness exists |
| 22 | 4 | S | Build | Maturity Model & Scoring Engine | Feed detected tech stack into the assessment prompt by default |
| 23 | 4 | M | Build | AI Registry Repo (Onboarding & Index) | Commit catalog.json after index (catalogWrites is parsed and never used) |
| 24 | 4 | M | Build | Credits & Entitlements | Count monthly allowance with the same predicate that marks a scan billable |
| 25 | 4 | M | Build | Goals (read-only since 2026-08-17) | Do not treat an unmeasured goal metric as current 0 |
| 26 | 4 | M | Build | Org Import, Scan & Watchlist | Enqueue the import batch before scanning, matching /api/org/scan |
| 27 | 4 | M | Build | Developer home (UC3 individual care) | Fill the private session-shape from AgentSession rows for the signed-in login only |
| 28 | 4 | M | Build | AI-Native Passports | Hold CI and security ordinals when workflow content was not read |
| 29 | 4 | M | Build | Live War Room | Let hosted owners arm a remote-agent run from the cockpit gate |
| 30 | 4 | M | Coordinate | Scan Pipeline & Ingestion | Persist sensorFailures so cached and fleet gates keep scan honesty |
| 31 | 4 | M | Build | Trends & Comparison | Pin deploy markers from persisted Deployment rows |
| 32 | 4 | M | Build | Follow-ups Ledger | Route browser hand-off through claimFollowups as executor human |
| 33 | 4 | M | Build | People & Delivery Analytics | Show Copilot seats and engaged users on Delivery instead of a connect-a-provider void |
| 34 | 4 | M | Build | Roadmap & Recommendation Tracking | Write sandbox projected-vs-actual onto the recommendation timeline |
| 35 | 4 | M | Build | GitHub App Installation & Webhooks | Auto-watch GitHub-confirmed repos newly granted on the install |
| 36 | 4 | M | Build | Landing Page Prototypes | Mount ScanModal on the brand Modal (stop hand-rolling fixed inset-0) |
| 37 | 4 | M | Build | LLM Provider Abstraction | Offer Nebius as an org BYOM kind beside Bedrock and OpenRouter |
| 38 | 4 | M | Build | Portfolio & Public Leaderboard | Rank a distinct-repo window, not the top 500 scans |
| 39 | 4 | M | Build | Org Import, Scan & Watchlist | Reject watch/schedule writes whose owner is not the fleet org (or its install) |
| 40 | 4 | M | Build | Playbooks | Stamp playbook adoption only after merge or verified rescan, not on draft PR open |
| 41 | 4 | M | Build | Playbooks | Allow playbook apply on watched repos whose owner is not the org slug |
| 42 | 4 | M | Build | Maturity Model & Scoring Engine | Credit PR-only review/SAST Apps, not just suites on the scored default commit |
| 43 | 4 | M | Human | Live War Room | Surface drive/run outcome on the shared kiosk instead of standing-only LiveWarRoom |
| 44 | 4 | M | Build | LLM Provider Abstraction | Wire CLI schema-constrained output through a temp file, not argv |
| 45 | 6 | M | Human | Checkout & Plans (Polar) | Add planAllows('seats') and enforce PlanFeature.seats on membership writes |
| 46 | 6 | L | Human | Developer home (UC3 individual care) | Land C3 mentor-share so the care loop is not permanently an empty preview |
| 47 | 6 | L | Human | Provider Integrations | Ship the planned OpenAI Codex admin-pull connector behind the existing allocated tier |

## Operator decisions (2026-09-24)

The human rows were decided in session; each is now buildable as stated here, which overrides the card where they differ.

| # | Decision |
| ---: | --- |
| 1 | Re-judge: run `/conform` on First-Run Onboarding Wizard / `wizard-flows` and write the current verdict. |
| 4 | Lower the roster GET to **member** (members, admins, owners read it); viewers stay refused. Writes and invites stay owner-only. |
| 39 + 41 | Build both as one policy. 41: playbook apply, apply-batch and mark accept any repo already in the org's watched/admitted set, and still refuse a random owner. 39: on a hosted deployment a watch write must be org-owned or on the org's App installation; self-hosted keeps free-form watching (no credits at stake). |
| 43 | The shared kiosk link gets a counts-only outcome summary (runs, verified closes, points in review); no repo names, commit text or lane logs. |
| 45 | Stop selling a seat count instead of enforcing it: remove seats from the plan cards, the pricing matrix and the self-host pricing line, and say so in `billing.md`. |
| 46 | Build C3 mentor-share (L, architecture; personal tables need a migration). |
| 47 | Build the OpenAI Codex admin-pull cost connector (L, architecture); verified against a recorded fixture, not the live API. |
| 35 | Auto-watch repos newly granted on the install, as the finding says: only from the complete live GitHub list, only when the org already has a watchlist, at most 20 per event, hosted and self-hosted alike. This reverses the webhook's "added repos stay opt-in". |
| 27 (follow-up) | The private session shape matches the viewer's own sessions by login OR an email the auth provider has confirmed for them; never anyone else's. |

## Resolution on 2026-09-24: all 31 open rows landed

Built in six waves of five builders on `master` (none pushed), each wave integrated on the combined tree with
the full gate green (whole-tree `tsc`, the full vitest suite, eslint on every changed file, the
contract-duplication check; `prisma validate` after the last wave). The register now reads **270 built of 270**.
The code commit of each row (its doc commits follow it in history):

| # | Commit | # | Commit | # | Commit | # | Commit |
| ---: | --- | ---: | --- | ---: | --- | ---: | --- |
| 1 | `f7175cd5` | 2 | `514b9309` | 4 | `ee060f0b` | 5 | `c605a770` |
| 8 | `1eb84c67` | 12 | `6e9a8f1d` | 14 | `857c7dc2` | 16 | `f8c2560a` |
| 20 | `60ca13ce` | 22 | `afed84cf` | 23 | `0b61ea19` | 25 | `fb0c8ccd` |
| 26 | `51fd5c43` | 27 | `9a89381b` | 28 | `31c8d877` | 29 | `70dea1a9` |
| 30 | `9e48ff5c` | 31 | `0f848b56` | 32 | `aa24f5fa` | 34 | `f3537055` |
| 35 | `38bcbe76` | 37 | `743c509b` | 39 | `9fe8b68c` | 40 | `64234869` |
| 41 | `8f2089b8` | 42 | `2b0913dc` | 43 | `45f42950` | 44 | `0bbbf124` |
| 45 | `42f6609b` | 46 | `449f73db` | 47 | `22ac38cb` | 27 follow-up | `548d84bb` |

Row 1 re-judged `wizard-flows`: the 2026-08-23 evidence is fixed, but the verdict stays `deviation` on new evidence
(see the follow-ups). One coordinator fix landed at integration: `d822b737` makes the customer-repo door mint another
owner's installation token only on a DECLARED self-host (`ASCENT_SELF_HOSTED=1`), never on the inferred one.

**What a deploy of this range carries.** The rubric moved r19 -> r22 (rows 2, 22, 42): deployed together that is
one cache-wide re-score, not three. Four additive migrations: `20260924120000_add_scan_dimension_unique` (on Aurora
DSQL create the index by hand with `CREATE UNIQUE INDEX ASYNC`, then mark the migration applied; the header has the
command), `20260924140000_add_scan_sensor_failures`, `20260924160000_add_mentor_share`,
`20260924170000_add_provider_credential`.

## Follow-ups the drain surfaced (not built)

Each was found by a builder while landing its row, recorded as a Known gap in the named doc where it is
user-visible, and is open work for a later pass:

| From | Follow-up | Where it is recorded |
| --- | --- | --- |
| row 1 | `wizard-flows` still a deviation: the scan's `runId` lives only in one tab's sessionStorage, so a new tab or device does not see a running scan; an unreadable saved state silently starts fresh | `.ai/registry-map.json` |
| row 26 | The onboarding wizard shows the queued import tail as "not scanned" until a refresh | `docs/features/fleet/rescan.md` |
| row 28 | Unassessable observability and tests passport axes are still scored 0 (the CI/security hold could reuse `isRungHeld`) | this table |
| row 32 | Athena's `handoff_followups` is a third claim path that still sets no claim columns | this table |
| row 40 | A playbook PR closed without merging stays "proposed": nothing detects the close | `docs/features/org-dashboard/practices.md` |
| row 46 | `npx ascent mentor share` has no per-person credential to send (every bearer token belongs to an org) | `docs/features/org-dashboard/developer.md` |
| row 47 | Org erase never deletes `AiUsageRecord` rows, so an erased org's provider usage and cost history survives | this table |
| row 47 | A partial OpenAI cost pull is marked on Integrations but not on Delivery | this table |
| row 35 | A repo removed from the install and granted again, or scanned but never watched, is not auto-watched (no record of who unwatched) | `docs/features/github/github-app.md` |
| row 2 | `.husky` hook bodies are not read; D3's CI signals are still Actions-only; local scans do not reserve bytes for non-Actions CI configs | `docs/features/scanning/scan.md` |
| challenge 09-23b | `scans-persist.ts` drops a claimed row kept for `mock-scan` / `within-noise` from the ledger | this table |
| rows 26, 32 | Dead after this drain: `claimRepoWork` (`src/lib/db/scan-jobs.ts`) and `handoffRecommendations` have no product caller | this table |

Progress is recorded in scan-sweep history and commits. Preserve unrelated worktree edits; never push.
