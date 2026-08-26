# Scoring validity — doubts to settle before release

_2026-08-26. A deliberately adversarial read of the scoring model, written while wiring an
autonomous drive-to-green loop. Companion to [`REFERENCE-SCAN-AUDIT.md`](REFERENCE-SCAN-AUDIT.md),
which validated the scores against 121 real scans and fixed what it found. This asks a different
question: **not "are the scores right on honest repos" but "what happens when something optimizes
against them".**_

The distinction matters now because it stopped being hypothetical. Ascent is about to point a coding
agent at its own backlog and run it until the numbers go green.

---

## 0. Why an autonomous loop changes the question

Every scoring model is a proxy. That is tolerable while the people being measured are trying to
improve the underlying thing and using the score to check progress. It stops being tolerable the
moment an optimizer is pointed at the number, because an optimizer does not share the intent behind
the proxy — it finds the cheapest path to the number, and the cheapest path is almost never the work.

So the questions below are not "is the rubric good". By the evidence of the reference audit it is
unusually good. They are: **which parts of it can be satisfied without doing the work, and what
stops that happening.**

---

## 1. The finding: the model can detect fraud and is forbidden from acting on it

### The arithmetic

`src/lib/scoring/engine.ts:206-212`:

```ts
const band    = widenedDims.has(s.id) ? LLM_GUARDBAND * 2 : LLM_GUARDBAND;  // 6, or 12
const guarded = clamp(Math.max(sig - band, Math.min(sig + band, llmScore)));
const score   = s.deterministic ? sig : Math.round(effectiveBlend * guarded + (1 - effectiveBlend) * sig);
```

With `SCORE_BLEND = 0.6` and `coverage = 1`, substitute the extremes of `guarded`:

| | LLM's maximum effect on the final score |
| --- | --- |
| ordinary dimension | **±3.6 pts** (0.6 × 6) → ±4 after rounding |
| dimension the LLM flagged as a detector discrepancy | **±7.2 pts** (0.6 × 12) |
| D9 (`deterministic`) | **0** — the signal *is* the score |
| …and at most **2** dimensions per scan may be flagged at all (`MAX_FLAGGED_DIMENSIONS = 2`) |

So the headline "hybrid: 0.6·LLM + 0.4·signal" describes the *weights* accurately and the
*authority* misleadingly. **In effect the deterministic detector is the score, ±4.**

### Why this is not the same finding the reference audit made

The audit already named this as "the single highest-leverage structural issue" — at
`LLM_GUARDBAND = 25`, where the LLM could move a dimension ±15. The band was then tightened to
**6**, for a good and well-argued reason (`model.ts:88-117`): at ±25, model influence alone could
carry a repo across a level boundary, and the level is what reaches badges, gates and briefings.

That reasoning is sound and empirically grounded — the control-arm study found the model used at
most 24% of the old band, about 6 points. But note what follows:

> **The audit's highest-leverage structural issue was not resolved. It was made roughly four times
> stronger, deliberately, in exchange for level stability.**

That is a defensible trade. What has not been priced is its cost under an optimizer.

### The gap in the calibration

The ±6 band is calibrated to *the model's measured appetite on honestly-scored repos* — how far it
wants to move when the detector is roughly right. That is the wrong distribution for the adversarial
case. Faced with an empty `.coderabbit.yaml` in a repo with no reviews and no installed app, a
competent model should want to move D4 by **thirty-five** points. It is permitted four.

The comment anticipates the honest version of this ("the remedy for a detector the model keeps
out-arguing is to fix the detector") and that remedy is right. It assumes a human closing the loop
on a slow feedback cycle. An agent optimizing overnight does not wait for that cycle.

---

## 2. The concrete exploit, priced

`d4` (`src/lib/analyze/index.ts:437-480`) is a sum of regex hits over file paths and workflow text:

| Points | Awarded for | Actually verified? |
| --- | --- | --- |
| 35 | `.coderabbit.yaml` \| `sweep.yaml` \| `.qodo.yaml` \| `.ellipsis.yaml` **exists** — or a product name appears in workflow text | ❌ file may be **empty**; app need not be installed |
| 25 | `/…\|claude\|openai\b\|anthropics\//` matches **workflow text** | ❌ a comment or a job *name* containing "claude" qualifies |
| 15 | `/autofix\|pre-commit\.ci\|lint.*--fix/` in workflow text **or any path** | ❌ a path containing "autofix" qualifies |
| 15 | `automerge` appears in dependabot/renovate content **or any path/workflow text** | ❌ substring match |
| 15 | `/issue.*comment\|workflow_dispatch.*agent\|peter-evans\/create-pull-request/` | partial |
| 10 | `.github/dependabot.yml` \| `renovate.json` exists | ❌ presence only |

**kp's D4 is 28 and needs 85.** Three files close that gap without changing any behaviour:

```
.coderabbit.yaml          (empty)                          +35
.github/dependabot.yml    (containing the word automerge)  +25
                                                      = 88 → green
```

No reviewer installed. No LLM in CI. No auto-merge. An LLM reading the repo would see this
immediately — and could subtract at most 7 points, only if D4 is one of the two dimensions it is
permitted to flag that scan.

This is not a hypothetical exploit an attacker must discover. It is the *shortest path* to the
target, and the loop is being told to find shortest paths.

---

## 3. Second-order doubts

**3a. The stated rubric is stricter than the implemented one.** The criteria text repeatedly demands
enforcement — D6: *"guardrails enforced via CI, not merely present"*; D9: *"these run automatically
in CI and gate merges/releases, not just sit in the repo"*. Several detectors still score presence.
Where those two disagree, the number follows the detector and the prose follows the intent, so the
report reads stricter than it scores.

**3b. The weights have never been validated.** `maturity-model.md` §5 lists the labelled benchmark
(~30 repos hand-rated, tune to ≥80% agreement) as post-MVP — i.e. **not done**. D1 = 0.15,
D4 = 0.12, D6 = 0.07 are considered judgements with no external referent. This is disclosed, not
hidden, but it means **74 is not a measurement of anything outside Ascent's own opinion**, and the
loop's "300 points of debt" inherits that.

**3c. D1 is near-binary on file presence** — the audit measured mean D1 = 64 with a guidance file
and **2** without. A team with excellent conventions in a wiki scores ~2. The inverse is this
document's concern: a `CLAUDE.md` stub moves it enormously.

**3d. A local scan is measured on a degraded signal set.** `LocalFsSource` omits GitHub-side signals
— PR stats, branch governance, security posture — and says so in `scopeCaveat`
(`api/org/local/rescan/route.ts:62`). D3, D7 and D9 all read those. **A drive-to-green loop running
locally is therefore optimizing a different, blinder function than the cloud scan a customer sees**,
and some dimensions may be unreachable locally for reasons that have nothing to do with the repo.

**3e. `scoreIntegrity` is computed and then thrown away.** The guardband's own rationale rests on a
feedback loop — *"a clamp that binds is information (it shows up in `scoreIntegrity`), and the remedy
for a detector the model keeps out-arguing is to fix the detector"* (`model.ts:108-111`). But
`scoreIntegrity` is returned on the report and **never persisted**: no column on `Scan`, no write in
`scans-persist.ts`. So the question that remedy depends on — *how often does the clamp bind, and on
which detectors?* — cannot be answered from the database at all. The evidence exists for the length
of one HTTP response.

`ScanDimension` does persist `signalScore` and `llmScore`, so *whether a clamp bound* is
recoverable per dimension (that is what `isContested` in `green.ts` does). What is not recoverable
is **`widenedDims`** — which dimensions had their band doubled — so a reconstruction must assume the
base band and will over-report contest on a widened dimension. For a loop that treats contested as
not-green, that error is in the safe direction: it keeps working on a dimension it could have called
done, and never lets a gamed one through. It is still a reconstruction, and persisting
`scoreIntegrity` would make it a reading.

**3f. Dirty-tree scans have no commit identity.** kp scanned `dirty: true` → sha-less. The loop's
before/after comparison rests on scans that cannot be pinned to a commit, so "the agent improved
D4 by 12" is not reproducible from the record.

---

## 4. What to do about it

Ordered by leverage, and none of them require loosening the guardband — `docs/BACKLOG.md` G5
forbids that answer, correctly.

1. **Make the clamp binding a first-class signal, not a footnote.** It is already recorded in
   `scoreIntegrity`. Surface it: *"the model disagreed with this detector by more than the band
   allows"* is the single highest-value sentence in the product, and it is currently invisible.
   For the loop: **a dimension whose clamp bound during a drive-to-green cycle should be treated as
   not-green regardless of its number.**
   **Implemented 2026-08-26** as `isContested` in `src/lib/maturity/green.ts`, reconstructed from the
   persisted `signalScore`/`llmScore` pair. Verified against the exploit in §2: adding an empty
   `.coderabbit.yaml` moves kp's D4 signal 25 → 60 while the model still reads 30, so the score rises
   to 56 and the dimension is flagged contested — it cannot reach green by that route. Today's honest
   scan (signal 25, model 30) is uncontested, so the guard is not simply firing on everything.
2. **Add content checks to the cheapest-to-fake, highest-value detectors.** A `.coderabbit.yaml`
   scoring 35 should at minimum be non-empty and parse. The workflow-text matches should require a
   `uses:`/`run:` context rather than a bare substring anywhere in the YAML.
   **Done for D4 in rubric r9 (2026-08-26)** — and superseded by something better than content
   checks: D4 is now scored from **verified citations** (`src/lib/scoring/claims.ts`). The practice
   is decomposed into facets any tool can satisfy; the model adds a facet only by citing a sampled
   file and a verbatim quote the engine verifies; its D4 score field no longer moves the number and
   D4 has no guardband. This resolves §1's dilemma rather than picking a side: the model's judgment
   moves the score again, through evidence it can point at instead of through appetite. Verified
   against §2's exploit — a config-only repo tops out at 35 and cannot reach the band without teeth
   and a trail, while a bespoke, versioned, gated review reaches 100 with no vendor anywhere
   (`engine.claims.test.ts`).
3. **Separate "configured" from "observed".** D4's own behavioural fallback already does this well
   (`hasDependencyBotCommits` scores 8 vs 10 for a committed config). Generalise it: a bot that has
   *actually left commits or reviews* is worth more than a config that claims one, not less.
4. **Do the benchmark set.** Until §5 of the maturity doc is done, every number is internally
   consistent and externally unanchored.
5. **For the loop specifically: forbid the agent from editing detector-bait.** The drive-to-green
   brief must exclude "add a config file for a tool we do not use" as a legal move, and the verifier
   should reject a cycle whose entire diff is detector surface.

---

## 5. What this document does not claim

The rubric is not sloppy. The reference audit found 213 discrepancies and fixed the structural
causes; the guardband decision is argued from a measured control arm; the detectors carry careful
comments about false positives they already fixed (`golang/go` credited a phantom reviewer). D9 is
fully deterministic *on purpose*, because a security posture inferred by a language model is worse
than one measured.

The claim is narrower and, I think, harder to dismiss: **the model is calibrated for an observer and
is about to be handed an optimizer.** Those need different guarantees, and the gap between them is
currently ±4 points wide.
