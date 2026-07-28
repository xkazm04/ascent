# Org Scanning & Fleet Rollups

Importing an org, keeping its repos rescanned on a cadence, rolling many repo
scores into a fleet standing, and alerting when the fleet moves.

Context-map group: **Org Scanning & Fleet Rollups** (`data`).

| Doc | Covers | Freshness |
| --- | --- | --- |
| [alerts.md](alerts.md) | Regression/promotion detection, dispatch, cooldown, weekly fleet digest | CURRENT |
| [rescan.md](rescan.md) | The scheduled fleet rescan: claim lease, credits, concurrency, outcomes | CURRENT |
| [enterprise.md](enterprise.md) | The org system as originally built (E1–E5) | STALE — "as-shipped" claim no longer holds |

Purge/retention moved to [`../data/retention.md`](../data/retention.md) when the old
`cron-and-retention.md` was split — the two crons had diverged far enough that one
doc served neither.

## Implementation roots

- `src/lib/alerts.ts`, `src/lib/scan-alerts.ts` — detection + dispatch
- `src/app/api/cron/rescan`, `src/app/api/cron/digest`, `src/app/api/cron/purge`
- `src/app/api/org/{import,repos,scan,active,alerts}`
- `src/lib/db/{org-watch,org-rollup,org-insights,org-alerts,members,invites}.ts`
- `src/lib/pool.ts`, `src/lib/window.ts` — bounded concurrency, time windows
- `src/lib/authz.ts` — `requireOrgAccess` / `canReadOrg`

> `src/lib/db/org.ts` is a ~114-line **re-export barrel**, not the implementation.
> Older docs point at it as though it holds the queries; the logic lives in the
> `org-*.ts` modules above.

## Known gaps

- `enterprise.md` claims to document the system "as shipped" but its build
  sequence stops at E1–E5 and its data-model table lists 6 models against 40 in
  the schema. Treat it as a historical account of the original org build; the
  current data model is [`../data/data-model.md`](../data/data-model.md).
- **Undocumented:** Members & Access Control has no doc of its own. The invite and
  role machinery is real and wired — see the "Membership, roles & invites" section
  of [`../org-dashboard/org-intelligence.md`](../org-dashboard/org-intelligence.md)
  until it gets one.
