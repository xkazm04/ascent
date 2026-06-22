# App Readiness Passport — scan-integration impact analysis

> **Status:** analysis, grounded in the current codebase (file:line throughout). No code changed.
> **Question answered:** what does it take to have Ascent *generate* a passport from a scan and
> *visualize* passports across a fleet — and specifically **how do private vs public (token-bearing vs
> tokenless) scans change what a passport can honestly say?**
> **Source design:** [`APP_READINESS_PASSPORT.md`](../../APP_READINESS_PASSPORT.md) +
> [`app-passport.schema.json`](../../app-passport.schema.json) (v0.1.0).

---

## 0. TL;DR

1. The scanner already computes **~80–90%** of the passport's signals — the passport is a *re-projection*
   of a scan, not new analysis. The `stack.*` block is the **tech-stack extraction we just shipped (M2,
   `extractTechStack`)** widened to name persistence/monitoring/integrations; `automationReadiness` is the
   existing **L1–L5 maturity**; `productionReadiness` sub-scales map onto dimensions D2/D3/D9 plus a few
   manifest probes.
2. **The one axis that genuinely differs between scan modes is "present vs enforced."** The passport's
   most decision-relevant rungs — `ci.level: gated`, `security.level: gated`, and `aiInWorkflow` — are
   derived from **branch-protection + PR data, which are token-gated** (scan.ts:153/173/176). An
   **anonymous public-funnel scan must HONESTLY cap those at the "present" rung** (`checks`/`scanning`)
   and say so, never claim enforcement it couldn't observe.
3. **A passport is a deliberate named-tool disclosure** (integrations, persistence engine, hosting,
   `secretsFrom`). For a **private** repo it is exactly as sensitive as the report and must ride the
   identical tenant gates; it must never reach a public surface. The public gallery is already
   `isPrivate:false`-gated (scans-read.ts:450), so the safe pattern exists — the passport just has to use it.

---

## 1. Signal map — passport field → what Ascent already extracts

Generation is mostly *assembly*. Every field traces to an existing source:

| Passport field | Existing source in Ascent | Notes |
|---|---|---|
| `stack.languages` / `frameworks` | `extractTechStack(snapshot)` (`src/lib/analyze/tech-extract.ts`, M2) | already deterministic + persisted (`Scan.techStackJson`) |
| `stack.persistence` / `monitoring` / `integrations` / `hosting` / `secretsFrom` | manifest parse (`package.json`, `pyproject.toml`, … already fetched — `github/source.ts:568-576`) | NEW detectors, same shape as tech-extract: deps → engine/vendor/kind |
| `automationReadiness.level` / `score` | `report.level` / `report.overallScore` (the L1–L5 maturity) | 1:1 — the ladder IS shared (design §2a) |
| `automationReadiness.artifacts` | D1 agent-guidance detectors + file probes (`CLAUDE.md`/`AGENTS.md`, `context-map.json`, `.ai/manifest.yaml`, `.ai/memory`, skills dir) | all in the snapshot |
| `automationReadiness.selfVerify` | `package.json` scripts (build/test/lint/typecheck) | snapshot, both modes |
| `automationReadiness.aiInWorkflow` | commit co-author trailers (`snapshot.commits`) **+ agent-authored PRs (`prStats`)** | **PR half is token-gated** — see §2 |
| `productionReadiness.tests` | D2 (Automated Testing) + test deps/coverage config | `coveragePct` usually `null` (not run at scan time) |
| `productionReadiness.ci` | D3 (CI/CD & Delivery) + `.github/workflows` probe **+ branch protection (`governance`)** | **`gated`/`gates` is token-gated** — see §2 |
| `productionReadiness.security` | D9 (Security) + `SECURITY.md`/`dependabot`/`codeql`/SBOM probe **+ required-checks (`governance`)** | **`gated` rung token-gated** |
| `productionReadiness.observability` | deps/code probe (`sentry`, `pino`, `otel`, `/api/health`) | NEW probe; Ascent has no dedicated dimension for it |
| `productionReadiness.delivery` | `prisma/migrations` (versioned), `*.tf` (iac), feature-flag/versioned-deploy heuristic (rollback) | tree + manifest |
| `identity.visibility` / `license` / `archetype` | `snapshot.meta.isPrivate` / `meta.license` / `classifyArchetype` | snapshot, both modes |
| `evidence.confidence` | `report.confidence` (inspect coverage) | mirror directly (design §4) |
| `links.report` / `manifest` / `contextMap` | report permalink + generated-standard paths | pointers, not embeds |

What is **not** observable and needs a human/default or a heuristic (same in both modes):
`identity.criticality`, `identity.lifecycle`, `delivery.rollback`. Default these conservatively + let an
owner override; never invent a confident value.

---

## 2. The private-vs-public impact (the core ask)

The real distinction is **token-bearing vs tokenless**, which in practice is *org/private scan* (installation
token, `orgSlug=owner`) vs *anonymous public-funnel scan* (no token, `orgSlug="public"`). Three scan-time
fetches are `token ? fetch : Promise.resolve(null)` (scan.ts:153 prStats, :173 branch governance, :176
commit activity), so a tokenless scan simply **does not have** those inputs.

### 2a. Availability matrix

| Passport field | Anonymous public-funnel (tokenless) | Org / private scan (token) |
|---|---|---|
| `stack.*`, `artifacts.*`, `selfVerify` | ✅ full (snapshot only) | ✅ full |
| `automationReadiness.level/score` | ✅ | ✅ |
| `tests.*`, `observability.*`, `delivery.migrations/iac` | ✅ (file/dep probes) | ✅ |
| `ci.level` | ⚠️ **capped at `delivery`** — can see workflows run checks / deploy, **cannot prove `gated`** | ✅ full incl. `gated` (required-check via branch protection) |
| `ci.gates` (what blocks merge) | ❌ unknown (no branch protection) | ✅ |
| `security.level` | ⚠️ **capped at `scanning`/`supply-chain` presence**, **not `gated`** | ✅ |
| `aiInWorkflow` | ⚠️ **partial** — commit trailers only, no PR authorship | ✅ full |
| `evidence.confidence` | ✅ (often lower coverage) | ✅ |
| **a passport at all for a PRIVATE repo** | ❌ can't ingest a private repo anonymously (404 → neutral) | ✅ |

### 2b. "Present vs enforced" is the token boundary — and it's the design's headline distinction

The design (§2b) makes a point of `present` vs `enforced`: `checks` = CI runs the tests; `gated` = a
failing test *blocks the merge*. **Whether a check is required is a branch-protection fact** — exactly the
token-gated `governance` signal. So the most valuable rung in the whole passport is the one a tokenless
scan can't reach. The honest contract:

- **Tokenless scans must cap** `ci.level` at `checks`/`delivery` and `security.level` at
  `scanning`/`supply-chain`, **and record the reason** (`evidence.source: "static-scan (no
  branch-protection visibility)"` + a `blocker` like *"enforcement not observable without a token"*).
  Anything else is success-theater — claiming a gate we never saw.
- **Token scans** fill the `gated` rung from `governance.protected` + required status checks (the same
  data the existing CI gate + governance fleet view already consume).

### 2c. `aiInWorkflow`

Commit co-author trailers (`Co-Authored-By:` / agent markers) are in the **public** snapshot, so the
"AI is actually used" signal is *partially* available to anyone. The stronger evidence — **agent-authored
PRs** — comes from `prStats` (GraphQL, token). Tokenless → trailer-only; flag it as partial.

---

## 3. Privacy / disclosure impact

A passport is the *opposite* of the `.ai/manifest` on purpose: **it names tools** — the persistence engine,
every integration vendor, the hosting target, and `secretsFrom` (the vault/keyring, never the secret).
That makes a passport an **architecture-disclosure document**, and for a **private** repo it is exactly as
sensitive as the maturity report.

**Rules (reuse the gates the report already rides — do not invent a new exposure path):**

1. **Persist a passport under the repo's owning org** and gate reads with the SAME `canReadOrg` /
   `requireOrgRead` boundary as the rest of private scan data. A member sees their org's passports; a
   stranger does not.
2. **A private repo's passport must never reach a public/unauthenticated surface** — not the public
   gallery (already `isPrivate:false`-gated, scans-read.ts:450 — keep it that way), not an OG image, not
   the unauthenticated badge, not a share link without a signed token.
3. **`secretsFrom` is architecture info.** Store the vault NAME only (the schema already forbids secrets);
   still treat the field as private-repo-sensitive. Never log it.
4. **Public repos are safe to expose** — the repo is public and its stack is inferable from it anyway, so a
   public-repo passport can live on the public report + gallery. The visibility split, not the scan mode,
   decides exposure.

Net: **no new disclosure risk if the passport rides the existing report gates; a real disclosure risk if a
passport is ever emitted to a surface the report isn't.** That's the single thing to get right.

---

## 4. Generation design (how to make scans emit a passport)

Mirror the **tech-extract pattern (M2) exactly** — a pure, deterministic, display-only projection that
never touches the score:

- `buildPassport(report, snapshot): AppPassport` in `src/lib/analyze/passport.ts` — pure over
  `report` + the already-fetched snapshot. Reuses `extractTechStack` for `stack.languages/frameworks`;
  adds conservative manifest detectors for `persistence`/`monitoring`/`integrations`/`hosting`. Derives
  `automationReadiness` from `report.level` + artifact/selfVerify probes, and `productionReadiness`
  sub-scales from D2/D3/D9 + file probes + (when present) `governance`.
- **Honesty hooks:** pass a `hasToken`/`governance != null` flag so the builder caps `ci`/`security` at
  the "present" rung and sets `evidence` + `blockers` when enforcement wasn't observable (§2b).
- **Persist** `Scan.passportJson String?` (per-scan history) + cache the latest on
  `Repository.passportJson` — same additive, nullable, JSON-as-TEXT shape as `techStackJson`, same
  `init.sql` + migration discipline + `init-sql.test` parity.
- **Score derivation, not authoring** (design §8.3): the sub-scale → 0–100 → band/level formula lives in
  one helper so two scans of the same repo agree. Bands align to the 0/25/45/65/85 L-ladder cutoffs.
- It's **Option-A safe**: like tech-extract, the passport is display/persist only and never enters the
  prompt or the blend, so scans stay byte-identical and calibration is untouched.

---

## 5. Visualization design

Two surfaces, gated by visibility:

1. **Per-repo passport card** on the report page (and a `GET /api/.../passport(.json)` for the raw file —
   download/validate against the schema). The headline: the two scores side by side + the named-stack
   chips + the `blockers` list. Private-repo card behind the org gate; public-repo card on the public report.
2. **Fleet portfolio table** — a new `/org/[slug]/passports` page (Fleet group, next to Tech Stacks): one
   row per repo with `name · automation L · prod band · CI level · test level · error-tracking?`, every
   column a sortable enum (design §6), plus the **automation × production scatter** (the "automatable but
   not production-ready" quadrant view that is the whole payoff). Reuses `getOrgRollup` + the new
   `passportJson` on `OrgRepoRow`; composes with the `?segment=`/`?stack=` scope we just built. This is the
   portfolio comparison the manifest can't give — and the natural home for the `jq` rollups in design §6.

---

## 6. Phasing

- **P1 — generate + store + validate.** `buildPassport` (pure) + golden/determinism tests + the two
  honesty caps; `Scan.passportJson`/`Repository.passportJson` + migration; emit in `persistScanReport`;
  `GET /…/passport.json` (gated). No UI yet. Lowest risk, mirrors M2.
- **P2 — per-repo card** on the report + the raw download.
- **P3 — fleet `/passports` table + the two-axis scatter**, scoped by segment/stack.
- **P4 — owner overrides** for the non-observable fields (`criticality`, `lifecycle`, `rollback`) +
  optional **emit `.ai/passport.json` into a repo** via the existing "open a draft PR" path.

## 7. Open decisions (need a call before coding)

1. **Canonical home** (design §8.1): `.ai/passport.json` vs root `app-passport.json` when we offer to
   commit one. (For *storage*, it's a DB column either way.)
2. **Observability-gates-production?** (design §8.2): should `observability: none` hard-cap the prod band
   at `beta`? One-line rule in the scorer.
3. **Anonymous-scan caps**: confirm tokenless scans cap `ci`/`security` at the present-rung (recommended,
   §2b) rather than omit the fields.
4. **Where the fleet table lives**: standalone `/org/[slug]/passports` (recommended) vs columns folded into
   the existing Repositories leaderboard.
