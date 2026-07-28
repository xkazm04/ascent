# Data & Persistence

The Prisma schema, the DB client, scan persistence/history, and retention.

Context-map group: **Data & Persistence** (`data`).

| Doc | Covers | Freshness |
| --- | --- | --- |
| [data-model.md](data-model.md) | All 40 models grouped by feature area, DSQL-safety principles, scan persistence | CURRENT |
| [retention.md](retention.md) | Retention policy, the purge cron, safety floors, dry-run | CURRENT |

## Implementation roots

- `prisma/schema.prisma` (**40 models**), `prisma/init.sql`, `prisma/migrations/**` (32 migrations)
- `src/lib/db/**` — client, scans, retention, and one module per feature area
- `src/lib/db/index.ts` — barrel; `src/lib/db/mode.ts`, `src/instrumentation.ts` (embedded PGlite)

## Known gaps

- **The ERD in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) is hackathon-era**
  and duplicates this area at a much older schema version. `data-model.md` is the
  source of truth; ARCHITECTURE's data-model section should collapse into a pointer.
- Not every model has a typed `src/lib/db/*.ts` accessor — some (`WebhookDelivery`,
  `PublicScanQuota`) are reached via raw SQL. The per-model accessor list in
  `data-model.md` was not exhaustively verified.
