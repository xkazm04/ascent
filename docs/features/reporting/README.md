# Reporting & Visualization

Everything that renders a scan back to a human: the repo report, charts, trends,
passports, exports, and the public leaderboard.

Context-map group: **Reporting & Visualization** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [report.md](report.md) | Report shell, tabs, render order, charts, diff, recommendations | CURRENT |

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Repo Report Shell & Tabs | `/report/[owner]/...` | `src/app/report`, `src/components/report/**`, `src/lib/report/**` |
| Score Charts & Visuals | — | `src/components/report/**`, `src/lib/ui.ts`, `src/components/LevelBadge.tsx` |
| Trends & Comparison | `/trends`, `/report/compare`, `/api/history` | `src/lib/report/compare.ts` |
| Roadmap & Recommendation Tracking | `/api/recommendations[/id][/events]` | `src/lib/db`, `src/components/report/**` |
| PDF & LLM Export | `/api/report/pdf` | `src/lib/pdf/**`, `src/components/CopyForLlm.tsx` |
| AI-Native Passports | `/org/[slug]/passports`, `/api/report/passport`, `/api/org/{decision,issue}` | `src/lib/analyze/passport*.ts`, `src/components/org/passports/**` |
| Portfolio & Public Leaderboard | `/portfolio`, `/leaderboard` | `src/lib/org/portfolio.ts`, `src/components/leaderboard/**` |

## Known gaps

- `report.md` is accurate but scoped to the repo report only. **Undocumented in
  this group:** Trends & Comparison, Recommendation Tracking, PDF/LLM export,
  AI-Native Passports, and Portfolio & Leaderboard.
- Passport design rationale lives at
  [`../../archive/2026-concepts/2026-06-22-app-passport-scan-integration.md`](../../archive/2026-concepts/2026-06-22-app-passport-scan-integration.md)
  (archived — the feature shipped; `src/lib/analyze/passport.ts` cites it).
- `report.md`'s "no PDF export of a single report" gap is worth re-reading against
  `/api/report/pdf`, which exists; the distinction the doc draws may be narrower
  than it reads.
