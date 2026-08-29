# 04 — Forge-neutral ingestion: GitLab behind a Forge registry    XL · effort 9 / impact 8 / risk 6 · gate: contract · lane W4-P · wave 4 (last)

_Merged from scout findings **01#3** (Scan Pipeline & Ingestion — `HostKind` + `EnrichmentSource`)
and **02#3** (GitHub Repo Data Access — `src/lib/forge/{types,registry}.ts`). Reconciliation and the
dropped pieces are named in §Premises._

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/github/source.ts` — move `ParsedRepo` / `FetchOptions` / `ProgressFn` / `RepoSource` /
  `GitHubError` declarations to `src/lib/forge/types.ts`; keep `export type { … }` re-exports so all
  ~16 `parseRepoUrl` call sites and `src/lib/local/source.ts:24` compile untouched. `parseRepoUrl`
  becomes a thin wrapper over the registry router. `GitHubPublicSource` (`:517`) body unchanged.
- `src/lib/github/host.ts` — `githubApiBase/GraphqlUrl/RawBase` take an optional
  `{ host?: ForgeHost }`; unset ⇒ today's env resolution, byte-identical.
- `src/lib/scan-ingest.ts` — the six hard-wired enrichment calls (`fetchPrStats` :80,
  `fetchBranchGovernance` :106, `fetchSecurityPosture`, `fetchAppInventory` :128,
  `fetchCiHealth`, `fetchDeployments` :138, `fetchCommitActivity`, `fetchGuidanceFreshness`) route
  through `input.forge.enrich?.*`, each `undefined` ⇒ the same `null`/`[]` the token-less branch
  already produces.
- `src/lib/scan.ts:195` — `opts.source ?? new GitHubPublicSource()` → `resolveForge(parsed)`.
- `src/lib/local/source.ts` — `LocalFsSource` registered as forge `local` (no enrichments).
- `src/app/api/scan/route.ts`, `src/app/api/org/import/route.ts`,
  `src/app/api/gate/[owner]/[repo]/route.ts` — accept a forge coordinate / `?forge=`.
- `src/lib/db/org-watch.ts:126,205` and `src/lib/db/scans-persist.ts:132` — the three
  `repository.upsert` calls write `forge` + `externalId`.
- `src/lib/integrations/otlp.ts:55-70` — `resolveGitRepo` routes through the registry; a GitLab
  remote resolves instead of returning `unsupported-host`.
- `docs/features/github/github-app.md`, `docs/features/github/README.md`,
  `docs/features/scanning/scan.md`, `docs/features/org-dashboard/org-intelligence.md:1034`
  (the `unsupported-host` row).

**Files to create**
- `src/lib/forge/types.ts` — `ForgeId`, `ForgeHost`, `ForgeCapabilities`, `Forge`, the moved
  `ParsedRepo`/`FetchOptions`/`RepoSource`/`GitHubError`.
- `src/lib/forge/registry.ts` — `registerForge`, `resolveForge`, `parseForgeUrl`, `forgeCapabilities`.
- `src/lib/forge/github.ts` — the GitHub `Forge` record (adapter object only; **no logic moves out
  of `src/lib/github/**`**, it is wired by reference).
- `src/lib/forge/gitlab/{source,merge-requests,governance,pipelines,deployments,http}.ts`.
- `src/lib/db/forge-installations.ts` — `Installation` accessors.
- `scripts/forge/equality.mts` — the byte-identity harness (§Build order step 3).
- `src/lib/forge/registry.test.ts`, `src/lib/forge/github-parity.test.ts`,
  `src/lib/forge/gitlab/*.test.ts`.
- `docs/features/github/forges.md`.

**Prisma (landed by the wave-4 schema pass, not by this lane)**
- `Repository.forge String @default("github")`, `Repository.externalId String?`,
  `@@index([orgId, forge])`. The existing `@@unique([orgId, fullName])` is **NOT changed**; see
  §Behaviour → identity.
- `model Installation { id String @id @default(uuid()) · orgId String · forge String ·
  externalId String · host String? · credentialRef String? (secret-box ciphertext) ·
  capabilitiesJson String? (TEXT, never jsonb) · createdAt DateTime @default(now()) ·
  updatedAt DateTime @updatedAt · @@unique([orgId, forge, externalId]) · @@index([orgId]) }`
  plus `installations Installation[]` on `Organization`. `Organization.githubInstallId` is
  **untouched and remains the GitHub read path** (see §Out of scope).

**Director-owned lines requested at merge**
- `src/lib/db/index.ts`: re-export `getForgeInstallation`, `upsertForgeInstallation`,
  `deleteForgeInstallation` from `./forge-installations`.
- `context-map.json`: add `src/lib/forge/**` to the *GitHub Repo Data Access* context's `filePaths`
  (rename the context label to "Repo Data Access (forges)" only if the Director wants it).
- `scripts/docs/feature-doc-map.json`: new entry `{ area: "github", doc:
  "docs/features/github/forges.md", sourceGlobs: ["src/lib/forge/**"] }`.
- `src/lib/db/wire-safe-dates.test.ts`: add `ForgeInstallationRow` (its `createdAt`/`updatedAt` are
  `string`).

**MUST NOT TOUCH** — `prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`,
`context-map.json`, `scripts/docs/feature-doc-map.json`, `src/lib/github/rulesets-write.ts` and
`src/lib/org/admission.ts` (W4-O), `src/lib/mcp/**` (W2-K), `src/lib/scoring/engine.ts` and the
rubric version (any score movement is a failure of this lane, not a feature).

**Handoffs to other lanes** — none outbound; W4-P is the last lane and runs alone on a settled
tree. Two inbound preconditions: W4-O merged (so `gate.ts` verdict shape is final) and a green
full ordered gate on `master`.

## Goal

Make the scanner read a repository on a forge other than GitHub with the same rubric, the same
evidence rows and honest "not observable here" nulls — by promoting the existing `RepoSource` seam
into a `Forge` registry whose first member is today's GitHub code, wired by reference and proven
byte-identical, and whose second is GitLab. *Competitive angle:* DX, Swarmia, Jellyfish, LinearB and
OpenSSF Scorecard all read GitLab; a vendor-neutral referee that cannot read half an enterprise's
forges is not neutral.

**Known gaps deleted.** `docs/features/org-dashboard/org-intelligence.md:1034`'s `unsupported-host`
row ("GitLab, Bitbucket, self-hosted … has no row to attach spend to") is rewritten for GitLab.
`docs/features/scanning/scan.md` "Known gaps" gains — and `forges.md` owns — the *capability* gap
that replaces it. Note honestly: **no feature doc today states the GitHub-only limitation at all**,
so this lane adds the disclosure rather than deleting one (§Premises).

## Premises (verified against the tree, 2026-08-29)

All cited seams **held**; four line citations drifted, two design elements are **dropped**.

- ✅ `RepoSource` is a one-method seam at `source.ts:117-119` with exactly two implementations
  (`GitHubPublicSource` `:517`, `LocalFsSource` `local/source.ts:58`, injected at `scan.ts:195`,
  `org/local/rescan/route.ts:58`, `loop-lane.ts:114`).
- ✅ `parseRepoUrl` rejects an explicit non-github.com URL outright and its bare-parser rejects any
  first segment containing a dot — so `gitlab.com/a/b` cannot slip through today.
- ✅ `host.ts` generalises to GHES only; `scan-ingest.ts` hard-wires all eight enrichments to
  `src/lib/github/*`; `otlp.ts:55-70` reports GitLab as `unsupported-host`;
  `Organization.githubInstallId` is `schema.prisma:91`; `Repository` (`:250`) has no forge column;
  `src/lib/forge/` does not exist.
- ⚠️ Line drift: `fetchPrStats` is exported from `src/lib/analyze/pulls.ts:655` (not `graphql.ts`);
  `Repository`'s constraint is `@@unique([orgId, fullName])` (`:334`).
- ❌ **Dropped from 01#3:** the `/api/gate/[host]/[owner]/[repo]` route. CI callers, the check-run
  path and every doc use the two-segment path; adding a segment churns a public contract for no
  gain. Replaced by `?forge=` + the `forge:` coordinate prefix (below).
- ❌ **Dropped from 02#3:** `Forge.write` / `Forge.checks` adapters, the `Installation` backfill of
  `githubInstallId`, and the Bitbucket + Azure DevOps adapters. This lane defines the contract and
  ships **one** real adapter; a second forge before the equality proof is exactly the risk wave 4
  exists to avoid. Non-GitHub write paths stay unimplemented (capability `write: false`).

## Behaviour

**Identity (the whole reason the unique constraint survives).** `fullName` stays `owner/name` for
GitHub, byte-identical. A non-GitHub repo is namespaced in the *value*, not the key:
`gitlab:group/sub/project` (`owner` = top-level group, `name` = last segment). No collision with a
GitHub `group/project`, no schema migration of a live unique, and every route that takes
`?repo=owner/name` keeps working. `externalId` holds the forge-native numeric id (GitLab project
id) — the stable handle across renames; `null` for GitHub, where the coordinate is the id.

**`src/lib/forge/types.ts`**

```ts
export type ForgeId = "github" | "gitlab" | "local";
export interface ForgeHost { apiBase: string; webBase: string; rawBase?: string; graphqlUrl?: string }
export interface ForgeCapabilities {
  pullRequests: boolean; branchGovernance: boolean; deployments: boolean;
  ciHealth: boolean; securityPosture: boolean; appInventory: boolean;
  codeowners: boolean; write: boolean; anonymous: boolean;
}
export interface EnrichmentSource {                       // every member OPTIONAL
  pullRequests?(r: ParsedRepo, t: string, s?: AbortSignal):
    Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] } | null>;
  branchGovernance?(r: ParsedRepo, branch: string, t: string, s?: AbortSignal): Promise<Governance | null>;
  deployments?(r: ParsedRepo, t: string, s?: AbortSignal): Promise<DeploymentRecord[]>;
  ciHealth?(r: ParsedRepo, branch: string, t: string, s?: AbortSignal): Promise<CiHealth | null>;
  securityPosture?(r: ParsedRepo, t: string, s?: AbortSignal): Promise<SecurityPosture | null>;
  appInventory?(r: ParsedRepo, sha: string, t: string, s?: AbortSignal): Promise<AppInventory | null>;
  commitActivity?(r: ParsedRepo, t: string, s?: AbortSignal): Promise<number[] | null>;
  guidanceFreshness?(r: ParsedRepo, ref: string, paths: string[], o: FetchOptions): Promise<GuidanceFreshness[]>;
}
export interface Forge {
  id: ForgeId; label: string; capabilities: ForgeCapabilities;
  parseUrl(input: string, host?: ForgeHost): ParsedRepo | null;
  source(host?: ForgeHost): RepoSource;
  enrich?(host?: ForgeHost): EnrichmentSource;
  permalink(r: ParsedRepo, sha?: string): string;
}
```

Return types are the **existing** `PrStats` / `Governance` / `DeploymentRecord` / `CiHealth` /
`SecurityPosture` / `AppInventory` shapes from `src/lib/types.ts` — no new score-bearing type, so
no analyzer, no scorer and no rubric changes. This is the contract gate.

**`registry.ts`** — `registerForge(f: Forge)`; `resolveForge(p: ParsedRepo | { forge: ForgeId }): Forge`
(defaults `github`); `parseForgeUrl(input: string): (ParsedRepo & { forge: ForgeId }) | null` —
tries an explicit `<forge>:` prefix, then each registered forge's `parseUrl` in registration order
with **github first**, so every input that parses today parses identically. `parseRepoUrl` keeps
its exact current signature and returns non-null only for `forge === "github"`.

**Honest nulls (G4).** A missing `EnrichmentSource` member is *not observable*, never zero. It
reaches the report through the paths that already exist for a token-less scan: `governance: null`,
`deployments: []`, `aiChanges: []`, `prStats: null`. Every platform-observed fold is additive
(r7 precedent), so a forge with fewer observables **floors, never penalises** — the same construction
that keeps an anonymous scan a floor rather than a different rubric. `forgeCapabilities()` is
surfaced in the report warnings and in `forges.md` as a per-forge observability table; the score is
never adjusted to "compensate", which would fabricate exactly the number G4 forbids.

**Credentials.** A GitLab PAT / group access token is stored on `Installation.credentialRef` as
`encryptSecret()` ciphertext (`src/lib/crypto/secret-box.ts`), read only server-side through
`src/lib/db/forge-installations.ts`. `ForgeInstallationRow` (the wire type) carries **no**
`credentialRef`, and its `createdAt`/`updatedAt` are `string` (wire-safe-dates). Setting or clearing
one writes an `AuditLog` row (`forge.installation.set` / `.cleared`, `credentialRef` never in the
payload). Self-hosted GitLab is a `host` override on the same row; the GHES env vars in `host.ts`
are unchanged and still win for GitHub.

**Routes.** `POST /api/scan` and `POST /api/org/import` accept `forge?: ForgeId` (default
`"github"`) and the `forge:` coordinate; `GET /api/gate/:owner/:repo?forge=gitlab`. Auth is
unchanged on all three — `/api/gate` stays deliberately unauthenticated and keeps `noAmbientToken`,
so a GitLab gate call with no stored installation gets the same honest 404-shaped degrade a private
GitHub repo gets today. Installation CRUD is
`POST|DELETE /api/org/forge/installation` under `requireOrgRole("admin")`, same-origin, typed-confirm
on delete. No `[id]` route is added, so `id-routes-gated.test.ts` is untouched.

**Plan gates / self-hosted.** Non-GitHub forges are **not** a paid feature: `selfHosted()` turns
every plan gate off anyway, and gating breadth would contradict the neutrality claim. The existing
scan entitlement/credit path is unchanged and forge-agnostic. Anonymous (keyless) scanning stays
GitHub-only — `capabilities.anonymous: false` for GitLab, because gitlab.com's API rate-limits
unauthenticated project reads to the point where a public funnel scan is not honest.
`CHAMPION_MIN_POP = 3` and every aggregate floor are untouched; the benchmark corpus is **not** yet
keyed by forge (§Out of scope), so no cross-forge percentile is published from this lane.

**UI.** Two surfaces, both existing: **Admin → Integrations** gains a `ForgeInstallationCard`
(`Card`, `Select`, `Input type=password`, `Button`, `Badge` from `@/components/ui`) — connect/rotate
/disconnect, capability table, no secret ever echoed. **Standing → Repositories** rows gain a forge
`Badge` (label only; **no new colour** — `LEVEL_HEX`/`scoreHex` remain score-only). Files under
`src/features/**` obey the 200-LOC cap; the card ships as its own file.

## Build order

1. **Extract, don't move.** Create `src/lib/forge/types.ts` with the declarations lifted from
   `source.ts:26-119`; `source.ts` re-exports them. Create `registry.ts` + `github.ts` referencing
   the existing `GitHubPublicSource` / `fetchPrStats` / `fetchBranchGovernance` / … functions.
   Register `github` and `local`. Zero call-site changes. Gate: `tsc` + full `vitest`.
2. **Route the pipeline.** `scan.ts:195` → `resolveForge`; `scan-ingest.ts` takes `forge: Forge` and
   calls `forge.enrich?.()`. `parseRepoUrl` → wrapper. Still zero behaviour change.
3. **Prove it (the release gate for this lane).** `scripts/forge/equality.mts`: re-capture
   `bench/matrix-inputs` via the existing `ASCENT_MATRIX_CAPTURE_DIR` hook
   (`scripts/matrix/capture.mts`, `mock: true` — no LLM key, fully deterministic) and diff each
   repo's `{scoreInput, snapshot}` JSON against the fixtures captured from `master` **before** step 1.
   Then re-run the `docs/REFERENCE-SCAN-AUDIT.md` cohort (`reference-data/dump-*.json`, 10 orgs /
   109 scans, mock engine) and diff per-repo per-dimension scores. **Any non-zero diff blocks
   everything below**; the harness output is pasted into the handoff. Steps 1–3 are one commit and
   one reviewable PR-half.
4. **Persist forge identity.** `Repository.forge`/`externalId` written at the three upsert sites;
   `forge-installations.ts` + the encrypted credential path + the audit rows.
5. **GitLab source.** `src/lib/forge/gitlab/source.ts` — Projects API metadata, repository tree
   (recursive, paginated), raw file reads, commits → the same `RepoSnapshot`. Reuse
   `estimateCoverage`, `pickFilesToFetch`, `MAX_FILES` and the byte budgets from `github/source.ts`
   exactly as `LocalFsSource` already does, so ingestion volume — and therefore calibration — matches.
6. **GitLab enrichments.** MRs + approvals → `PrNode`/`PrStats`/`AiChangeRecord`; protected
   branches + push rules → `Governance` (`readable: true`, unmapped booleans `false` only where
   GitLab genuinely lacks the concept, and the capability table says which); pipelines → `CiHealth`;
   environments/deployments → `DeploymentRecord`. `securityPosture` / `appInventory` stay
   **unimplemented** (capability `false` ⇒ null ⇒ "not observable").
7. **Coordinates end to end.** `parseForgeUrl` prefix + `?forge=`, permalinks, the three routes,
   `otlp.ts` `resolveGitRepo`, org import listing GitLab groups through the adapter.
8. **Surfaces + docs.** Integrations card, Repositories badge, `forges.md` (capability matrix +
   the "score comparability across forges" disclosure), and the four doc edits in the write set.

## Tests

- **New** `src/lib/forge/registry.test.ts` — resolution order, `forge:` prefix, unknown forge, the
  `local` registration. *Fail-before:* `resolveForge({forge:"gitlab"})` returns the GitHub adapter.
- **New** `src/lib/forge/github-parity.test.ts` — the structural guard for this lane: for every key
  in `ForgeCapabilities` that GitHub declares `true`, the GitHub adapter exposes the corresponding
  `EnrichmentSource` member, and the member is **reference-equal** to the `src/lib/github/*` export.
  *Fail-before:* re-implement `branchGovernance` inline in the adapter → the identity check fails.
- **Extend** `src/lib/github/source.test.ts` + `source-subpath.test.ts` — unchanged assertions must
  pass verbatim (they are the extraction's contract). Add: `parseRepoUrl("https://gitlab.com/a/b")`
  still returns `null`, while `parseForgeUrl` of the same input returns `forge: "gitlab"`.
- **New** `src/lib/forge/gitlab/*.test.ts` — fixture-driven mappers (MR → `PrNode` incl. approvals;
  protected branch → `Governance`; pipeline → `CiHealth`; environment → `DeploymentRecord`), plus
  paginated tree assembly and the raw-file budget cap. *Fail-before:* an unmapped `Governance` field
  defaults to `true` instead of `false`.
- **Extend** `src/lib/integrations/otlp.test.ts` — a `gitlab.com/g/p` remote resolves;
  a truly unknown host still returns `unsupported-host` with its name.
- **Structural guards touched:** `wire-safe-dates.test.ts` (+`ForgeInstallationRow`);
  `check-doc-sync` (new `src/lib/forge/**` glob — the Director lands it, and its
  "every sourceGlob matches a tracked file" assertion is why the glob must land in the same merge);
  `id-routes-gated.test.ts` untouched (no `[id]` route added).
- **Equality proof:** step 3's harness, run twice (after step 2, and again after step 8 with
  `forge=github`) — the second run is what proves GitLab did not perturb the GitHub path.
- **UAT:** re-run **Tomáš** (evaluator: paste a GitLab URL, get a scored report with an honest
  capability caveat instead of "invalid URL") and **Dana** (fleet: a mixed-forge org rolls up with
  no fabricated zero in the GitLab rows' D3/D6/D8).

## Gate + done criteria

Ordered ship-loop gate: `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` →
LOC checks (300 `.tsx` / 200 `src/features/**`) → e2e (Integrations + Repositories moved). Done when:
(a) step 3's diff is **empty** on both corpora and pasted into the handoff; (b) a public gitlab.com
project scans end-to-end producing a report whose warnings name every unobservable capability;
(c) no dimension score for any repo in `reference-data/` moved by a single point; (d) `forges.md`
exists and the four doc edits landed; (e) no file outside the write set is touched.

## Out of scope

Named explicitly so this lane cannot absorb them: **#5 Gate-as-code** (concept-doc first — the gate
evaluator's shape is not reopened here, only its `?forge=` input), **#8 Agent-admission compiler**
(W4-O owns `rulesets-write.ts`; no forge write/checks adapter ships here), **#2 Open benchmark
corpus** (deferred to a concept doc — the corpus is **not** keyed by forge and no cross-forge
percentile is published), **#21 GitHub identity-graph sync** (deferred — no forge membership/team
sync), **#29 Score-input ledger** and **#30 Reproducibility certificate** (deferred — the equality
harness in step 3 is a one-off release gate, not a persisted score-input ledger), **#31 Signed
tenant history bundle**, **#6 Signed attestation**, **#37 Data-bound deck diagrams**. Also out:
Bitbucket Cloud and Azure DevOps adapters (contract-ready, unbuilt); migrating
`Organization.githubInstallId` onto `Installation` (a live-identity migration deserves its own
release; the column stays the GitHub read path and `installations.ts` is untouched); any change to
`SCORING_RUBRIC_VERSION`, the guardband, or D9 determinism (G1–G9 — a diff that softens any of them
is a redo, not a merge).
