# Forges — reading a repository that isn't on GitHub

**Status: shipped (moonshot #4).** GitHub and GitLab are readable today. A local working copy is a
third "forge" (self-hosted mode). Bitbucket and Azure DevOps are contract-ready and unbuilt.

Source: `src/lib/forge/**`. Prisma: `Repository.forge` / `Repository.externalId`, `Installation`.

---

## Why this exists

A vendor-neutral referee that can only read half an enterprise's forges is not neutral. DX, Swarmia,
Jellyfish, LinearB and OpenSSF Scorecard all read GitLab. Before this change, `parseRepoUrl` rejected
an explicit `gitlab.com` URL outright, and all the platform enrichments were hard-wired to
`src/lib/github/*` inside `scan-ingest.ts`.

## The shape

One `Forge` record per forge — a parser, a snapshot source, an **optional** enrichment set, and a
capability manifest:

| Piece | File |
| --- | --- |
| The contract (`Forge`, `ForgeCapabilities`, `EnrichmentSource`, `ParsedRepo`, `RepoSource`) | `src/lib/forge/types.ts` |
| Resolution + the URL router (`resolveForge`, `parseForgeUrl`, `forgeFullName`) | `src/lib/forge/registry.ts` |
| GitHub — **pointers only** | `src/lib/forge/github.ts` |
| GitLab — the one real second adapter | `src/lib/forge/gitlab/{source,merge-requests,governance,pipelines,deployments,http}.ts` |
| Local working copy | `src/lib/forge/local.ts` |

### GitHub is wired by reference, and that is enforced

Nothing moved out of `src/lib/github/**`. `github.ts` is a record whose every field points at the
function `scan-ingest.ts` called directly before the seam existed, and `github-parity.test.ts` asserts
that field by field with `toBe` — reference identity, not behavioural approximation. A well-meant
inline re-implementation ("just adding a try/catch") turns the suite red, which is the only thing that
reliably stops an extraction from becoming a rewrite.

`scripts/forge/equality.mts` is the release gate for that claim:

```
# offline, deterministic, no network: a recorded GitHub scanned through the routed path AND through
# the pre-#4 construction, with the two {scoreInput, snapshot} captures compared byte for byte
npx vite-node --config vitest.config.js scripts/forge/equality.mts

# live, against fixtures captured from master before the extraction (needs GITHUB_TOKEN)
npx vite-node --config vitest.config.js scripts/forge/equality.mts --baseline bench/matrix-inputs
```

## Identity — why the unique constraint survived

`fullName` stays `owner/name` for GitHub, byte-identical, so no existing row moved and the live
`@@unique([orgId, fullName])` needed no migration. A non-GitHub repo is namespaced in the **value**,
not the key: `gitlab:group/sub/project`. A GitHub coordinate can never contain a colon, so a collision
is impossible, and every route that takes `?repo=owner/name` keeps working.

For GitLab, `owner` is the project's **namespace path** and `repo` its last segment, so `owner/repo`
reconstitutes the full path GitLab's API addresses — subgroups included. `externalId` holds the
forge-native numeric project id when one is known; `null` for GitHub, where the coordinate *is* the id.

## What each forge can be observed for

Derived from each adapter's compiled `ForgeCapabilities`, which is also what the Integrations card
renders — so this table cannot drift from the code.

| Signal | GitHub | GitLab | Local |
| --- | --- | --- | --- |
| Snapshot (tree, files, commits) | yes | yes | yes |
| Pull / merge requests, approvals, AI attribution | yes | yes | — |
| Branch governance (protection, approvals, push rules) | yes | yes | — |
| CI health (pipelines) | yes | yes | — |
| Deployments / environments | yes | yes | — |
| CODEOWNERS | yes | yes | (read as a file) |
| Platform security posture (published advisories + org policy) | yes | **no** | — |
| Dependency exposure (OSV over the committed lockfile) | yes | **no** | — |
| App / check-suite inventory | yes | **no** | — |
| Writes (PR gate comments, check runs, ruleset writes) | yes | **no** | — |
| Keyless (anonymous) scanning | yes | **no** | yes |

Why the GitLab `no`s are honest rather than lazy:

- **securityPosture** — GitLab has no public equivalent of GitHub's repo-published advisories plus
  org-level `SECURITY.md`. Its security features are pipeline jobs, already visible to the
  committed-file detectors, so inventing a posture record would double-count what the file battery
  already reads.
- **securityExposure** — the OSV read is GitHub-content-bound (`fetchNpmDeps` reads the lockfile over
  GitHub's API). Wiring it to GitLab is a real feature, not a mapping.
- **appInventory** — GitLab has no GitHub-App / check-suite concept. There is nothing to read.
- **write** — PR-gate comments and check-run writes stay GitHub-only by design. A write path that
  half-works across forges is worse than one that is honestly absent.
- **anonymous** — a product decision, not a technical one: gitlab.com rate-limits unauthenticated
  project reads hard enough that a public funnel scan would be unreliable, and an unreliable scan
  presented as a verdict is worse than a refusal.

### Honest nulls, and what that means for the score

**A capability a forge lacks is reported as unknown. It is never a zero, and no score is adjusted to
compensate for it.**

A missing `EnrichmentSource` member reaches the report through the paths that already existed for a
token-less scan — `governance: null`, `prStats: null`, `deployments: []`. Every platform-observed fold
is additive, so a forge with fewer observables **floors** a score rather than penalising it: exactly
the construction that makes an anonymous GitHub scan a floor rather than a different rubric. The
rubric, the scorer and `SCORING_RUBRIC_VERSION` are untouched by this feature.

**Score comparability across forges.** A GitLab repo and a GitHub repo are scored by the same rubric
and the same code, and ingestion volume is held equal (the GitLab source reuses `pickFilesToFetch`,
`MAX_FILES` and the byte budgets from `github/source.ts` exactly). But a GitLab repo is scored on
fewer *observed* signals, so its ceiling on the platform-observed folds is lower. Read a cross-forge
comparison as "GitHub repo ≥ GitLab repo on the platform dimensions" being partly an artifact of
observability, not necessarily of practice. The benchmark corpus is **not** keyed by forge, and no
cross-forge percentile is published.

## Coordinates

| Surface | How the forge is named |
| --- | --- |
| `POST /api/scan` | a `gitlab:group/project` coordinate, or a `https://gitlab.com/...` URL |
| `POST /api/org/import` | forge-prefixed entries in `repos[]` |
| `GET /api/gate/:owner/:repo` | `?forge=gitlab`. The **path stays two segments** — CI callers, the check-run path and every doc use it, and adding a segment would churn a public contract for no gain |
| OTLP `git.repository` | a gitlab.com remote resolves to `gitlab:group/project`, the same identity the persist layer writes |

Unset or unrecognized ⇒ `github`, everywhere. `parseForgeUrl` tries an explicit `<forge>:` prefix
first, then each registered forge **github first**, so every input that parsed before parses
identically — and `githubForge.parseUrl` *is* `parseRepoUrl`, so the router and the historic entry
point cannot disagree.

## Credentials

A GitLab group access token or PAT is stored on `Installation.credentialRef` as `encryptSecret()`
ciphertext and read only server-side through `src/lib/db/forge-installations.ts`.

- The wire type `ForgeInstallationRow` has **no field** for the credential — not a redacted one. It
  carries `hasCredential: boolean`, which is a different fact with a different name, so there is no
  shape in which a route handler can serialize the secret.
- Setting or clearing one writes an `AuditLog` row (`forge.installation.set` / `.cleared`) naming the
  forge, external id and host — never the credential or its ciphertext.
- A deployment without `ENCRYPTION_KEY` **refuses** to store a credential rather than persisting one
  in the clear.
- Self-managed GitLab is a `host` override on the same row (https only). The GHES env vars in
  `src/lib/github/host.ts` are unchanged and still win for GitHub.

CRUD: `GET|POST|DELETE /api/org/forge/installation`, `requireOrgRole("admin")`, same-origin. No `[id]`
route is added — the row is addressed by `(org, forge, externalId)`, all supplied together — so
`id-routes-gated.test.ts` is untouched by design, not by omission.

`Organization.githubInstallId` is untouched and remains the GitHub read path. Migrating a live
identity column onto `Installation` deserves its own release.

## Plan gates

Non-GitHub forges are **not** a paid feature. `selfHosted()` turns every plan gate off anyway, and
gating breadth would contradict the neutrality claim. The scan entitlement / credit path is unchanged
and forge-agnostic.

## Known gaps

- **No GitLab group listing in org import.** A GitLab project is imported by explicit coordinate
  (`gitlab:group/project` in `repos[]`); pasting a group and having Ascent enumerate its projects is
  not built. GitHub org listing (`listOrgRepos`) is unaffected.
- **`securityPosture`, `securityExposure` and `appInventory` are unimplemented for GitLab** — see the
  table above for why each is absent rather than approximated.
- **No write path on any forge but GitHub.** PR gate comments and check runs are GitHub-only, and
  degrade to absent elsewhere rather than failing.
- **`medianDurationMin` is usually null for GitLab CI health.** GitLab's pipeline *list* omits
  `duration`; only the per-pipeline read carries it, and firing 50 extra calls per scan is not worth
  one display field. Null reads as unknown, never as a fast pipeline.
- **GitLab approvals carry no timestamp**, so `medianHoursToFirstReview` is null for GitLab repos. A
  merge time borrowed as a review time would fabricate the number.
- **`RepoMeta` has no `forge` field yet**, so the three `repository.upsert` sites infer the forge from
  the repo's own web url. The inference is conservative — anything not positively identified persists
  as `github`, so a GitHub repo can never be relabelled — but the durable fix is a one-line additive
  field on `RepoMeta`.
- **`Repository.externalId` is never written.** The column exists and the adapters can carry a
  forge-native project id, but nothing on the scan report transports one to the persist layer (same
  root cause as the bullet above). It stays `null`, which its schema comment already defines as "the
  adapter has not resolved it yet", never as "this repo has no id". A GitLab project renamed on the
  forge therefore re-persists under its new path rather than following the id.
- **No forge badge on Standing → Repositories.** The rows are built from `OrgRepoRow`
  (`src/lib/db/org-rollup.ts`), which carries no `forge` field; adding one was outside this lane's
  write set. A GitLab repo is still identifiable in the fleet by its `gitlab:` prefixed name, but not
  by a badge.
- **No Bitbucket or Azure DevOps adapter.** The contract is ready; neither is built.
- **No cross-forge benchmark percentile.** The corpus is not keyed by forge.

## Tests

| File | Guards |
| --- | --- |
| `src/lib/forge/github-parity.test.ts` | every declared capability is bound **by reference** to its `src/lib/github` export; the routed path builds the same `GitHubPublicSource`; the `.ai/memory` quarantine survives the routed path |
| `src/lib/forge/registry.test.ts` | github-first resolution order, the `<forge>:` prefix, subgroup paths, identity round-trip |
| `src/lib/forge/gitlab/mappers.test.ts` | fixture-driven mappers — an unmapped `Governance` field is `false`, "no sample" is null not 0%, an unjoinable deployment is dropped |
| `scripts/forge/equality.mts` | the byte-identity release gate |
