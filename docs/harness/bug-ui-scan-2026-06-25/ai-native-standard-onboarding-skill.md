# AI-Native Standard & Onboarding Skill — Bug + UI Scan
> Context: AI-Native Standard & Onboarding Skill (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. Doctor's freshness check fires on EVERY CI run (git checkout resets mtimes)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / false-positive
- **File**: src/lib/standard/doctor.ts:113-117 (emitted into `.ai/doctor.mjs`)
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: The doctor warns "manifest may be stale" when `statSync(f).mtime` of a `generatedFrom` file (e.g. `package.json`) is newer than `generatedAt`. The doctor's PRIMARY runtime is the generated `.github/workflows/ai-conformance.yml`, which checks out the repo with `actions/checkout`. Git does not preserve/restore file mtimes — every file gets the checkout timestamp ("now"), which is always > the past `generatedAt` scan date. So the warn fires on every CI run regardless of whether the manifest is actually stale.
- **Root cause**: Drift is being inferred from filesystem mtime, but mtime is not durable across clones/checkouts — only commit/author dates are.
- **Impact**: The conformance score (`weight.warn = 0.5`) is permanently depressed and can never reach 100 for any repo whose provenance file exists; the deflated score is POSTed back and shown on the Ascent dashboard (the product's headline adopt→verify loop). Users are trained to ignore a warning that is always present.
- **Fix sketch**: Compare against the file's last *commit* date (`git log -1 --format=%cs -- <file>`) instead of mtime, or skip the mtime check when `process.env.CI`/`GITHUB_ACTIONS` is set, or gate it behind a non-`--json` (interactive) run only.

## 2. Conformance POST reports "success" even when the server rejects it
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/standard/doctor.ts:144-154 (emitted into `.ai/doctor.mjs`)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: In `--json` mode the doctor does `await fetch(reportUrl, …)` then unconditionally `console.log('Reported conformance to Ascent.')`. It never inspects `res.ok`/`res.status` or the JSON body. A 401 (wrong `ASCENT_CONFORMANCE_TOKEN`), 503 (Ascent DB off), or `{ ok:true, recorded:false }` (repo not watched under the org — see conformance/route.ts:53) all still print the success line.
- **Root cause**: `fetch` only rejects on network failure, not on HTTP error status; the success message is tied to "the call didn't throw," not "the server accepted it."
- **Impact**: A maintainer wires the CI reporting integration, sees "Reported conformance to Ascent", and believes the loop is closed — but the dashboard silently never updates. The single most-load-bearing integration of this context fails invisibly.
- **Fix sketch**: Check `res.ok` and parse the body; log distinct messages for accepted vs `recorded:false` vs HTTP error (`console.error('Conformance report rejected: ' + res.status)`), still non-fatally.

## 3. `maintain.mjs check` nags about the root CONTEXT on literally every change
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / false-positive
- **File**: src/lib/standard/maintain.ts:37-43 (seed index from src/lib/standard/context.ts:43-52)
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: The seeded `.ai/context-index.json` contains exactly one module: `{ id:"root", path:"." }`. In `check`, a `path:"."` module sets `dir=''`, so `codeHere = files.some(f => !f.endsWith('CONTEXT.md') && (dir===''? true : …))` — i.e. true whenever ANY non-CONTEXT file changed anywhere, including `.ai/memory/NNNN-*.md` notes. Unless the user edits root `CONTEXT.md` in the same change, it prints `[WARN] CONTEXT may be stale for "root"`. The skill tells users to wire `node .ai/maintain.mjs check` into pre-push, so this warns on every push from day one.
- **Root cause**: A catch-all root module ('.') matches every path, so the freshness rule can never be satisfied without touching root CONTEXT on each commit — until per-module entries are registered (which most repos won't do immediately).
- **Impact**: Warning fatigue out of the box; the self-maintenance signal the standard sells becomes noise users learn to ignore, defeating the feature.
- **Fix sketch**: Treat a sole root '.' module as "unscoped" and skip the staleness warn for it (only warn for modules with a concrete sub-path), or require the index to have >1 module before the check is meaningful, or exclude `.ai/**` from `codeHere`.

## 4. `GET /api/report/skill` writes history on every request (side-effecting GET)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption / data-quality
- **File**: src/app/api/report/skill/route.ts:46
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Each GET calls `recordSkillGeneration(...)`, inserting a `skillGeneration` row. A GET is meant to be safe/idempotent; a browser re-download, a refresh, a link prefetch, or a bot/CDN revalidation each create a new identical row (same repo/sha/trackIds within seconds).
- **Root cause**: A mutation (history insert) is hung off a read endpoint, with no dedup against the most-recent row.
- **Impact**: The STD-6 "how your onboarding focus shifted over time" history (consumed via `diffTrackSets`) fills with duplicate no-change entries, making the diff/timeline misleading. Unbounded row growth from automated fetchers.
- **Fix sketch**: Skip the insert when the latest row for `(repoFullName, headSha)` has identical `trackIds`, or move recording to an explicit POST/action rather than the download GET.

## 5. Every generated SKILL.md footer links "Ascent" to a bare `https://github.com/` placeholder
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency / broken-link
- **File**: src/lib/onboarding/skill.ts:287
- **Value**: impact 3 · effort 1 · risk 1
- **Scenario**: The footer renders `_Generated by [Ascent](https://github.com/) — your AI-native maturity companion …_`. The link target is the GitHub homepage, not the Ascent product or repo — a placeholder that ships verbatim in every downloaded SKILL.md the user reads in their own repo.
- **Root cause**: Unfilled placeholder URL; the rest of the app has a canonical site URL (`src/lib/site.ts`) but it isn't used here.
- **Impact**: Confusing, unprofessional attribution in a customer-facing artifact; the one back-link to the product is dead.
- **Fix sketch**: Use the canonical product URL (import from `@/lib/site`) so the attribution points at Ascent, not github.com.
