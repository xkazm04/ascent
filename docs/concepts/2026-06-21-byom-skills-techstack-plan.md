# Concept & Execution Plan — Three Flagship Features

> **Status:** design-complete, ready for execution. **Authored:** 2026-06-21 (analysis session).
> **Scope:** (1) BYOM — org-connected enterprise LLM via Amazon Bedrock · (2) Org Skills Library —
> a scalable, categorized, filterable catalog of reusable Claude/LLM skills with usage counts ·
> (3) Tech-stack extraction + tech-based repo grouping across the org dashboard.
> **This document is the single source of truth for the execution session.** It is grounded in the
> current codebase (file:line references throughout). No code was changed during analysis.

---

## 0. How to use this document

- Each feature is a self-contained section (§3, §4, §5) with: current state → design → data model →
  backend/API → UI → impact → phasing → acceptance criteria → risks → open decisions.
- **§2 (Shared foundations)** holds cross-cutting infra (schema discipline, the new secret-encryption
  util, org-config pattern, nav insertion) that more than one feature depends on — read it first.
- **§6** gives the recommended build order. **§7** consolidates risks. **§8** lists the decisions that
  need a human call BEFORE coding (do not guess these). **§9** is the phased execution checklist with
  verification gates.
- Code snippets are **illustrative of the seam/shape**, not final code. The executor writes real code
  matching existing patterns and the repo's quality gates (tsc 0 · vitest · `next build` · atomic
  commits with finding refs · per-wave verification — same discipline as the bug-ui-scan-2026-06-20 run).

### Repo conventions the executor MUST follow (verified)
- **Schema source of truth** = `prisma/schema.prisma`; **`prisma/init.sql` must mirror it** (a test,
  `src/lib/db/init-sql.test.ts`, enforces parity — drift = bootstrap 500s). After any schema change:
  regenerate init.sql (`prisma migrate diff --from-empty --to-schema-datamodel`) and add a migration.
- **`relationMode="prisma"`** — NO foreign keys are emitted. Every relation scalar needs an explicit
  `@@index`; dedup needs `@@unique`; cascade deletes are done in code (`deleteMany` in a `$transaction`).
- **IDs** = `@default(uuid())` (no sequences; DSQL-incompatible). **New columns** = additive + nullable
  (or with a default). **JSON** = stored as `String` (TEXT), parsed at the Prisma layer (no JSONB).
- **DSQL resilience** = wrap multi-write paths in `$transaction`; tolerate OCC via `withRetry`.
- **Org gating** = `requireOrgRead` (reads) / `requireOrgAccess` (member writes) / `requireOrgRole(org,"owner"|"admin")`
  (privileged) from `src/lib/authz.ts`. **Audit** privileged config changes via `recordAudit(action, meta, {orgId, actorId})`.
- **Plan gating** = `src/lib/plans.ts` `PLAN_FEATURES` + helpers like `planAllowsWhiteLabel` (team||enterprise)
  / `isUnlimitedPlan`. Add new capability predicates here, data-driven.
- **Nav** = `src/components/org/OrgNav.tsx:15` — a `def: { label, tabs: [{href,label}] }[]` array; add a tab
  there + a `src/app/org/[slug]/<route>/page.tsx`.
- **Design system** = Tailwind v4 tokens in `src/app/globals.css`; shared primitives `OrgTable`,
  `SectionHeader`, `EmptyState`/`SectionEmpty` in `src/components/org/ui.tsx`; `.focus-ring`; charts via
  `chartScale`. Reuse them — don't hand-roll.

---

## 1. Executive summary

| # | Feature | Core value | Net-new surface | Est. effort | Plan tier |
|---|---|---|---|---|---|
| 1 | **BYOM (Bedrock per-org)** | Enterprise privacy/compliance + "use your own AWS model/bill" — the headline enterprise unlock | 1 table, 1 encryption util, provider-selection becomes org-aware, settings UI, test-connection | **L** (3 seams + crypto + secrets handling) | enterprise |
| 2 | **Org Skills Library** | Members discover + reuse org-authored Claude skills; scales via categories/filters/usage counts | 3 tables, CRUD+filter API, a new `/skills` tab, download/usage counter | **M** (mirrors Playbook stack) | team+ (gate TBD §8) |
| 3 | **Tech-stack grouping** | Frontend / Backend-by-language insights instead of one flat fleet — richer org intelligence | scan-time extractor (pure fn), persisted tech, auto-maintained tech groups, threaded across ~8 org pages | **L** (broad UI surface + calibration care) | all tiers (read), gate group mgmt TBD |

**Recommended order:** **3 → 2 → 1** is *not* recommended. Recommended is **2 → 3 → 1** OR **3-extract-only → 2 → 3-grouping → 1** (see §6). Rationale: Skills (2) is the lowest-risk, highest-visible-value, self-contained module that proves the "library tab" pattern; tech-extraction (3a) is a safe pure-function add that unlocks 3b's grouping; BYOM (1) is highest-risk (secrets) and benefits from going last when the team has fresh context on the provider layer.

---

## 2. Shared foundations (cross-cutting)

### 2.1 Schema & migration discipline
All three features add tables/columns. Follow §0. Net new models across the plan:
- **Feature 1:** `OrgLlmConfig` (+ a few nullable `Organization` columns or keep all on the table).
- **Feature 2:** `OrgSkill`, `OrgSkillAdoption`, `OrgSkillDownload`.
- **Feature 3:** `Scan.techStackJson` (+ `Repository.techStackJson` cache of latest), `TechStackGroup`, `TechStackGroupMember`.

Each new table: `id String @id @default(uuid())`, `orgId` + `@@index([orgId])`, `@@unique` where dedup is
needed, JSON-as-TEXT. **Every change → update `prisma/init.sql` and add a migration; run `init-sql.test.ts`.**

### 2.2 Org-scoped config pattern (mirror existing)
- **Small, non-secret settings** → columns on `Organization` (precedent: `plan`, `brandName/brandColor/logoUrl`,
  `gatePolicy` JSON, `alertWebhookUrl`, retention).
- **Complex / secret / high-cardinality** → separate table (precedent: `Repository`, `CreditLedger`, `Playbook`).
- **Settings UI** → a `*Settings.tsx`/`*Panel.tsx` client component POSTing to `/api/org/<thing>`; gate the
  route with `requireOrgRole(org,"owner")`; validate on write; `recordAudit` the change. (Template:
  `src/components/org/BrandingSettings.tsx` + `src/app/api/org/branding/route.ts` + `src/lib/db/branding.ts`.)

### 2.3 NEW shared util — secret encryption at rest (BYOM blocker, also reusable)
**There is currently NO credential/secret encryption anywhere in `src/lib`** (verified by grep:
`createCipheriv|aes|kms|encrypt|secretsmanager|libsodium|tweetnacl` → 0 hits). All secrets today are
env-only and never persisted. BYOM is the first feature that must persist a customer secret.

Create `src/lib/crypto/secret-box.ts` (new), exposing:
```ts
export function encryptSecret(plaintext: string): string   // -> "v1:<base64 iv>:<base64 ct>:<base64 tag>"
export function decryptSecret(blob: string): string        // throws on tamper/bad key
export function isEncryptionConfigured(): boolean           // ENCRYPTION_KEY present?
```
- **Recommended impl:** Node `crypto` AES-256-GCM with a 32-byte key from `process.env.ENCRYPTION_KEY`
  (base64). Versioned prefix (`v1:`) so key rotation is possible later. No new dependency.
- **Alternative (decide in §8):** AWS Secrets Manager / KMS (store only a reference) — heavier, infra-coupled.
  Recommend the app-level GCM util for v1; it's self-contained, testable, and deployment-portable; document
  `ENCRYPTION_KEY` as a required env for BYOM and **fail closed** (BYOM unavailable) when unset.
- **Discipline:** never log decrypted secrets; never return them to the client (the GET settings endpoint
  returns presence + last-4 / metadata only); decrypt only at provider-construction time; add a unit test
  (round-trip + tamper-detection + wrong-key rejection).

### 2.4 Nav insertion point (verified)
`src/components/org/OrgNav.tsx:15` — the `def` array. Feature 2 adds a `{href:`${base}/skills`,label:"Skills"}`
tab (recommended under a new "Library" group or the "Plan" group — §4). Feature 3 adds a tech selector to
existing pages (no new nav tab required for the MVP; an optional `/tech-stacks` comparison page can come later).

---

## 3. Feature 1 — BYOM: org-connected Amazon Bedrock

### 3.1 Problem & value
Today every scan uses the platform's shared, **env-configured** LLM provider (one Gemini/Bedrock/OpenAI
account for all orgs). Enterprises want inference to run **in their own AWS account/region** (data never
leaves their boundary, they pay their own Bedrock bill, they pick the model). This is the marquee
enterprise differentiator and a common procurement requirement.

### 3.2 Current state (grounded)
- **Provider abstraction** (`src/lib/llm/*`): `LLMProvider` interface (`provider.ts:52`), impls
  `GeminiProvider`/`BedrockProvider`/`OpenAiProvider`/`MockProvider`. Selection is **env-driven**:
  `getProvider()`/`providerByName()`/`resolveProviderChoice()`/`providerAvailable()` in `src/lib/llm/index.ts`
  (~:124-176), keyed on `LLM_PROVIDER`/`LLM_FALLBACK_PROVIDER` + per-provider env (`config.ts`).
- **The 4 seams a provider flows through:** (1) selection (`getProvider`), (2) scoring loop in
  `src/lib/scan.ts:107-122` (construct) + `:252-306` (primary → retry → fallback → mock, usability gate,
  total-budget abort), (3) cache key `owner/repo@sha::llm|mock` (`src/lib/cache.ts:51-59` — **provider name is
  NOT in the key**), (4) report stamping `report.engine={provider,model}` (`engine.ts:202`) + usage metering.
- **Bedrock construction** (`src/lib/llm/bedrock.ts:35-48`): `constructor({model?,region?})` →
  `new BedrockRuntimeClient({ region })` using the **default AWS credential chain** (env/role/metadata).
  **This is the exact seam to extend** — add an optional `credentials` to the constructor and pass it through.
- **Per-org config precedents:** branding/gate-policy/alerts (see §2.2). **No secret encryption exists** (§2.3).
- **Metering:** `src/lib/db/usage.ts` + `credits.ts` — private scans debit 1 credit; tokens + estimatedCost
  recorded. Plan gating in `src/lib/plans.ts` (`planAllowsWhiteLabel` = team||enterprise is the pattern).

### 3.3 Design overview
Make **provider selection org-aware**: before falling back to env `LLM_PROVIDER`, check whether the scan's
org has a configured, enabled BYOM provider; if so, construct that provider with the org's
decrypted credentials. Everything downstream (scoring loop, stamping, metering) is unchanged except:
BYOM scans **don't debit platform credits** (the org pays AWS directly).

### 3.4 Data model
```prisma
model OrgLlmConfig {
  id                   String   @id @default(uuid())
  orgId                String   @unique
  provider             String   // "bedrock" (v1). Future: "openai", "vertex", "self_hosted"
  enabled              Boolean  @default(false)   // configured-but-paused vs active
  modelId              String                      // e.g. "us.anthropic.claude-sonnet-4-6"
  region               String?                     // bedrock region
  authMode             String   // "static" | "assume_role"
  // Encrypted JSON blob (secret-box v1): { accessKeyId, secretAccessKey } OR { roleArn, externalId? }
  credentialsEncrypted String?
  lastValidatedAt      DateTime?                   // set by the test-connection endpoint
  lastValidationError  String?
  createdBy            String?                     // GitHub login
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  org                  Organization @relation(fields: [orgId], references: [id])
  @@index([orgId])
}
```
- One row per org (`@@unique orgId`). Secret lives ONLY in `credentialsEncrypted` (never a plain column).
- `enabled=false` lets an org save+test before going live, and lets support pause a misconfigured org.

### 3.5 Backend / API
- **`src/lib/db/org-llm.ts`** (new): `getOrgLlmConfig(orgSlug)` (returns config WITHOUT decrypting),
  `getOrgLlmCredentials(orgSlug)` (decrypts — used only by the provider factory), `setOrgLlmConfig(...)`,
  `disableOrgLlmConfig(...)`, `recordOrgLlmValidation(orgSlug, ok, error?)`.
- **`src/lib/llm/bedrock.ts`** — extend `constructor({model?, region?, credentials?})`; pass
  `credentials` to `new BedrockRuntimeClient({ region, credentials })`. For `assume_role`, use
  `@aws-sdk/credential-providers` `fromTemporaryCredentials({ params: { RoleArn, ExternalId } })`.
- **`src/lib/llm/index.ts`** — new `getProviderForOrg(orgSlug, {forceMock})`: if the org has an
  `enabled` BYOM config (and the plan allows it), build the BYOM provider; else fall back to the existing
  env `getProvider()`. **Keep `getProvider()` for the anonymous/public path.**
- **`src/lib/scan.ts`** — `scanRepository` already resolves `orgSlug` (see `resolveScanAuth`); thread it
  into provider selection (replace the single `getProvider({forceMock})` at :107 with the org-aware
  resolver when `orgSlug !== "public"`). Failover decision: see §8.
- **`src/lib/entitlement.ts`** / `plans.ts` — add `planAllowsByom(plan)` (enterprise-only recommended) +
  a `features` entry. Gate the settings route + the provider resolver on it (a downgraded org's BYOM
  config goes dormant; scans fall back to platform provider).
- **Metering** — in the credit path, **skip the debit when the scan ran on a BYOM provider**
  (`report.engine.provider` is the org's, or thread a `byom:boolean` from the resolver). Still record
  usage (tokens/latency/provider) for the org's own visibility; show cost as "billed to your AWS account".
- **Routes:**
  - `GET /api/org/llm-provider?org=` → config metadata (provider, modelId, region, enabled,
    lastValidatedAt, `hasCredentials:boolean` — **never the secret**). `requireOrgRole(owner)`.
  - `POST /api/org/llm-provider` → upsert (encrypt creds via secret-box). `requireOrgRole(owner)` +
    `planAllowsByom` + `recordAudit("org.llm_provider.updated", {provider,modelId,region}, …)`.
  - `POST /api/org/llm-provider/test` → construct the provider with the supplied/stored creds, run ONE
    cheap Bedrock call (or a tiny `assess` on a fixed snapshot), return ok/error + set `lastValidatedAt`.
  - `DELETE /api/org/llm-provider` → disable + clear creds.

### 3.6 UI
- **`src/components/org/LlmProviderSettings.tsx`** (new) on a settings surface (a card on an existing
  admin/settings page, or a new `/org/[slug]/settings` section — §8). Fields: provider (Bedrock), region,
  modelId, auth mode (static keys / assume-role), credential inputs (write-only; show "configured ••••"
  when set), **Test connection** button (calls `/test`, shows result), Enable toggle. Plan-gated: show an
  "Enterprise" upsell when `!planAllowsByom`.
- Reuse `BrandingSettings.tsx` as the structural template (status `role="status"`, `aria-busy`, etc.).

### 3.7 Phasing
- **P1 (MVP):** secret-box util (§2.3) + `OrgLlmConfig` + Bedrock static-credentials + org-aware selection
  + settings UI + test-connection + enterprise gate + skip-credit-debit. Single provider (Bedrock),
  static keys only.
- **P2:** assume-role auth (cross-account, the enterprise-preferred mode) + per-org failover policy + a
  usage panel ("your BYOM spend, on your AWS bill").
- **P3 (later):** additional BYOM providers (OpenAI/Vertex/self-hosted) via the same seam.

### 3.8 Acceptance criteria
- An enterprise org can save Bedrock creds, **Test connection** succeeds, then a scan of its repo runs on
  the org's Bedrock (verify `report.engine.provider==="bedrock"` + the org's model) and **debits 0 credits**.
- A non-enterprise org sees the upsell and cannot save BYOM config (403).
- Secrets are never returned by GET, never logged; decryption only at provider construction; a tampered
  blob throws. `ENCRYPTION_KEY` unset → BYOM unavailable (fail closed), platform scans unaffected.
- tsc 0 · new unit tests (secret-box round-trip/tamper, org-aware selection, credit-skip) green · `next build` green.

### 3.9 Risks
- **Secret handling** (High) — mitigations in §2.3; this is the dominant risk.
- **Cross-org cache leakage** (Med) — the `::llm` cache key omits provider/org. Private-repo scans are
  per-tenant (not shared-cached) so the realistic blast radius is small, BUT **verify**: a BYOM scan must
  not read a platform-provider-cached report for the same commit (and vice-versa), and two orgs scanning
  the same public repo with different providers must not cross. Decide in §8 whether to add org/provider to
  the cache key for BYOM scans (recommended: bypass the shared cache entirely for BYOM).
- **Failover ambiguity** (Med) — §8.
- **AWS SDK assume-role** (Med, P2) — needs `@aws-sdk/credential-providers`; test endpoint catches most misconfig.

---

## 4. Feature 2 — Org Skills Library

### 4.1 Problem & value
Org members should discover and reuse the org's own Claude/LLM "skills" (reusable prompt/workflow assets)
from one browsable, **categorized, filterable** catalog with **usage/download counts** so the best assets
surface. The module is not currently in the org pages. The design must scale (many skills, many categories).

### 4.2 Current state — keep two things DISTINCT
- **`SkillGeneration` (existing, NOT a library):** `src/lib/onboarding/skill.ts` `buildOnboardingSkill(report)`
  generates a single per-repo `SKILL.md` onboarding artifact; `SkillGeneration` table records generations;
  `src/app/api/report/skill/route.ts` downloads it. This is **generation/onboarding**, one-off per repo —
  reusable only as a *naming/format* reference. **Do not extend it for the library.**
- **`Playbook` (existing, the architectural TEMPLATE):** org-authored library items + adoption tracking —
  the closest analog. Mirror it.
  - Schema `prisma/schema.prisma:458-494` (`Playbook` {orgId,title,dimId,summary,steps JSON,version,archived,
    createdBy} + `PlaybookApplication` {playbookId,orgId,repoFullName,appliedVersion,appliedBy} `@@unique([playbookId,repoFullName])`).
  - CRUD `src/lib/db/playbooks.ts` (list/create/update/delete + `getPlaybookAdoption`).
  - API `src/app/api/org/playbooks/*` (GET read-gated, POST member-gated, `[id]` DELETE admin-gated,
    `[id]/apply`, `[id]/repos`).
  - UI `PlaybooksPanel.tsx` + `PlaybookCard.tsx`, rendered on the **Practices** tab.
- **Reusable counter pattern:** `recordBadgeImpression` (`src/lib/db/badge-analytics.ts`) and
  `recordQuotaEvent` (`src/lib/db/quota-events.ts`) — fire-and-forget upsert+increment. The skill
  **downloads** counter mirrors this exactly.
- **Table chrome:** `OrgTable` (`src/components/org/ui.tsx`) with `caption`, sortable headers, row hover;
  `SegmentSelector` is the filter-pill precedent; `EmptyState`/`SectionEmpty` for empties.

### 4.3 Design overview
A new **`/org/[slug]/skills`** tab rendering a scalable, **server-filtered** table: search + category
dropdown + sort (name / most-downloaded / recent), columns `Name · Category · Adoptions · Downloads`.
Authors create/edit skills (name, category, description, content, optional tags); members copy/download
(increments the counter) and "mark adopted" per repo (mirrors Playbook adoption). Mirror the full Playbook
stack; add **category** (indexed) + **download counter** for scale.

### 4.4 Data model
```prisma
model OrgSkill {
  id          String   @id @default(uuid())
  orgId       String
  name        String                       // <= 200 chars; @@unique([orgId, name])
  description String   @default("")         // <= 1000
  content     String                        // the skill body (SKILL.md-like markdown); <= 50KB
  category    String                        // enum-like: "ci-cd"|"testing"|"security"|"ai-native"|"docs"|"workflow"|"other"
  tags        String   @default("[]")       // JSON string[] (secondary; optional)
  version     Int      @default(1)          // bump on content edit (mirror Playbook)
  archived    Boolean  @default(false)      // soft archive, not hard delete
  createdBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  org         Organization @relation(fields: [orgId], references: [id])
  adoptions   OrgSkillAdoption[]
  @@unique([orgId, name])
  @@index([orgId, archived])
  @@index([orgId, category])
}

model OrgSkillAdoption {
  id           String   @id @default(uuid())
  skillId      String
  orgId        String                       // denormalized for org-level rollups
  repoFullName String
  adoptedBy    String?
  adoptedAt    DateTime @default(now())
  skill        OrgSkill @relation(fields: [skillId], references: [id])
  @@unique([skillId, repoFullName])
  @@index([skillId])
  @@index([orgId])
}

model OrgSkillDownload {
  id        String   @id @default(uuid())
  skillId   String   @unique               // one rolling tally row per skill (org-internal usage)
  count     Int      @default(0)
  lastSeen  DateTime @updatedAt
  // Optional future: per-day rows for a sparkline; start with a single rolling count.
}
```
- **Category as an indexed string column** (not a tags table) — simplest scalable filter; `tags` JSON is a
  secondary, optional refinement. `@@index([orgId, category])` + `@@index([orgId, archived])` make the
  filtered list query cheap.
- Downloads = a single rolling counter per skill (mirror BadgeImpression). If a trend sparkline is wanted
  later, add per-day rows; start simple.

### 4.5 Backend / API
- **`src/lib/db/org-skills.ts`** (new, mirror `playbooks.ts`):
  - `listOrgSkills(orgSlug, {category?, search?, sort?})` — server-side `where` (orgId + archived:false +
    optional category + optional name/description `contains` insensitive) and `orderBy`
    (name | recent | downloads). Returns rows enriched with adoption count (`_count.adoptions`) and the
    download tally. **Sort-by-downloads:** simplest correct approach = join the `OrgSkillDownload` tally
    (a map lookup post-query) or a denormalized `downloadCount` column on `OrgSkill` incremented alongside
    the tally (decide in §8 — a denormalized column makes DB-side sort trivial; recommend it for scale).
  - `createOrgSkill` / `updateOrgSkill` (bump version on content edit) / `archiveOrgSkill`.
  - `getOrgSkill(id)` / `getOrgSkillOrgSlug(id)` (for per-row gating, mirror `getPlaybookOrgSlug`).
  - `adoptOrgSkill(skillId, repoFullName, by)` / `unadoptOrgSkill(...)`.
  - `recordSkillDownload(skillId)` — best-effort upsert+increment (mirror `recordQuotaEvent`) + bump the
    denormalized `downloadCount` if used.
- **Routes** `src/app/api/org/skills/*`:
  - `GET /api/org/skills?org=&category=&search=&sort=` — `requireOrgRead`. Returns `{skills, categories}`.
  - `POST /api/org/skills` — `requireOrgAccess` (member) — create.
  - `GET/PATCH/DELETE /api/org/skills/[id]` — PATCH member, DELETE admin (`requireOrgRole(admin)`), soft-archive.
  - `GET /api/org/skills/[id]/download` — returns the content as a download AND fire-and-forget
    `recordSkillDownload`. (Or POST `/use` if "copy to clipboard" should also count — §8.)
  - `POST/DELETE /api/org/skills/[id]/adopt` — mark/unmark a repo as having adopted the skill.
- **Categories** are a fixed enum in `src/lib/org/skill-categories.ts` (single-sourced; validate on write;
  drive the filter dropdown). Keep it small and curated for scale/consistency.

### 4.6 UI
- **`src/components/org/SkillsPanel.tsx`** (new): filter bar (search input, category `<select>`, sort
  `<select>`) wired to the server (`?category=&search=&sort=`), then `OrgTable` with columns
  `Name · Category(badge) · Adoptions · Downloads(right-aligned numeric)`. Row → expand/`SkillCard`.
  Empty state via `SectionEmpty`. Author form (name, category, description, content textarea, tags) gated
  to members; Delete/Archive gated to admins (and the control hidden for non-admins to avoid the
  swallowed-403 pattern fixed in wave 4 — i.e., gate the button by role, and still check `res.ok`).
- **`src/components/org/SkillCard.tsx`** (new, mirror `PlaybookCard`): name, category badge, version,
  description, content preview, **Copy for LLM** / **Download** (increments count), **Mark adopted** (repo
  picker), adoption count, optional **Track as initiative** (reuse Playbook's pattern).
- **Page** `src/app/org/[slug]/skills/page.tsx` (new): `requireOrgRead` via the layout; fetch
  `listOrgSkills` + categories; render `SkillsPanel`. **Nav:** add `{href:`${base}/skills`,label:"Skills"}`
  to `OrgNav.tsx:15` (recommend a new top group **"Library"** containing Skills, or place under "Plan").

### 4.7 Phasing
- **P1 (MVP):** schema + CRUD + list-with-filters API + the table UI (search/category/sort) + create/edit +
  download counter. Read for all members; create for members; archive for admins.
- **P2:** adoption tracking (per-repo) + adoption count column + "Track as initiative".
- **P3:** seed templates (like `PLAYBOOK_TEMPLATES`), import-from-SkillGeneration (turn a generated
  SKILL.md into a library entry), per-day download trend sparkline.

### 4.8 Acceptance criteria
- A member opens **Skills**, searches/filters by category, sorts by **Most downloaded**; the table is
  server-filtered (correct rows, correct counts). Creating a skill persists + appears; downloading it
  increments the count; a non-admin's archive attempt is gated (button hidden) and any failure surfaces.
- Distinct from `SkillGeneration` (no coupling). tsc 0 · unit tests (list filter/sort, counter increment,
  category validation, adoption upsert) green · `next build` green.

### 4.9 Risks
- **Scope creep vs Playbooks** (Low/Med) — Skills and Playbooks are similar; keep them separate per the
  user's explicit ask, but factor shared table/filter UI where clean. Decide in §8 whether Skills should
  eventually subsume Playbooks (out of scope here).
- **Content size / XSS** (Low) — content is markdown rendered in-app; render via the existing safe markdown
  path (no `dangerouslySetInnerHTML` of raw user content); bound size (50KB).
- **Sort-by-downloads cost** (Low) — use a denormalized `downloadCount` column for DB-side ordering at scale.

---

## 5. Feature 3 — Tech-stack extraction + grouping

### 5.1 Problem & value
Org modules treat all repos as one flat fleet. Extract each repo's **tech stack** (languages + frameworks
+ role: Frontend / Backend-by-language / Mobile / Data-ML / Infra) during the scan, then offer
tech-based **grouping/filtering** across the dashboard for far richer insight ("Frontend security 72 vs
Backend 65", "all Python services", etc.). Requires impact analysis on the LLM prompt and on each
`/org/...` page (both included below).

### 5.2 Current state (grounded)
- **The snapshot already contains the manifests** — `src/lib/github/source.ts:568-576` fetches FULL content
  of `package.json`, `pyproject.toml`, `go.mod`, `cargo.toml`, `pom.xml`, `build.gradle`, `gemfile`,
  `composer.json`, `tsconfig.json` (plus workflows, Dockerfile). **So extraction needs ZERO extra GitHub
  calls.** `RepoSnapshot` (`src/lib/types.ts`) carries `meta.primaryLanguage`, the recursive `tree`, fetched
  `files`, and `coverage`.
- **Scan pipeline** (`src/lib/scan.ts`): `classifyArchetype(snapshot)` then `analyzeSignals(snapshot, nowMs)`
  then `buildAssessmentPrompt`. The extractor slots in **right after `classifyArchetype`**, as a pure
  function. **Determinism is load-bearing** (snapshot-only, no `Date.now`/IO/env in the detector — the scan
  must stay a pure function of the snapshot for caching).
- **Prompt** (`src/lib/scoring/prompt.ts` + `provider.ts buildAssessmentPrompt`): 22KB/2200-per-file budget,
  coverage-weighted LLM blend (`engine.ts`), `LLM_GUARDBAND`. **harness-learnings + CALIBRATION.md warn that
  prompt/ingestion changes can move calibrated scores.**
- **Tech shown today:** only `Repository.primaryLanguage` (a single GitHub label), surfaced in the
  leaderboard/segments "auto-add by language", report header, PDF. No richer stack, no org rollup by tech.
- **Grouping precedent:** manual `Segment`/`RepoSegment` (`src/lib/db/segments.ts`) with `segmentScope`
  (`org-shared.ts:14`) threaded through `getOrgRollup(slug, window, segmentId)` (`org-rollup.ts:168`) and the
  `?segment=` URL param + `SegmentSelector`. This is the threading template.

### 5.3 Design — split into 3a (extract) and 3b (group)
**3a — extraction (safe, do first):**
- New pure fn `extractTechStack(snapshot): TechStack` in `src/lib/analyze/tech-extract.ts`. Reads the
  already-fetched manifests + tree + primaryLanguage; returns:
  ```ts
  interface TechStack {
    languages: string[];          // ["TypeScript","Python"]
    frameworks: string[];         // ["React","Next.js","FastAPI"]
    roles: StackRole[];           // ["frontend","backend"] — MULTI (a fullstack repo is both)
    backendLanguage?: string;     // primary backend lang for "Backend-<lang>" grouping
    confidence: number;           // from coverage + #manifests found
  }
  type StackRole = "frontend" | "backend" | "mobile" | "data_ml" | "infra" | "library" | "unknown";
  ```
  Detection = conservative manifest parsing (deps in package.json → React/Next/Vue/Svelte/Angular →
  frontend; express/nest/fastify/django/flask/rails/spring/gin → backend; pyproject/go.mod/pom/gemfile →
  backend language; react-native/expo/Swift/Kotlin → mobile; Dockerfile/helm/terraform → infra). Prefer
  manifest evidence over filename heuristics; set `confidence` low when manifests are missing.
- **Persist:** add `Scan.techStackJson String?` (the per-scan snapshot of tech) and cache the latest on
  `Repository.techStackJson String?` (updated in `persistScanReport`, like `primaryLanguage`). Per-scan
  storage keeps history honest when a repo re-stacks.
- **LLM prompt impact — START DISPLAY-ONLY (Option A, recommended):** do NOT add tech facts to the prompt
  initially → **zero calibration risk**, full dashboard value. Persist + surface only.
  - **Option B (later, gated):** add a short "DETECTED TECH STACK" block to the user message (+100-200
    tokens) behind an env flag, validated by the calibration bench (`npm run bench` / `docs/CALIBRATION.md`)
    — require median score drift < 2 points before rollout. Only pursue if it demonstrably improves
    audit quality (e.g., model flags "claims Python backend, zero tests").

**3b — grouping (after 3a):**
- **Recommendation: a parallel, auto-maintained `TechStackGroup` (Option B), NOT auto-segments.** Reasons:
  tech groups are auto-derived, immutable, **multi-membership** (a fullstack repo ∈ Frontend AND
  Backend-Node — a single `primaryLanguage` column can't express this), and shouldn't clutter the
  user-owned Segments UI. Reuse the *threading + selector patterns*, not the Segment tables.
  ```prisma
  model TechStackGroup {
    id        String  @id @default(uuid())
    orgId     String
    key       String   // stable: "frontend" | "backend:node" | "backend:python" | "mobile" | "data_ml" | "infra"
    label     String   // "Frontend", "Backend · Python"
    updatedAt DateTime @updatedAt
    org       Organization @relation(fields: [orgId], references: [id])
    members   TechStackGroupMember[]
    @@unique([orgId, key])
    @@index([orgId])
  }
  model TechStackGroupMember {
    id      String @id @default(uuid())
    groupId String
    repoId  String
    group   TechStackGroup @relation(fields: [groupId], references: [id])
    @@unique([groupId, repoId])
    @@index([groupId])
    @@index([repoId])
  }
  ```
- **Auto-sync** `syncTechStackGroups(orgSlug, repoId)` runs in `persistScanReport` after tech is extracted:
  derive the repo's group keys from `TechStack.roles`/`backendLanguage`, upsert the groups, reconcile the
  repo's memberships (add new, remove stale). Pure-ish (DB writes only; deterministic mapping).
- **Threading:** add `techGroupScope(groupId)` in `org-shared.ts` (mirrors `segmentScope`:
  `groupId ? { techGroups: { some: { groupId } } } : {}`), and a `?stack=<key|id>` URL param. Thread it
  through `getOrgRollup` and siblings (same as `segmentId`). Both filters can compose (segment AND stack).
- **Selector UI:** `TechStackSelector.tsx` (clone `SegmentSelector`) — pills "All · Frontend · Backend·Node
  · Backend·Python …" writing `?stack=`.

### 5.4 Per-page UI impact (the requested impact analysis)
Nav source: `OrgNav.tsx:15`. Rollup threading: `getOrgRollup(slug, window, segmentId)` → add `stackKey?`.

| Page (`/org/[slug]/…`) | Change for tech grouping | Effort |
|---|---|---|
| `page.tsx` (Overview) | Add a `TechStackSelector` (alongside `SegmentSelector`); scope the 6 tiles/movers/gaps to `?stack=` | **M** |
| `repositories` | Show the repo's tech (badges) in the leaderboard; add the tech selector; optional "group by stack" sections | **M** |
| `security` (D9) | "Frontend security X · Backend Y" breakdown; weakest-repo list filterable by stack | **M** |
| `delivery` | Scope PR/branch signals by stack (the selector already imported but unused on some pages) | **M** |
| `contributors` | Scope to a stack's contributors | **S** |
| `teams` | Optional stack filter (teams own mixed-stack repos) | **M** |
| `practices` | Surface language-specific practices for the selected stack | **M** |
| `executive` (Briefing) | Optional per-stack briefing scope (carry `stack` into the PDF/share like `segment`) | **L** |
| `live` (War Room) | Optional stack toggle on the live wall | **M** |
| `segments` | No change (orthogonal; user-defined) | **S** |
| `plan`/`backlog` | Optional: scope goals/backlog to a stack | **M** |
| `audit`/`members`/`governance` | No change (org-wide) | **S** |
| `executive`/PDF, CSV exports | Include tech columns in `/api/org/repositories` CSV | **S** |

**MVP for 3b** = Overview + Repositories + Security with the selector + scoped rollups (the three
highest-value surfaces); the rest follow the same threading pattern incrementally.

### 5.5 Phasing
- **3a-P1:** `extractTechStack` (pure fn + unit/golden tests) + persist `Scan.techStackJson` +
  `Repository.techStackJson` + surface tech badges on the repositories leaderboard + CSV. **No prompt change.**
- **3b-P1:** `TechStackGroup`/`Member` + `syncTechStackGroups` + `techGroupScope` + `TechStackSelector` on
  Overview/Repositories/Security.
- **3b-P2:** extend the selector + scoping to delivery/contributors/teams/practices/executive/live; optional
  `/org/[slug]/tech-stacks` comparison page (mirror `compareSegments`).
- **3c (optional, gated):** Option-B prompt enrichment behind a flag + calibration-bench gate.

### 5.6 Acceptance criteria
- After a scan, a repo's `techStackJson` is populated; the leaderboard shows accurate tech badges; the same
  snapshot yields identical extraction (determinism test); multi-stack repos appear in multiple groups.
- Overview/Repositories/Security gain a working `?stack=` filter that correctly scopes every tile/list.
- **No score movement** (Option A): a re-scan of an archived snapshot produces byte-identical scores
  (calibration unaffected). tsc 0 · golden-file extraction tests + threading tests green · `next build` green.

### 5.7 Risks
- **Calibration drift** (High if prompt touched) — mitigated by **Option A first** (display-only). Option B
  only behind the bench gate.
- **False tech detection** (Med) — conservative manifest-based detection; `confidence`; golden tests over
  real repos (ascent, vibeman, a Python repo, a Go repo). Filter low-confidence in UI if needed.
- **Determinism** (Med) — extractor must be snapshot-pure (no Date.now/IO/env); pin with a re-run test.
- **UI surface breadth** (Med) — phase it (MVP 3 pages); the threading pattern is mechanical once proven.
- **init.sql / migration drift** (Med) — three+ new tables/columns; run `init-sql.test.ts`.

---

## 6. Recommended build order & milestones

1. **M1 — Org Skills Library (Feature 2), P1+P2.** Lowest risk, self-contained, high visible value; proves
   the "library tab + scalable filtered table + counter" pattern. ~M effort.
2. **M2 — Tech extraction (Feature 3a).** Pure-function add + persistence + leaderboard badges. Zero
   calibration risk. Unlocks grouping. ~M effort.
3. **M3 — Tech grouping (Feature 3b) MVP.** `TechStackGroup` + selector + scope on Overview/Repos/Security.
   ~M-L effort.
4. **M4 — BYOM (Feature 1) P1.** Do last: highest risk (secrets), benefits from a dedicated focused session.
   Build the secret-box util first. ~L effort.
5. **M5 — Spread + polish:** tech grouping across remaining pages (3b-P2), BYOM assume-role (P2), Skills P3.

Each milestone ships behind its plan gate, with its own atomic-commit wave + verification (tsc/vitest/next
build) — same discipline as the prior bug-fix waves. Keep one feature per branch.

---

## 7. Consolidated risk register

| Risk | Feature | Sev | Mitigation |
|---|---|---|---|
| Secret-at-rest handling (new crypto) | BYOM | High | App-level AES-256-GCM util (§2.3), fail-closed, never log/return secrets, decrypt only at provider build, unit-tested |
| Cross-org cache collision on `::llm` key | BYOM | Med | Verify private scans are per-tenant; bypass shared cache for BYOM scans (§8) |
| Provider failover ambiguity | BYOM | Med | Decide policy (§8): BYOM→mock only (privacy) vs BYOM→platform fallback |
| Calibration drift from prompt change | Tech | High | Option A (display-only) first; Option B only behind `npm run bench` gate (<2pt drift) |
| False tech detection | Tech | Med | Manifest-based, conservative, `confidence`, golden tests |
| Determinism break in extractor | Tech | Med | Snapshot-pure; re-run determinism test |
| init.sql / migration drift | All | Med | Update init.sql + migration per change; `init-sql.test.ts` |
| Skills/Playbooks scope overlap | Skills | Low | Keep separate per ask; factor shared UI only where clean |
| Markdown content XSS | Skills | Low | Safe markdown render path; bound size |
| Broad UI surface | Tech 3b | Med | Phase to 3 pages MVP; mechanical threading thereafter |

---

## 8. Open decisions (need a human call BEFORE coding — do NOT guess)

1. **BYOM secret storage:** app-level AES-256-GCM (`ENCRYPTION_KEY`) [recommended] vs AWS Secrets
   Manager/KMS reference. Affects deploy + ops.
2. **BYOM failover policy:** if the org's Bedrock fails, fall back to (a) mock only [privacy-strict,
   recommended for BYOM] or (b) the platform provider [reliability]. Enterprises often forbid (b).
3. **BYOM cache:** bypass the shared `::llm` cache for BYOM scans [recommended] vs add org/provider to the
   key. Confirm private-repo scans are already per-tenant.
4. **BYOM plan tier:** enterprise-only [recommended] vs team+.
5. **BYOM settings home:** a card on an existing admin surface vs a new `/org/[slug]/settings` route (also
   a natural home for future org config). Recommend creating `/settings` if none exists.
6. **Skills plan gating:** team+ (mirror Playbooks/Segments) vs all tiers. Recommend team+ for parity.
7. **Skills "download" definition:** count file downloads only, or also "Copy for LLM" / preview opens?
   Recommend: count download + copy (both are "use"); not passive list render.
8. **Skills sort-by-downloads:** denormalized `OrgSkill.downloadCount` column [recommended for DB-side
   sort at scale] vs join the tally per query.
9. **Skills vs Playbooks future:** keep separate [this plan] vs eventually merge. Out of scope; flag only.
10. **Tech grouping model:** parallel `TechStackGroup` [recommended] vs auto-flavored `Segment`.
11. **Tech roles taxonomy:** confirm the role set (frontend/backend/mobile/data_ml/infra/library) and the
    "Backend·<language>" granularity (per-language groups vs one Backend group). Recommend per-language
    backend groups (the user's stated goal: "Backend language specific groups").
12. **Tech prompt enrichment (Option B):** ship display-only only [recommended v1], or pursue the gated
    prompt change. Defer to a later, bench-gated decision.

---

## 9. Execution checklist (phased, with verification gates)

> Per phase: branch off `master`; atomic commits referencing this plan; after each phase run
> `npx tsc --noEmit` (0), `npx vitest run` (no regressions vs the 2426 baseline), `npx next build` (green).
> Update `prisma/init.sql` + a migration whenever the schema changes and re-run `src/lib/db/init-sql.test.ts`.

### Feature 2 — Org Skills Library (M1)
- [ ] Decide §8.6/§8.7/§8.8. Add `skill-categories.ts` enum.
- [ ] Schema: `OrgSkill` (+ `downloadCount` if §8.8 = denormalized), `OrgSkillAdoption`, `OrgSkillDownload`;
      init.sql + migration; `init-sql.test.ts` green.
- [ ] `src/lib/db/org-skills.ts` (CRUD + filter/sort + counter + adoption) with unit tests.
- [ ] API `src/app/api/org/skills/*` (list/create/[id]/download/adopt) with route-guard + validation tests.
- [ ] UI `SkillsPanel.tsx` + `SkillCard.tsx` + `src/app/org/[slug]/skills/page.tsx`; nav tab in `OrgNav.tsx`.
- [ ] Plan-gate (§8.6). Verify search/category/sort + download counter + adoption + role-gated controls.

### Feature 3a — Tech extraction (M2)
- [ ] `src/lib/analyze/tech-extract.ts` `extractTechStack(snapshot)` (pure) + golden-file + determinism tests.
- [ ] Wire into `src/lib/scan.ts` after `classifyArchetype`; thread `techStack` into report assembly.
- [ ] Schema: `Scan.techStackJson`, `Repository.techStackJson`; persist in `persistScanReport`; migration + init.sql.
- [ ] Surface tech badges on `RepoLeaderboard` + tech columns in `/api/org/repositories` CSV. **No prompt change.**
- [ ] Verify: re-scan of an archived snapshot → byte-identical scores (calibration untouched).

### Feature 3b — Tech grouping MVP (M3)
- [ ] Schema: `TechStackGroup`, `TechStackGroupMember`; migration + init.sql.
- [ ] `syncTechStackGroups(orgSlug, repoId)` in `persistScanReport`; `techGroupScope` in `org-shared.ts`;
      `?stack=` param threaded into `getOrgRollup` + siblings.
- [ ] `TechStackSelector.tsx`; wire into Overview + Repositories + Security; scope tiles/lists.
- [ ] Verify scoping correctness + multi-membership.

### Feature 1 — BYOM (M4)
- [ ] Decide §8.1-§8.5. `src/lib/crypto/secret-box.ts` (+ round-trip/tamper/wrong-key tests). Document `ENCRYPTION_KEY`.
- [ ] Schema: `OrgLlmConfig`; migration + init.sql.
- [ ] `src/lib/db/org-llm.ts`; extend `BedrockProvider` constructor for injected credentials; `getProviderForOrg`
      in `index.ts`; thread `orgSlug` into provider selection in `scan.ts`; skip credit debit for BYOM.
- [ ] `planAllowsByom` in `plans.ts` + entitlement gate. Routes `/api/org/llm-provider` (GET/POST/DELETE/test).
- [ ] `LlmProviderSettings.tsx` (+ settings home per §8.5). Cache-bypass for BYOM per §8.3.
- [ ] Verify: enterprise org end-to-end (save → test → scan on org Bedrock, 0 credits); non-enterprise 403;
      secret never leaked; fail-closed without `ENCRYPTION_KEY`.

### M5 — Spread + polish
- [ ] Tech grouping across remaining pages (3b-P2) + optional `/tech-stacks` compare page.
- [ ] BYOM assume-role (P2) + BYOM usage panel. Skills P3 (templates, import-from-SkillGeneration, trend).

---

## Appendix — key file references (verified 2026-06-21)
- Provider abstraction: `src/lib/llm/{index,provider,config,bedrock,mock}.ts`; Bedrock seam `bedrock.ts:35-48`.
- Scan provider selection/failover: `src/lib/scan.ts:107-122`, `:252-306`; cache key `src/lib/cache.ts:51-59`.
- Plan gating: `src/lib/plans.ts:25` (`PLAN_FEATURES`), `:114` (`planAllowsWhiteLabel`).
- Org config templates: `src/lib/db/branding.ts`, `src/app/api/org/branding/route.ts`, `BrandingSettings.tsx`.
- Playbook template (Skills): schema `prisma/schema.prisma:458-494`; `src/lib/db/playbooks.ts`;
  `src/app/api/org/playbooks/*`; `PlaybooksPanel.tsx`/`PlaybookCard.tsx`; rendered on `practices/page.tsx`.
- Counter patterns: `src/lib/db/badge-analytics.ts`, `src/lib/db/quota-events.ts`.
- SkillGeneration (distinct): `src/lib/onboarding/skill.ts`, `src/app/api/report/skill/route.ts`.
- Snapshot + manifests: `src/lib/github/source.ts:568-576` (manifest fetch), `RepoSnapshot` in `src/lib/types.ts`.
- Scan pipeline: `src/lib/scan.ts` (classifyArchetype → analyzeSignals → buildAssessmentPrompt); prompt
  `src/lib/scoring/prompt.ts`, `src/lib/llm/provider.ts`; blend/guardband `src/lib/scoring/engine.ts`,
  `src/lib/maturity/model.ts`; calibration `docs/CALIBRATION.md` + `npm run bench`.
- Rollup + grouping threading: `src/lib/db/org-rollup.ts:168` (`getOrgRollup`), `org-shared.ts:14`
  (`segmentScope`), `org-insights.ts`, `org-signals.ts`; segments `src/lib/db/segments.ts`,
  `SegmentSelector.tsx`, `RepoLeaderboard.tsx`.
- Nav: `src/components/org/OrgNav.tsx:15`. Table chrome: `src/components/org/ui.tsx` (`OrgTable`,
  `SectionHeader`, `SectionEmpty`). Tokens: `src/app/globals.css`.
- Conventions: `docs/ARCHITECTURE.md`, `docs/ENTERPRISE.md`, `docs/CALIBRATION.md`; init.sql parity
  `src/lib/db/init-sql.test.ts`.
</content>
