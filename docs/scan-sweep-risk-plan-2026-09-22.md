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

Progress is recorded in scan-sweep history and commits. Preserve unrelated worktree edits; never push.
