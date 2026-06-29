# Code Refactor — First-Run Onboarding Wizard
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

## 1. Recurring-cost disclosure block duplicated across onboarding and connect
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:42,146-157 — and src/components/connect/InstallationRepos.tsx:349-350,380-391
- **Scenario**: Both the onboarding select step and the connect repo list render the *same* watch-cost disclosure: (a) the `underAMonth` derivation `credit != null && !credit.unlimited && monthlyCredits > 0 && credit.balance < monthlyCredits`, and (b) the identical JSX tail — `credit.unlimited ? (<> · unlimited plan</>) : (<> · balance: <span className="font-mono text-slate-300">{credit.balance}</span></>)` followed by `{underAMonth && (<span className="text-warn"> — covers under a month; autoscans pause at zero</span>)}`. The string `" — covers under a month; autoscans pause at zero"` appears verbatim in both files (grep-confirmed only those two).
- **Root cause**: `importCost.ts` was extracted to keep the *number* in sync with the committed schedule, but the surrounding `underAMonth` logic and the balance/unlimited/warning markup were copy-pasted rather than shared. `credit-estimate.ts` shares the arithmetic; the presentation was left behind.
- **Impact**: Two copies of the same cost-disclosure must be edited together. A wording, threshold, or a11y tweak on one surface silently drifts from the other — exactly the "copy and the commitment must never drift" invariant this feature already cares about.
- **Fix sketch**: Extract a small client component (e.g. `src/components/credit/WatchCostTail.tsx`) taking `{ credit, monthlyCredits }` that renders the `· unlimited plan` / `· balance: N` / `underAMonth` warning, and an `isUnderAMonth(credit, monthlyCredits)` helper alongside `estimateMonthlyCredits` in `credit-estimate.ts`. Have both `OnboardingSelectStep` and `InstallationRepos` consume them.

## 2. importScan hand-rolls the SSE read loop that lib/sse.ts already provides
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/onboarding/importScan.ts:80-110 (vs src/lib/sse.ts:32-51 `readSSE`)
- **Scenario**: `runImportScan` already imports `parseSSE` from `@/lib/sse`, but re-implements the surrounding reader drain loop — `res.body.getReader()` + `new TextDecoder()` + a `buffer` accumulator + `while ((nl = buffer.indexOf("\n\n")) >= 0)` framing — which is byte-for-byte the structure of the exported `readSSE` helper in the same module. (A third structurally identical copy lives in `src/components/report/useReportScan.ts:188-196`, out of scope here but reinforces the pattern.)
- **Root cause**: `readSSE(body, onMessage)` exposes no per-chunk hook, and importScan needs to re-arm its stall watchdog (`armStall()`) on every `reader.read()`. So the loop was duplicated to keep the watchdog rather than extending the shared helper. The in-file comment even acknowledges "the outer read loop stays here so the stall watchdog … is preserved."
- **Impact**: Three near-identical SSE drain loops mean framing-edge fixes (e.g. trailing-frame flush on stream end, `\r\n` handling) must be made in several places. The justification is real but the duplication is avoidable.
- **Fix sketch**: Add an optional `onChunk?: () => void` (or `onProgress`) parameter to `readSSE`, invoked right after each successful `reader.read()`. Then `runImportScan` becomes `await readSSE(res.body, handleFrame, armStall)`, deleting its hand-rolled reader/decoder/buffer block and keeping only the frame-dispatch switch.

## 3. "level · overall" score pill and "private" badge re-implemented instead of shared
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/onboarding/OnboardingScanRow.tsx:16-21 and src/components/connect/RepoRow.tsx:45-48 (score pill); src/components/onboarding/OnboardingSelectStep.tsx:104-108 and src/components/connect/RepoRow.tsx:40-43 (private badge)
- **Scenario**: The maturity score pill — `<span className="rounded border … font-mono text-sm {lc.border} {lc.bg} {lc.text}"><span aria-hidden>{LEVEL_GLYPH[level]} </span>{level} · {overall}</span>` — is hand-rolled identically in `OnboardingScanRow` and connect `RepoRow` (only `px-2` vs `px-1.5` differs). The `private` pill (`rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-accent` → "private") is likewise identical in `OnboardingSelectStep` and `RepoRow`.
- **Root cause**: A canonical `LevelBadge` component already exists (`src/components/LevelBadge.tsx`) — but it renders the *level + name* headline pill (`id — name`, rounded-full), not the compact *score* pill (`glyph level · overall`). The score-pill and private-pill variants were never extracted, so each call site re-derives `LEVEL_CLASSES[level]` and re-types the Tailwind recipe.
- **Impact**: The team's own `LevelBadge` comment notes hand-rolled copies "dropped the glyph" and drift; these two variants are the next instance waiting to drift (color cue, glyph, spacing). Extra duplicated markup across onboarding and connect.
- **Fix sketch**: Add sibling components next to `LevelBadge` — a `ScorePill({ level, overall })` and a `PrivateBadge()` — and replace the inline spans in `OnboardingScanRow`, `OnboardingSelectStep`, and `RepoRow`. Normalize the `px-2`/`px-1.5` difference to one value.

## 4. Onboarding subcomponents carry `export` but are only used in their own module
- **Severity**: Low
- **Category**: dead-code
- **File**: src/components/onboarding/OnboardingPickStep.tsx:78,117,144,181 and src/components/onboarding/OnboardingSelectStep.tsx:168,186
- **Scenario**: `InstallationPicker`, `SeededOrgBanner`, `SuggestedOrgs`, `PickForm` (PickStep) and `CapPill`, `SelectSkeleton` (SelectStep) are all declared `export function …`, but a repo-wide grep finds references only inside their own files (the `PickStep` / `SelectStep` parents) — no external imports, no barrel re-export, no test imports.
- **Root cause**: Helpers were exported by reflex; only the top-level `PickStep` / `SelectStep` are consumed across module boundaries.
- **Impact**: Over-broad public surface implies these are reusable/shared when they are not, inviting accidental external coupling and making the real entry points (`PickStep`, `SelectStep`) harder to spot. Minor.
- **Fix sketch**: Drop the `export` keyword on the six in-file-only components (keep `export` on `PickStep`, `SelectStep`, and the shared `ChecklistStep`/`ScanRow`/`Installation` types that *are* imported elsewhere). Confirm with a grep before each removal.

## 5. GitHub-handle normalization (`trim().replace(/^@/,"")`) duplicated
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/onboarding/OnboardingFlow.tsx:167 and src/components/onboarding/OnboardingScanStep.tsx:65
- **Scenario**: Both `loadRepos` (`const handle = (preset ?? org).trim().replace(/^@/, "")`) and the invite flow (`const login = handle.trim().replace(/^@/, "")`) strip a leading `@` and whitespace from a user-entered GitHub handle with the identical expression. Grep finds exactly these two occurrences.
- **Root cause**: No shared "normalize a GitHub handle" helper exists, so the small rule is inlined wherever a handle is read from an input.
- **Impact**: Low — but if the normalization rule ever changes (e.g. lowercasing, trimming a trailing slash, rejecting spaces) it must be found and edited in every inlined copy.
- **Fix sketch**: Add `normalizeGithubHandle(raw: string): string` to a shared util (e.g. `src/lib/github/host.ts` or a small `src/lib/handle.ts`) and call it from both sites. Tiny, but turns the rule into one testable place.
