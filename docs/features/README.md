# Features

These documents describe the **implemented product surface** of Ascent, the
maturity index for AI-native engineering. They are written for users, developers,
and automation/CI agents that need a stable reference to how each feature actually
works.

Ascent points at a GitHub repository (or a whole org), reads its structure, config,
tests, CI/CD, docs, commits, and pull-request signals, and produces an **AI-Native
Maturity Score** (Level 1–5) across **9 weighted dimensions (D1–D9)**, with
evidence, benchmarks, and a prioritized roadmap.

For the *conceptual* model behind the scores, see [PRD.md](../PRD.md) and
[scanning/maturity-model.md](scanning/maturity-model.md).

## Layout

**One folder per context-map group.** `context-map.json` at the repo root
partitions every source file into a context, and contexts into groups; this tree
mirrors that partition exactly, so "which doc covers this file?" has the same
answer as "which context owns this file?". Each folder's `README.md` is its index
and carries that area's known gaps.

| Area | Context-map group | Docs |
| --- | --- | --- |
| [scanning/](scanning/README.md) | Repository Scanning & Scoring | scan · maturity-model · calibration · gate · llm-providers · llm-model-matrix · async-scan-aws |
| [github/](github/README.md) | Identity & GitHub Connectivity | auth · github-app · setup |
| [onboarding/](onboarding/README.md) | Onboarding, Shell & AI Standard | wizard · ai-manifest-spec |
| [fleet/](fleet/README.md) | Org Scanning & Fleet Rollups | alerts · rescan · enterprise |
| [org-dashboard/](org-dashboard/README.md) | Org Dashboard & Analytics | practices · org-intelligence · roadmap |
| [org-planning/](org-planning/README.md) | Org Planning & Execution | plan |
| [org-knowledge/](org-knowledge/README.md) | Org Knowledge & Skills | memory · skills |
| [reporting/](reporting/README.md) | Reporting & Visualization | report |
| [billing/](billing/README.md) | Billing, Credits & Metering | billing · usage · badge |
| [data/](data/README.md) | Data & Persistence | data-model · retention |
| [design-system/](design-system/README.md) | Marketing Site & Design System | — *(not yet documented)* |

## Feature overview

What ships, grouped by what unlocks it (moved here from the README; on a self-hosted deployment
every group below is open, the headings name the *inputs* each one needs, not a paid tier).

### Free & public: no signup

Everything here works anonymously, with or without an LLM key, including **running** a scan,
not just reading one.

- **Scan any public repo** → a full, auditable report. No signup. Bounded by a shared burst rate
  limit and a rolling monthly free-scan allowance, not by a login. (Operators who need to wall the
  anonymous funnel on their own deployment can set `ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN=1`;
  private / installed-org scans always require sign-in.)
- **Live streaming report**: determinate progress UI over SSE; score ring, level ladder,
  adoption × rigor posture, dimension radar, per-dimension evidence/gaps with a
  signal→LLM→blended **provenance track**, contributor AI-attribution, PR signals, a
  prioritized roadmap, and LLM-vs-detector discrepancies. ([report.md](reporting/report.md))
- **Shareable maturity badge**: Shields-style SVG (level *or* pass/fail gate mode), cached
  and rate-limited, with a [`/badge`](../../src/app/badge/page.tsx) generator that copies
  ready-to-paste Markdown / HTML / AsciiDoc. ([badge.md](billing/badge.md))
- **PR maturity gate**: a published GitHub Action scores a PR head and fails CI if the repo
  falls short of an archetype-aware policy, so teams can **block merges** on AI-native
  maturity. ([gate.md](scanning/gate.md))
- **Onboarding**: scan a *whole public org* (pick → select repos → stream) without
  installing anything; feeds straight into the org dashboard. ([wizard.md](onboarding/wizard.md))
- **Landing leaderboard**: when persistence is on, the homepage shows a live
  recently-scanned rail and a most-AI-native leaderboard.

### With a token and a database: private repos

Unlocked with a `GITHUB_TOKEN` (or a GitHub App installation) plus `DATABASE_URL`.

- **Private-repo scans**: via a personal token or short-lived App installation tokens.
- **History & trends**: every scan is persisted; the report adds a maturity-over-time
  trend chart and per-dimension sparklines ([`/trends`](../../src/app/trends/page.tsx)).
- **"What changed" diff**: compare any two scans ([`/report/compare`](../../src/app/report/compare/page.tsx)):
  level/posture transitions, per-dimension deltas, opened/closed gaps, "why it moved".
- **Recommendation tracker**: mark each roadmap item open → in progress → done, persisted
  (degrades to a read-only roadmap without a DB).

### With the GitHub App: org & enterprise

The B2B layer. Requires the GitHub App and `DATABASE_URL`; auth-scoped when OAuth is on.

- **GitHub App**: install on an org to reach private & org-wide repos, mint short-lived
  installation tokens, **auto-gate PRs** (Check Run + sticky comment), and **re-scan on
  push**. ([github-app.md](github/github-app.md))
- **Org intelligence dashboards** ([org-intelligence](org-dashboard/org-intelligence.md)) under `/org/[slug]`:
  - **Overview**: fleet maturity, adoption/rigor, a **Trajectory forecast** (ETA to next
    level), gap analysis, movers, posture distribution, and highest-leverage fleet moves.
  - **Repositories**: repo leaderboard + repo × dimension heatmap.
  - **Contributors**: AI champions, involvement, concentration / bus-factor.
  - **Delivery**: PR signals, branch governance, 12-week fleet commit activity.
  - **Practices**: the Practice Library (below).
  - **Plan**: goals, a what-if **simulator**, initiatives, and the detector calibration
    backlog. ([plan.md](org-planning/plan.md))
  - **Audit**: searchable, keyset-paginated audit trail.
- **Practices**: turn a roadmap insight into a concrete, language-aware starter file and
  **open it as a draft PR** in the target repo (one practice per dimension). ([practices.md](org-dashboard/practices.md))
- **Usage metering**: public (free) vs private (billable) scans, by provider, with a daily
  trend and CSV/JSON export ([`/usage`](../../src/app/usage/page.tsx); IDOR-guarded). ([usage.md](billing/usage.md))
- **Regression alerts**: re-scans that demote a repo (or slide it into "ungoverned") post a
  Slack-compatible alert and an audit entry. ([alerts.md](fleet/alerts.md))
- **Scheduled jobs**: cron-driven autoscans of watched repos + retention/purge enforcement.
  ([rescan.md](fleet/rescan.md), [retention.md](data/retention.md))
- **Private inference via AWS Bedrock**: `LLM_PROVIDER=bedrock` routes code to Claude on
  Bedrock; code never leaves the AWS boundary and is never used for training. ([llm-providers.md](scanning/llm-providers.md))
- **Optional GitHub OAuth**: signs users in to scope private org data and their App
  installations; entirely env-gated (the app works fully anonymous when unset). ([auth.md](github/auth.md))

### Self-hosted only: the local loop

- **Local mode**: pair a fleet repo to a folder on the server, scan from disk (unpushed commits
  included), close follow-ups on commit via the `Ascent-Resolves:` trailer, and run the autopilot
  improvement loop in an isolated worktree. ([local-mode/README.md](local-mode/README.md))
- **The agent door**: a read-only MCP server at `POST /api/mcp` that puts the org's standing, gate
  verdict, open gaps, AI stance and practices one call away from a coding agent.
  ([skills.md](org-knowledge/skills.md#the-agent-door--mcp-server-w5-2026-08-14))

## Freshness at a glance

A six-agent audit on **2026-07-28** classified every doc in this tree against
source; a remediation pass the same day closed most of what it found. Full evidence
and the audit method: [`../DOC-DRIFT.md`](../DOC-DRIFT.md).

| Verdict | Docs |
| --- | --- |
| CURRENT | scan · maturity-model · calibration · gate · llm-providers · llm-model-matrix · async-scan-aws · ai-manifest-spec · alerts · rescan · practices · org-intelligence · report · billing · data-model · retention · memory · skills |
| STALE | github-app · github/setup · wizard · badge · usage · fleet/enterprise · org-dashboard/roadmap · org-planning/plan |
| OUTDATED | — |

One group (**design-system**) still has no doc, and roughly a dozen shipped surfaces
elsewhere remain undocumented; each area README lists its own.

## Maintenance notes

- A feature doc should name the UI entry point, the primary user flows, the API
  surface, the data/storage model, and known limitations.
- Long forward-looking sections belong in a `roadmap.md` or at `docs/` top level,
  not in a feature doc. Keep only a short "Known gaps" section here.
- If a feature is tier-gated or behind a dev flag, say so explicitly.
- **State limitations as of a date, or not at all.** The most damaging drift the
  audit found was not missing docs but confidently-asserted "Known gaps" that the
  code had since closed: `practices.md` and `org-planning/plan.md` each told
  readers a capability was absent while it shipped.
- When you add a feature area, add an entry to
  [`../../scripts/docs/feature-doc-map.json`](../../scripts/docs/feature-doc-map.json)
  in the same change so the doc-sync Stop hook covers it.
