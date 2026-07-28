# T2 resolution — the `.ai/` standard, the executable doctor, and fleet remediation PRs

_Resolved 2026-07-28 against the working tree at `a629971f`. Every claim below is checked against code;
`file:line` citations are load-bearing. Where `docs/GOLDEN-TRIO.md` §T2 is wrong, it is corrected._

---

## 0. Corrections to the strategy doc (read this first)

The §T2 paragraph "What already exists" is **materially optimistic in three places and stale in two more.**
Four of the five directions change shape once the code is read.

### C1 — the spec's source of truth is a dead path, and the drift test fails on master

`src/lib/standard/spec.ts:9-12` declares:

> `SOURCE OF TRUTH: docs/AI_MANIFEST_SPEC.md. This constant is a VERBATIM mirror and standard.test.ts
> fails if the two drift`

That file **does not exist on disk.** A staged (uncommitted) docs reorg renamed it:
`docs/AI_MANIFEST_SPEC.md → docs/features/onboarding/ai-manifest-spec.md`. Verified by running the suite:

```
× the .ai/SPEC.md body is byte-identical to docs/AI_MANIFEST_SPEC.md (drift guard)
  Error: ENOENT ... docs\AI_MANIFEST_SPEC.md          (standard.test.ts:315)
Test Files 1 failed | Tests 1 failed | 58 passed
```

Five more references point at the dead path: `spec.ts:9`, `spec.ts:12` (the re-mirror command),
`manifest.ts:3`, `index.ts:4`, `doctor.ts:4`, plus the generated doctor's own score-semantics comment
(`doctor.ts:226`) — meaning **every adopting repo ships a `.ai/doctor.mjs` that cites a 404**. The spec is
T2's core asset and its provenance chain is currently broken in the customer-facing artifact.

> **This is a hard prerequisite (call it D0). Nothing in T2 should ship before it is fixed.**
> Note the working tree is being edited by a concurrent session; the reorg is staged, not committed.

### C2 — `doctor.mjs` and `guardrails.yaml` are not files; they are TypeScript string constants

The doc reads as though runnable artifacts exist. They do not. `.ai/doctor.mjs` is a 260-line template
literal inside `src/lib/standard/doctor.ts:12-275`, emitted by `buildDoctor()` (`:277-284`); `guardrails.yaml`
is a template literal in `guardrails.ts:26-50`. There is **no standalone executable, no npm package, no
`bin` entry, nothing to `npx`**. Direction 2 is therefore not "ship the thing we have" — it is an
extraction-and-packaging project. The *logic* is genuinely good and battle-hardened (the standalone-token
`wired()` fix at `doctor.ts:44-54`, commit-date-not-mtime freshness at `:191-204`, the unfilled-template
CONTEXT detector at `:210-218` are all real, earned refinements). It is the *distribution* that is 0% built.

### C3 — "leak-free templatization … a genuinely hard thing we already solved" is **false**

This is the most important correction, and it inverts direction 3.

`buildArtifact` (`practice-artifact.ts:252-473`) is a fixed `switch` over **nine hardcoded practice ids**
emitting **static template bodies with `<!-- TODO -->` placeholders**. `PRACTICES[].starter`
(`practices.ts:17-123`) is a static `string[]`. The only repo-derived inputs are `name`, `fullName`,
`description` (sanitized, `:184-186`), `primaryLanguage → commandsFor`, and `defaultBranch`.

And the exemplar carries **no content at all**: `org-insights.ts:854` and `:978` produce
`{ name, fullName, score }`. It is a *pointer*. Nothing anywhere reads the exemplar's files.

So: the org's exemplar shape does not travel today, at all. The good news is the corollary — **the current
system is trivially leak-free because it extracts nothing.** Direction 3 does not harvest a solved
capability; **direction 3 is the thing that creates the leak risk in the first place.** §3 below designs it
from zero and treats containment as the primary requirement, not a footnote.

### C4 — batched fleet remediation is **already shipped**; only the tailoring is missing

The doc says "Extend to *batched, org-scoped* application." That extension is done:

- `src/app/api/practices/apply-batch/route.ts` — `MAX_BATCH = 25` (`:25`), one-org tenancy gate (`:64-71`),
  dedupe-before-cap (`:78-85`), bounded `mapPool` fan-out with per-repo error isolation (`:97-123`).
- `src/lib/practices/apply.ts` — the shared write pipeline, preview→apply content fingerprint (`:44-46`,
  `fingerprint.ts:11`), audit row, and `recordPracticePr` lifecycle hand-off to the merge monitor (`:78-87`).
- UI: `PracticeApplyBatch.tsx`, `PracticeApplyBatchResults.tsx`, `PracticeLedger.tsx`; post-merge lift is
  already summarized (`practice-library.ts:170-180`).

T2-3 is ~70% built. Re-scope it from "build batch remediation" to "make the batch *tailored* and *safe*."

### C5 — `openDraftPr` refuses to touch any file that already exists on base

`github/write.ts:82-89` throws `409` when the target path exists on the base branch — deliberately, and
correctly (the comment at `:76-81` explains a 25-repo batch could otherwise wipe real `SECURITY.md`s
fleet-wide). But the consequence is unstated in the strategy doc:

> **Remediation can only seed a MISSING file. It can never improve a weak existing one.**

A fleet whose repos all have a stale two-line `AGENTS.md` will 409 on every single repo. This is a direct
blocker for direction 4 (whose entire output is *reconciling* existing files) and caps direction 3's reach.
An "amend existing file" write path is a shared prerequisite for D3 and D4.

### C6 — licensing and repo shape block directions 1 and 2 outright

`package.json` is `"private": true` with `"license": "BUSL-1.1"`. BUSL is **not OSI-approved**. You cannot
`npm publish` this package, and you cannot donate BUSL code to the Linux Foundation. Both the "free OSS
wedge" (D2) and any AAIF donation (D1) require a **separate, separately-licensed repository/package**.
This is a business decision that gates engineering, and the strategy doc does not mention it.

### C7 — a publishable Action already exists, but it is the *wrong* Action

`action.yml` at the repo root is real and well-documented — but it is the **hosted** maturity gate: it
requires `ascent-url` and calls your deployment's `GET /api/gate`. Its own header (`action.yml:17-22`)
documents that it **cannot gate private repositories** (the gate endpoint is unauthenticated by design and
answers 404). Direction 2 needs a *second, different* Action that runs the offline doctor with no URL, no
account, and no network. Do not conflate them.

### C8 — the conformance ingest token is the weakest link in the loop

`src/app/api/report/conformance/route.ts:63-70` authenticates against a **single deployment-wide**
`CONFORMANCE_INGEST_TOKEN` via a non-constant-time compare. Any holder can overwrite **any** repo's
conformance score. Meanwhile the Skills Library already has the right thing: per-org `askl_` tokens with
hashed storage, scopes, and soft revoke (`db/org-api-tokens.ts:15,60,133`; `api-token-auth.ts:28-63`).
The conformance path should move onto that system before it is promoted to a public distribution surface.

### C9 — the competitive read on direction 2 is out of date

The doc names the PyPI `agent-readiness` free floor. It misses the direct competitor:
**`kodustech/agent-readiness`** — MIT, `npx @kodus/agent-readiness .`, 39 checks / 7 pillars / 10+ languages,
`--ci --min-level`, local-only, JSON output, self-described "open-source alternative to Factory.ai's Agent
Readiness" (https://github.com/kodustech/agent-readiness). PyPI `agent-readiness` is at **v4.1.0**
(2026-06-01, https://pypi.org/project/agent-readiness/). npm `ascent` is **taken** (v1.0.1, abandoned 2015).
The free-npx lane is contested; ascent's differentiator there is the *declared-then-proven manifest*, not
"another checker."

### C10 — MCP is 100% greenfield (direction 5)

There is **no** `@modelcontextprotocol` dependency, no MCP server, no MCP client, no registry code, and
`.mcp.json` is **never parsed**. All that exists is presence-regexes: `analyze/index.ts:197`
(`.mcp.json` / `mcp.config.*` → `+10`) and file-selection at `github/source.ts:710-713`. Six comments across
`memory/recall.ts:189`, `consolidation.ts:18,262`, `api/org/memory/recall/route.ts:18` say "the future MCP
tool" — aspiration, no code.

### C11 — direction 4's inputs are already fetched, which makes it cheaper than the doc implies

`github/source.ts:650-654` already fetches up to 4 agent-guidance files per repo (`claude.md`, `agents?.md`,
`.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`, `.cursor/rules/`), and `analyze/index.ts:190-201`
already scores each as a presence signal. But **only one file's content is ever read** — `index.ts:204` reads
the first of `claude.md || agents.md || agent.md` for quality. **No cross-file comparison exists anywhere.**
The bytes are already in hand; the arbiter is a new pure module over data the scanner already has. This is
the single cheapest direction in T2 and the doc ranks it fourth.

### C12 — skill health is half-built, not unbuilt (direction 5)

`org/skill-usage.ts` ships dormancy verdicts (`new|active|dormant`, 30-day window, `:19-22`) and
`org/skill-outcomes.ts` ships before/after adoption measurement. What does **not** exist server-side is
*body drift*: `skill-usage.ts:1-2` says so explicitly ("the CLI knows whether a skill's BODY drifted, this
knows whether the skill is still USED"). The only change key is `contentHash`/`version`
(`prisma/schema.prisma:695`). There is also already a zero-dep CLI — `scripts/ascent-skills.mjs` — with a
`status` command producing `in_sync | diverged | stale | local_only | missing`. **That file is the natural
home for a packaged `npx` binary (see D2), not a greenfield project.**

---

## 1. Direction 1 — publish the spec as a neutral standard, become the reference validator

### Exists
- The spec itself: `docs/features/onboarding/ai-manifest-spec.md` (135 lines, v0.1.0). It is genuinely good —
  capabilities-not-tools, pointers-not-embeds, must-ignore-unknown, semver-additive, `generatedFrom` drift,
  declared-then-proven, and an unusually honest "Score semantics" section (`:107-122`) that admits the
  percentage is a display heuristic.
- A verbatim mirror shipped into every adopting repo as `.ai/SPEC.md` (`spec.ts:21-156`, `SPEC_PATH = ".ai/SPEC.md"`).
- A drift test pinning the two together (`standard.test.ts:312-317`) — **currently failing, see C1.**

### Gap
1. The source of truth is a 404 (C1).
2. **No machine-readable schema.** The spec is prose + markdown tables. There is no JSON Schema, no
   `$id`, no versioned URL. A "reference validator" with nothing to validate against is a claim, not an asset.
3. **No neutral home.** No public route serves the spec; nothing outside this repo can link to it.
4. **BUSL** (C6). The spec text and the app code are under the same license today.
5. AAIF's actual bar is much higher than the doc assumes. The Project Lifecycle Policy
   (https://github.com/aaif/project-proposals/blob/main/governance/project-lifecycle-policy.md) requires,
   for the *entry* stage (Growth): a TC sponsor, **production-scale usage**, consistent commits, a community,
   **transfer of trademarks/assets to the Linux Foundation**, a technical charter, then **>50% of the full
   Technical Committee** plus **Governing Board sign-off**. There is no documented spec-donation track (AGENTS.md
   was a founding donation from OpenAI, not an applicant). AAIF hosts exactly three projects (MCP, goose,
   AGENTS.md) as of its Q1-2026 retrospective.

### Design — **descope hard.** Kill "propose to AAIF this cycle"; keep the 90% that costs 5%.

Adoption must precede donation; the policy says so in as many words. Proposing now fails and burns the option.

**Ship instead (D1-lite):**

- **`ai-manifest.schema.json`** + **`ai-guardrails.schema.json`** — JSON Schema 2020-12, `$id` at a stable
  versioned URL (`https://<host>/spec/ai-manifest/0.1.0/schema.json`). Derived from `types.ts:ManifestData`
  and `MANIFEST_SCHEMA_VERSION`. This is the real "reference validator" asset — it is what other tools consume.
- **Public, unauthenticated routes**: `GET /spec/ai-manifest/:version` (the markdown) and
  `/spec/ai-manifest/:version/schema.json`, plus `latest` aliases. Served from the existing `SPEC_MD`
  constant — no DB, no token, works in a standalone build.
- **Relicense the spec text + schemas only** as **CC-BY-4.0** in a `spec/` directory with its own `LICENSE`.
  The app stays BUSL. This is the minimum viable neutrality and the precondition for any later donation.
- **Fix D0 first**, and add a second drift test asserting the schema and `ManifestData` agree, so the
  three artifacts (doc, `SPEC_MD`, schema) cannot separate.
- **Register the vocabulary where readers already look**: an `AGENTS.md` convention note that a conformant
  repo *may* declare `.ai/manifest.yaml`. AGENTS.md 1.0 has no required fields, so it cannot carry structured
  gates/owners itself — that vacuum is real and confirmed, and pointing at it from AGENTS.md is the cheap
  distribution move that needs no governance approval.

**Degradation:** everything here is static. No DB, no token, no network.

**Effort: S** — ~5 files (2 schemas, 1 route + `latest` alias, 1 LICENSE, D0 fixes). **Depends on: D0.**

---

## 2. Direction 2 — `npx` doctor, GitHub Action, pre-push hook

### Exists
- The doctor logic, mature and zero-dep, as a string in `doctor.ts:12-275`. Seven check classes matching
  the spec's §Conformance. Hard-fails on git-tracked never-commit files (`:120-131`). `--json` + optional
  POST-back (`:239-273`) with correct HTTP-error handling (it inspects `res.ok`, `data.stale`, and
  `data.recorded === false` rather than trusting a resolved `fetch` — `:262-267`).
- The CI backstop workflow generator, least-privilege (`permissions: contents: read`) — `wiring.ts:15-39`.
- The ingest endpoint — `api/report/conformance/route.ts` (bounds-clamped, staleness ledger via the audit log,
  `db/org-watch.ts:370-417`).
- A second, hosted Action — `action.yml` (C7).
- A precedent for a packaged zero-dep CLI — `scripts/ascent-skills.mjs` (C12).

### Gap
- No package, no `bin`, no publish path (C2, C6).
- The generated `ai-conformance.yml` **does not pass `--run`** — correct today (fork-PR RCE, `doctor.ts:18-22`)
  but it means CI never proves capabilities, only declares them.
- `--run` **writes back** to `manifest.yaml` (`doctor.ts:153-165`). In an Action this dirties the checkout.
- Ingest auth is a shared static token (C8).
- The pre-push side is *instructions only* — `wiring.ts:4-5` explicitly says the hook is a one-line manual
  edit. Nothing installs it.

### Design

**Package split (the business decision, C6).** Publish a new MIT/Apache-2.0 package from a `packages/`
directory or a mirror repo. `doctor.ts` becomes a **build step that emits** `packages/doctor/doctor.mjs`,
with the existing `SPEC_MD` drift test extended to pin the emitted file — so the app keeps one source of
truth and the package is never hand-maintained. npm `ascent` is taken (C9); use a scope you control.

**Three artifacts, one binary:**

| Artifact | Shape | Account? | Network? |
|---|---|---|---|
| `npx <pkg> doctor` | the emitted `doctor.mjs` + an `init` that scaffolds `.ai/` from a local heuristic scan | no | no |
| `<owner>/ai-doctor-action@v1` | thin composite action: `setup-node` + `npx <pkg> doctor --json`; `fail-below` / `fail-on` inputs; **SARIF output** | no | no |
| `<pkg> install-hook` | appends one line to an existing lefthook/husky/pre-commit config; **refuses** to create a parallel hook system (matching `wiring.ts:4-5`) | no | no |

**Reporting is strictly opt-in and additive.** `--json` already degrades correctly: it emits
`summary.reportSkipped` naming the missing env vars (`doctor.ts:247-249`). Keep exactly that.

**Fixes required before publishing:**
- `--run` must not mutate the manifest when `CI=true` unless `--write` is passed. Add `--no-write`;
  default it on in the Action.
- Move ingest onto per-org `askl_` tokens with a new `conformance:write` scope
  (`db/org-api-tokens.ts:15`, `api-token-auth.ts:41`), keeping the legacy env token behind a deprecation
  window. Use `crypto.timingSafeEqual`. **This is a security fix, not a feature.**
- Emit **SARIF** from `--json`. Scorecard's and the PyPI competitor's adoption both run through SARIF →
  the GitHub Security tab; it is the cheapest real distribution surface available.

**The Scorecard lesson the doc half-states.** Scorecard's 1M-repo dataset does **not** come from its Action.
It comes from a **weekly cron that passively scans the 1M most-critical repos** into a public BigQuery
dataset (`openssf:scorecardcron.scorecard-v2`), with the Action as an *opt-in override* whose results are
attested by **GitHub OIDC** (`id-token: write`, `publish_results: true`). Ascent already scans public repos
with no account — **it already has the passive half.** The missing pieces are (a) a public read API
(`GET /api/conformance/:owner/:repo`, CDN-cached, mirroring `api.scorecard.dev`), and (b) OIDC attestation
so a self-reported score can be trusted enough to override the passive one. Recommend adopting OIDC and
retiring the shared bearer token entirely — it solves C8 and the Scorecard-parity problem in one move.

**Degradation:** the CLI is offline-first by construction and already correct on this axis.

**Effort: L** — ~12 files plus a licensing/repo decision. **Depends on: D0, C6 resolution, C8 fix.**

---

## 3. Direction 3 — batched fleet remediation PRs, tailored from the org's own exemplars ⟵ *the hard one*

### Exists
Everything except the tailoring (C4). Batch fan-out, tenancy, dedupe, caps, per-repo isolation, preview→apply
fingerprinting, audit, PR lifecycle, post-merge lift. Plus prompt-injection sanitization already applied to
repo-supplied text before it lands in a committed file (`practice-artifact.ts:176-186`).

### Gap
1. **No shape extraction whatsoever** (C3). The exemplar is `{name, fullName, score}` — a pointer.
2. **Cannot amend an existing file** (C5) — 409 on every repo that has a weak `AGENTS.md`.
3. **No visibility check.** Nothing anywhere compares the exemplar's visibility to the target's.

### Design — the **Shape Extractor**, allow-list by construction

The whole design rests on one inversion. A *deny-list* ("strip secrets, strip code, strip internal names")
is unbounded and always loses eventually. An **allow-list** — where every emitted field is either drawn from
a closed enum the extractor owns, or a structural token that passes a whitelist regex — is bounded **by
construction**, and its bound is *provable to a customer*.

**`ExemplarShape` — the complete, finite set of things that may travel:**

```ts
interface ExemplarShape {
  sourceRepo: string;            // provenance, always disclosed
  sourceVisibility: "public" | "private";
  practiceId: string;
  extractedAt: string;

  headings: string[];            // ONLY names present in the canonical heading lexicon
  headingsWithheld: number;      // count of non-lexicon headings — carried as a NUMBER, never text
  sectionOrder: string[];        // permutation of `headings`

  capabilities: { name: string; command: string | null }[];  // name from the spec vocabulary; command may be null
  hookSystem: "lefthook" | "husky" | "pre-commit" | null;
  ciJobNames: string[];          // lexicon-matched or withheld
  ciActionRefs: string[];        // `owner/action@ref` only, regex-validated
  conventions: Convention[];     // closed enum: conventional-commits | codeowners | adr-dir | pr-template | signed-commits | …
  mcpServers: string[];          // names only, and ONLY if resolvable in the official MCP Registry (see D5)
}
```

**The four extraction rules:**

1. **Headings — lexicon-only.** The genuine leak vector is `## Integrating with AcmePay's ledger v3`.
   A heading travels **only if** it normalizes to a member of a fixed ~60-entry lexicon (Commands, Architecture,
   Testing, Constraints, Security, Data flow, Conventions, …). Anything else increments `headingsWithheld`
   and is discarded. This is the difference between "we sanitize" and "we can only ever emit from a fixed
   vocabulary." The *ordering and presence* of generic headings is where nearly all the real value is anyway.
2. **Commands — shape-validated or nulled.** `npm run deploy:acme-prod` carries information.
   A command travels verbatim only when the target shares the exemplar's language family **and** it matches
   `^[\w@/.:-]+( [\w@/.:=-]+)*$` with no URL, no hostname, no absolute path, and no high-entropy token.
   Otherwise the **capability name** travels and the command becomes a `TODO`. Env var **names** may travel;
   values never — reuse `guardrails.ts:NEVER_COMMIT` concepts as a rejector.
3. **No file contents. Ever.** The extractor reads exemplar files; it emits only the struct above. No line,
   snippet, or paragraph of exemplar text reaches any artifact.
4. **Uniform injection sanitization.** Apply `practice-artifact.ts:safeText` (`:184-186`) to **every** carried
   string, not just `description` as today. Exemplar text becoming instructions inside a target's `AGENTS.md`
   is a real prompt-injection path.

**Leak-risk register (be honest about all four):**

| # | Risk | Control |
|---|---|---|
| L1 | Internal identifiers (product/service names) in headings, job names, script names | Lexicon allow-list; **plus intra-org scoping — `apply-batch/route.ts:64-71` already forbids cross-org batches**, so blast radius is bounded to the org owning both repos |
| L2 | Private→public leak: a private exemplar's vocabulary landing in a **public** repo of the same org | **New, mandatory:** refuse extraction when `sourceVisibility === "private"` and the target is public. **Nothing checks this today** — it is the one genuinely dangerous gap |
| L3 | Architecture disclosure (the shape *is* mild disclosure) | Accepted and documented; intra-org scoping (L1) makes it proportionate |
| L4 | Prompt injection via carried text | Rule 4 above |

**How a customer verifies nothing leaked — this is what makes it sellable:**

1. **The shape IS the artifact.** Render the complete `ExemplarShape` JSON in the preview UI *before* any PR.
   If a string is not in that finite object, it cannot be in the PR. That is auditable in thirty seconds —
   unlike "we prompted the model to be careful."
2. **Provenance block in every PR body**: `Derived from acme/api. Carried: 7 heading names, 4 commands,
   2 CI action refs. Withheld: all file contents, 3 repo-specific headings, all env values.` The reviewer can
   check the named exemplar themselves.
3. **Determinism + replay.** The extractor is pure. Ship `<pkg> shape --explain <repo>` (D2's binary) so the
   customer re-runs it and diffs. A deterministic extractor is *reproducible evidence*; an LLM is not.
4. **A leak-canary suite.** A fixture exemplar seeded with planted secrets, internal product names, and
   proprietary tokens; assert none appear in any generated artifact for any practice. This is the regression
   gate **and** the exhibit for a customer security review.
5. **Audit row** — `recordAudit("practice.shape_extracted", { exemplar, target, fieldsCarried, withheld })`,
   riding the existing HMAC audit log (T1's asset). Ties D3 to the evidence ledger.

**On LLM generalization.** A Tier B that lets an LLM *phrase* the tailored artifact is defensible **only if
the LLM's input is the `ExemplarShape` struct and never the exemplar's raw files** — it cannot leak what it
was never shown. **Recommend killing outright any variant where the model sees raw exemplar content.** It
destroys claims 1, 3, and 4 above, which are the entire commercial argument, in exchange for prose polish.

**Also required (C5):** an `amendExistingFile` path in `github/write.ts` — same 409 safety, but opt-in via an
explicit `mode: "seed" | "amend"`, where `amend` requires the caller to have previewed a **diff** and passes
the base file's sha. Without it, D3 reaches only repos missing the file entirely.

**Degradation:** extraction needs a token (it reads exemplar files). With no token or no exemplar, fall back
to exactly today's static template — the current behavior, unchanged. The UI must say *which* mode produced
the preview.

**Effort: M** — ~10 files (`practices/shape.ts`, `shape-lexicon.ts`, `shape.test.ts` + canary fixtures,
`practice-artifact.ts` tailoring hook, `write.ts` amend path, batch route + preview API, 2 UI files).
**Depends on:** the visibility rule (L2) is a blocker, not a follow-up. Benefits from D4 (more targets).

---

## 4. Direction 4 — the multi-format arbiter

### Exists
Presence detection with weights, and the bytes already fetched (C11): `analyze/index.ts:190-201`
(CLAUDE.md +22, AGENTS.md +16, `.cursorrules` +14, copilot-instructions +14, `.mcp.json` +10, `.claude/` +8,
`.windsurfrules` +10, `.aider.conf.yml` +10, `.continue`/`.clinerules` +8); `github/source.ts:650-654,663-666,691,710-713`
fetches up to 4 guidance files plus `.cursor/rules/` and `.mcp.json`; `analyze/passport.ts:157-167` maps them
into the passport's `artifacts.agentInstructions` grade.

### Gap
**Zero cross-file logic.** Only one file's content is read (`index.ts:204`). Presence is scored; *agreement*
is not. A repo with four mutually contradictory guidance files scores **higher** than a repo with one correct
one — the current model rewards proliferation, which is exactly backwards for a fleet running three vendors.

### Design
A pure module, `src/lib/analyze/arbiter.ts`, over content the scanner already holds:

- **Normalize** each format to a common `GuidanceDoc { source, commands, constraints, conventions, headings, lastCommit }`.
  Commands are the high-value axis — they are extractable and comparable across all five formats.
- **Three findings, in ascending severity:**
  - `duplicate` — same directive, N files, in agreement. Cost, not risk.
  - `stale` — file N's last commit predates file M's by > 90 days *and* they overlap in scope.
  - `contradiction` — same capability, **different commands** (`npm test` vs `yarn test`), or a constraint
    asserted in one and negated in another. This is the finding nobody else produces and the one a
    platform lead actually feels.
- **Nominate a canonical source** by a transparent rule (most recently committed ∧ most complete ∧ AGENTS.md
  preferred as the LF-governed neutral format), and **generate projections** — thin `CLAUDE.md` /
  `copilot-instructions.md` / `.cursorrules` that *point at* the canonical file rather than duplicating it.
  Projection-by-reference is the only maintainable answer; duplicating content just resets the drift clock.
- **Surface:** a new `dimension detail` panel on the report, a fleet rollup on the org dashboard (this is
  where it monetizes — *"11 of your 40 repos have contradictory agent guidance"*), and a remediation practice
  id `guidance-reconcile` that plugs straight into D3's existing batch machinery.
- **Scoring:** contradictions should *reduce* D1. Guard this behind the guardband discipline — a deterministic
  penalty is a real behavior change on existing customers' scores and needs a re-scan validation pass.

**Degradation:** pure over already-fetched content; works tokenless on public repos, works with zero DB.
Never emits a finding from a file it could not fetch (fetch caps at 4 files — record `truncated: true` and
suppress contradiction findings when truncated, or the arbiter will confidently report disagreement it
cannot see the resolution of).

**Effort: M** — ~8 files. **Blocked on** C5/`amend` for the projection-writing half; the *detection* half
ships independently and immediately.

---

## 5. Direction 5 — capability conformance for the agent layer

### Exists
- Skills: `OrgSkill`/`OrgSkillAdoption`/`OrgSkillEvent` (`prisma/schema.prisma:686-755`), dormancy verdicts
  (`org/skill-usage.ts:19-22`), adoption outcomes (`org/skill-outcomes.ts`), a sync manifest with `contentHash`,
  scoped `askl_` tokens, and a shipped zero-dep CLI with a drift `status` command (`scripts/ascent-skills.mjs`).
- Org Memory: a full store with anti-poisoning triad (provenance + confidence + `supersededBy`,
  `prisma/schema.prisma:786-818`), consolidation/recall/reflection/decay, and — critically —
  **`GET|POST /api/org/memory/recall`, explicitly built as the agent surface** (`recall/route.ts:18`),
  value-ranked and `charBudget`-packed.
- Manifest `agents: []` registry field, vendor-neutral `{id, kind, entrypoint}` (`manifest.ts:67`).

### Gap
- MCP: nothing (C10). `.mcp.json` is detected, never parsed, never validated.
- Skill **body**-drift: absent server-side (C12).
- Org Memory is fed **only** episodic scan events (`memory/scan-feed.ts`, `kind: episodic`,
  `source: scan-pipeline`, confidence 1.0). Nothing writes *verified capabilities*.

### Design
1. **Parse `.mcp.json` / `mcp.config.*`** into `{ id, transport, packageOrRemote }` — a small pure module.
   Zero new deps.
2. **Validate against the official registry.** The MCP Registry API is live and trivial:
   `GET https://registry.modelcontextprotocol.io/v0.1/servers/{urlEncodedName}/versions` returns versions with
   `isLatest`; `?search=` lists. OpenAPI 3.1 published at `/openapi.yaml`. Names are reverse-DNS
   (`io.github.<org>/name`, `com.example/name`) and namespace-verified via GitHub OAuth/OIDC or DNS/HTTP
   challenge. Emit three verdicts: `registry-verified` / `unlisted` / `unresolvable`. **Cache aggressively and
   fail *open*** — a registry outage must never fail a customer's gate. Note the registry only ever proves a
   *name is claimed*; it proves nothing about the server's behavior. Say so in the copy.
3. **Skill body drift, server-side.** The CLI already computes it (`ascent-skills status` → `diverged`).
   Promote it: have `sync`/`status` POST a per-repo divergence count into the existing `OrgSkillEvent` stream
   (a new `type: "drift"`), then roll it up beside dormancy. Cheap, and it closes C12 without new schema.
4. **Feed verified capabilities into Org Memory.** A new writer alongside `scan-feed.ts`, but
   `kind: "procedural"` (not `episodic`), `source: "capability-verification"`, `namespace: <repo fullName>`,
   and **confidence keyed to proof strength**: `1.0` for a doctor `--run`-verified capability, `0.6` for
   declared-but-unproven, `0.3` for registry-unlisted MCP. Then `/api/org/memory/recall` — which already
   exists and is already value-ranked — hands an agent the org's *proven* commands. **This is the one change
   that converts Org Memory from orphaned value into the standard's spine, and it needs no new API surface.**
5. Populate the manifest's empty `agents: []` from detected agent config, so the registry field stops being a
   permanent TODO (`manifest.ts:67`).

**Degradation:** registry lookups fail open to `unlisted`; skill drift needs the CLI + a token (absent → the
existing dormancy view, unchanged); memory writes need a DB (absent → skip, matching `scan-feed.ts`'s
never-throws contract).

**Effort: M** — ~9 files. **Depends on:** nothing hard; D2 makes step 3 much easier.

---

## 6. Ranking, build order, dependencies

| Rank | Direction | Value | Effort | Value/Effort | Note |
|---|---|---|---|---|---|
| **0** | **D0 — fix the spec source-of-truth + failing drift test** | blocking | **S** (3 files) | ∞ | Not optional. Master is red. |
| **1** | **D4 — multi-format arbiter** | high | **M** (8) | **highest** | Uncontested; inputs already fetched; detection half ships alone |
| **2** | **D3 — tailored fleet remediation** | highest | **M** (10) | high | 70% built; needs shape extractor + visibility rule + amend path |
| **3** | **D5 — capability conformance** | medium | **M** (9) | medium | Rescues two orphaned subsystems; registry API is trivial |
| **4** | **D2 — npx doctor / Action** | medium-high | **L** (12 + licensing) | medium-low | Contested lane (C9); blocked on a business decision |
| **5** | **D1 — the standard** (descoped) | medium | **S** (5) | — | Ship D1-lite with D0. **Kill the AAIF proposal this cycle.** |

**Recommended build order: D0 → D4 → D3 → D5 → D2 → D1-lite (rides along with D0).**

**I disagree with the doc's `2 → 3 → 1 → 4 → 5`,** on three code-grounded points:

- **D2 first is wrong now.** It is the *largest* item (L), it is gated on a licensing/repo-split decision the
  code cannot make (C6), it needs a security fix first (C8), and its lane acquired a direct MIT `npx`
  competitor since the doc was written (C9). "Distribution first" is right in principle; this is no longer the
  cheapest distribution available.
- **D4 last is wrong.** It is the cheapest direction in T2 (C11) — the bytes are already fetched — and it is
  the only one with no named competitor. It also *manufactures the remediation targets D3 sells*, so running
  it first compounds.
- **D1 should not be attempted as written.** AAIF requires production adoption *before* the entry stage, plus
  trademark assignment and a TC majority. Proposing now fails and burns the option. Descope to a schema, a
  public URL, and a CC-BY license — 90% of the value, ~5% of the cost, and it is the precondition for a
  donation later.

**Cross-direction dependencies:**
- D0 blocks everything (D1, D2 both ship the spec; D3/D4/D5 all cite it).
- **C5 `amend` path is a shared blocker for D3 and D4** — build it once, in `github/write.ts`, first.
- **C8 token fix blocks D2** and should land regardless (it is a live vulnerability).
- D4 → D3 (arbiter findings become the `guidance-reconcile` batch practice).
- D5 → D3 (registry-verified MCP names are an `ExemplarShape` field).
- D2 → D5 step 3 (skill drift reporting rides the packaged CLI).

---

## 7. Open decisions for the human

1. **Licensing / repo split (blocks D2 and any D1 donation).** Publish an MIT/Apache-2.0 package from
   `packages/` in this BUSL repo, or a separate mirror repo? This is the single decision with the longest
   lead time — everything in D2 waits on it.
2. **npm name.** `ascent` is taken (abandoned since 2015). Pick a scope now; the CLI name is a distribution
   asset and renaming later is expensive.
3. **OIDC vs bearer token for conformance reporting.** Adopting Scorecard's `id-token: write` attestation
   solves C8 *and* buys the passive-scan-plus-opt-in-override structure in one move — but it is a bigger
   change than patching the token compare. Recommend OIDC; confirm.
4. **Should contradiction findings (D4) move the D1 score?** A deterministic penalty changes existing
   customers' scores and needs a re-scan validation pass (the same discipline `REFERENCE-SCAN-AUDIT.md`
   demands). Ship detection-only first, or score immediately?
5. **Tier B LLM in the shape extractor.** I recommend allowing the LLM to see *only* the `ExemplarShape`
   struct and killing any raw-exemplar variant. Confirm — this is the decision that determines whether the
   leak-free claim survives a customer security review.
6. **Public-target rule (L2).** Should a private exemplar's shape *ever* travel into a public repo of the same
   org, even with explicit operator consent? Recommend a hard no (unconsentable), not a warning.
7. **Fleet vs free boundary.** The doc says fleet aggregation is the paid layer. Confirm the arbiter's
   *per-repo* detection is free (it drives adoption) and only the *fleet rollup* is paid — otherwise D4 loses
   its distribution role.
8. **Who owns the heading lexicon?** A fixed ~60-entry list is the whole safety guarantee of D3. Ascent-curated
   (safe, less useful) or org-extensible (more useful, and every org-added entry is an org-accepted leak
   channel)? Recommend Ascent-curated for v1.
