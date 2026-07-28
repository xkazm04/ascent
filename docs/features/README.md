# Features

These documents describe the **implemented product surface** of Ascent — the
maturity index for AI-native engineering. They are written for users, developers,
and automation/CI agents that need a stable reference to how each feature actually
works.

Ascent points at a GitHub repository (or a whole org), reads its structure, config,
tests, CI/CD, docs, commits, and pull-request signals, and produces an **AI-Native
Maturity Score** (Level 1–5) across **9 weighted dimensions (D1–D9)** — with
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
elsewhere remain undocumented — each area README lists its own.

## Maintenance notes

- A feature doc should name the UI entry point, the primary user flows, the API
  surface, the data/storage model, and known limitations.
- Long forward-looking sections belong in a `roadmap.md` or at `docs/` top level,
  not in a feature doc. Keep only a short "Known gaps" section here.
- If a feature is tier-gated or behind a dev flag, say so explicitly.
- **State limitations as of a date, or not at all.** The most damaging drift the
  audit found was not missing docs but confidently-asserted "Known gaps" that the
  code had since closed — `practices.md` and `org-planning/plan.md` each told
  readers a capability was absent while it shipped.
- When you add a feature area, add an entry to
  [`../../scripts/docs/feature-doc-map.json`](../../scripts/docs/feature-doc-map.json)
  in the same change so the doc-sync Stop hook covers it.
