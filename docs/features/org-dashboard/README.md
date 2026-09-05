# Org Dashboard & Analytics

The `/org/[slug]` surface: standing, repositories, practices, governance, people,
security, integrations, branding.

Context-map group: **Org Dashboard & Analytics** (`feature`).

| Doc | Covers | Freshness (audited 2026-07-28) |
| --- | --- | --- |
| [practices.md](practices.md) | Practice artifacts, single + batch apply, drift guard, PR tracking | CURRENT |
| [org-intelligence.md](org-intelligence.md) | Tour of the org dashboard: all 21 tabs, membership/roles/invites | CURRENT |
| [developer.md](developer.md) | The Developer page `/org/developer` (UC3 individual care): personalized route reached from the header identity menu, the Contributors relation, the floored Care section | CURRENT |
| [roadmap.md](roadmap.md) | Forward-looking design notes (F-series waves) | STALE (stops at F6) |

## Implementation roots

- `src/app/org/[slug]/**`: the `?tab=` shell plus permanent redirect stubs for every retired route
- `src/features/<nav group>/<tab>/**`: one dir per surface, nested under its nav group
  (`standing` · `shared` · `inflight` · `bought` · `admin`), plus `src/features/developer/`
- `src/components/org/{shell,shared,followups}/**`: the tab shell, the cross-group components, and
  the follow-ups ledger — the parts that belong to no single group
- `src/lib/org/**`: governance, adoption, security, briefing, portfolio, playbook-brief
- `src/lib/db/org-*.ts`, `segments.ts`, `branding.ts`, `tech-groups.ts`
- `src/lib/practices/**` (`apply.ts`, `fingerprint.ts`), `src/lib/practice-artifact.ts`
- `src/lib/integrations/**`, `src/app/api/integrations/ingest**`
- `src/lib/security/supply-chain.ts`, `src/features/standing/security/**`

## Known gaps

- **Undocumented surfaces in this group:** Security Posture & Audit, Provider
  Integrations (Claude Code OTLP ingest), Org Branding / white-label, Tech Stacks,
  Adoption, Governance, and the AI ROI module under Delivery
  (`src/features/bought/delivery/ai/**`).
