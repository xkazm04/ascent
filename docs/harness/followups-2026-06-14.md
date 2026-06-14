# Follow-ups — 2026-06-14 (Feature Scout Wave 1)

## STD-1 — Doctor conformance → Ascent (adopt→verify→re-score loop) — DEFERRED to a focused session

**Why deferred (not a stuck-fail — a scope/risk call):** Wave 1's other 5 fixes share one mental
model — "reuse an existing primitive (`openDraftPr` / `createInitiative`) to make a dead-end surface
actionable" — pure wire-ups with zero schema impact, all verified against the 450-test baseline.
STD-1 is a different shape and bigger:

1. **Needs persistence.** Closing the loop means storing `{ repo, headSha, score, fails, warns }`
   and reading it back. That's either a new Prisma model or additive-nullable columns on
   `Repository` → a **migration**. The repo runs DB-less by default and migrations here can only be
   verified by `prisma generate` + `tsc` + `next build`, never against a live DB (see
   harness-learnings "verified by prisma generate + tsc + next build only — NO live DB migration").
   Shipping a blind migration at the tail of a wire-up wave is the wrong risk profile.
2. **Multi-surface rendering.** "Surface on the report + org rollup" touches the scan-report render
   path and `getOrgRollup` repo rows — a separate concern from the wave's UI wire-ups.
3. **A new ingest subsystem** (`POST /api/report/conformance` + doctor `--json`/auto-POST + the
   `ai-conformance.yml` CI step in `wiring.ts`), not a reuse of an existing one.

**Concrete plan for the STD-1 session (low-risk path):**
- **Persist** via additive-nullable columns on `Repository` (the same safe pattern as
  `lastScanStatus`/`lastScanError`): `aiConformance Int?`, `aiConformanceFails Int?`,
  `aiConformanceWarns Int?`, `aiConformanceAt DateTime?` (schema.prisma + the `prisma/init.sql`
  mirror + a migration). Add a `recordConformance(orgSlug, fullName, {...})` db helper that no-ops
  without a DB (mirror `recordScanOutcome`).
- **Ingest:** `POST /api/report/conformance { repo, headSha, score, fails, warns }` — gate like
  `/api/practices/apply` (org-owned write) or accept a CI token; call `recordConformance` + audit
  `conformance.reported`.
- **Emit:** add a `--json` branch to the doctor template in `src/lib/standard/doctor.ts:11` (the
  `DOCTOR` string — NO backticks/`${}`; it embeds verbatim) printing
  `{score, fails, warns, findings}`, and an optional auto-POST when `ASCENT_URL`+`ASCENT_TOKEN` env
  are set. Wire the optional POST into the generated `ai-conformance.yml` (`src/lib/standard/wiring.ts`).
- **Surface:** a `.ai conformance N%` chip on the repositories leaderboard row (reads the new
  `Repository.aiConformance*`) and/or the report header. This is the "flows back into Ascent" payoff.
- **Verify:** `prisma generate` + `tsc` + `next build`; note in the commit that the migration was
  NOT run against a live DB (additive + nullable, so safe; deploy runs `prisma migrate deploy`).

Anchor facts: doctor computes the score at `src/lib/standard/doctor.ts:122-132`; the skill tells users
to "re-scan in Ascent to confirm the maturity delta" (`src/lib/onboarding/skill.ts`); today nothing
ingests it. Report = `docs/harness/feature-scout-2026-06-14/ai-native-standard-onboarding-skill.md`
finding STD-1.

## MEM-2 — Member invite flow — DEFERRED (migration: new Invite model)

Wave 2 shipped member management (MEM-1/3/4) but invites need a new `Invite` model
(`id, orgId, email|githubLogin, role, token, status, expiresAt`) + migration, a `src/lib/db/invites.ts`
(`createInvite`/`acceptInvite`/`listPendingInvites`), `/api/org/invites` (POST/GET/DELETE, owner-gated),
and an `/invite/[token]` accept page that resolves the signed-in GitHub login. Surface pending invites
in the Members panel. The current "add member" path (`setMembershipRole` from a bare login) silently
creates a ghost membership on a typo — invites fix that. ~1.5–2 days. Report finding MEM-2.

## ALRT-3 — Per-org regression thresholds — DEFERRED (migration: Organization columns)

`detectRegression` already takes a `RegressionThresholds` arg but is always called with
`DEFAULT_THRESHOLDS`. Add nullable `Organization.alertOverallDrop` / `alertDimensionDrop` (+ the
`prisma/init.sql` mirror + migration), load them in `checkAndAlertRegression` (`scan-alerts.ts`), and
add the inputs to the `AlertsControl` popover next to the webhook (shipped in ALRT-1, which needed no
schema change). Also a per-org "minimum severity to alert" toggle. ~1 day. Report finding ALRT-3.
