// Emits SUMMARY.md for this run. Written as a script because a heredoc mangled the markdown and
// the Write path refused the filename; code spans are authored as «...» and converted to backticks
// here so the template literal stays escape-free.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const body = `
# UAT — 2026-08-10 · ascent · first run under «/uat» v1.2

3 Characters × 3 journeys. Full L1 (parallel, code-grounded) → L2 (serial, live app on
«localhost:3002», «LLM_PROVIDER=claude-cli») → reconciliation sweep → synthesis.
**37 findings** (26 L1-only, 11 carried to L2), 35 «confirmed», 2 honestly «uncertain».

## Scope correction (recorded, not buried)

The run was commissioned as ascent's **first** UAT outing, with an «init» authoring three fresh
Characters. **That premise was false.** ascent already carries a mature overlay — **30 Characters,
11 journeys, 5 prior runs** (2026-06-19 ×2, 2026-06-20, 2026-07-16 sweep + recertify). What is new
is the **engine**: «/uat» v1.2 was installed here on 2026-08-10 («f6862608») and every prior run
predates it. So this is the **first run under v1.2**. Authoring duplicates into a 30-Character
roster would have been pollution; the run instead **selected three existing Characters** matching
the requested shape (two core internal + one external buyer) and did an «update»-shaped refresh of
the two v1.1/v1.2 obligations the overlay never received — a **shared grounding denominator** and a
**port-identity preflight** (commit «63e85ec7»).

## Scorecard

| Character | Journey | L1 | L2 | Grounding | Time-saved (baseline → realized) |
|---|---|---|---|---|---|
| **Sam** (Staff Engineer) | «scan-my-repo-get-a-roadmap» | «L1-conditional» | «L2-conditional» | **Surface A 10/11 wired · 9/11 effective** | "better part of a working day" → **~5 h 20 m realized** |
| **Dana** (VP Engineering) | «prove-and-track-fleet-maturity» | «L1-conditional» | «L2-conditional» | **Surface B 15/15** (gated OFF — precondition declared) · fleet surfaces **N/A, deterministic** | 4–8-week hand-rolled assessment → **two tabs**, leaks on the forward |
| **Tomáš** (prospective buyer) | «evaluate-whether-to-adopt» | «L1-conditional» | «L2-conditional» | **Surface A 10/11** | ~40 min if it worked → **~0 as production is configured** |

Zero journeys failed structurally. Zero «UNMEASURED (harness)». The denominator was **11, not 12**,
for every Character — «TECH_STACK_PROMPT» is unset, so source #7 never reaches the prompt. **One
ruler, three Characters, no drift** — the v1.1 lesson holding on its first cross-project outing.

## Ranked backlog — v1.2 order: recurrence first, then convergence, then impact

1. **«/usage» says "out of credits, next scan will be refused" beside "comfortably within your
   allotment"** — «DANA-L1-003», **recurrence 2**, confirmed live. L2 widened it twice: executing
   every branch of «page.tsx:142» shows the condition is **non-monotonic** (0 credits + 0 scans →
   harshest alarm; 1 credit + 0 scans → silence), and «scanCredits» is «DEFAULT 0», so **this is
   the default state of every newly created org**, not an edge case reached by unusual usage.
2. **The advertised free, no-signup public scan returns «401»** — «TOMAS-L1-01», blocker. L2 built
   the production-shaped auth arm and got «{"error":"Sign in to run a scan.","code":"auth_required"}».
   Everything **read-only** stays open (report 200, badge 200, gate 422); only *running* a scan is
   walled — the one action that would convince a buyer. «README.md:94-98» says the opposite.
3. **A fleet regression prints under the heading "Value this period"** — «DANA-L1-010».
   «valueRealizedLine» pushes «pointsMoved» sign-blind; the live board PDF reads
   *"Value this period: 1 recommendation completed · fleet **−6 pts**"*.
4. **The board PDF carries four unlabelled repository denominators, two in direct contradiction** —
   «DANA-L1-012» (reconciliation sweep). "6 of 6 scanned" · "Coverage 6/6" · "2 comparable, 0
   improved and 0 regressed" · "vs 1 repos" · "shared by 3". A fleet-wide −6 sits beside a
   cohort-matched "0 moved".
5. **Evidence lines are unsourced labels** — «SAM-L1-01». «Signal.detail» is populated exactly once
   in all of «analyze/index.ts», on the *failure* placeholder. Sam's stated instant-trust-failure.
6. **A 193-second model call moves the score ~±2 points** — «L2-NEW-01». The model used ≤24% of its
   ±25 guardband; D6 and D9 came back byte-identical to the detector. The value is the **prose**,
   not the number the product sells.
7. **«scoreIntegrity» is computed, typed, persisted and rendered by nothing** — «SAM-L1-02»; the
   provenance track draws a fixed ±25 band even where the engine used ±50.
8. **No badge affordance anywhere on the report** — «SAM-L1-03». Sam's third JTBD has no path.
9. **The report shows a tech stack the model never received** — «L2-NEW-02», with nothing marking
   which facts the assessment actually used.
10. **Forecast honesty** — «DANA-L1-001» (**recurrence 2**) and «DANA-L1-002», both
    **«uncertain — not reproducible on this host»** (see below).

## Strengths — do-not-touch guardrails

- **The model overturns the app's own detector, in public.** The live «discrepancies» block argues
  that D9's "Signed releases 0/10" is a false negative, citing «id-token: write» + npm ≥11.5.1 OIDC
  trusted publishing. *Constraint: any future "clean up the report" pass must preserve
  LLM-vs-detector disagreement as a first-class, user-visible artifact.*
- **The roadmap is countable, not generic** — "0 of 8 Action references pinned to a SHA", "56% of
  merged PRs carry an approving review despite a ruleset requiring one". *Constraint: no templating
  pass may flatten these into catalogue items.*
- **Adoption is separated from rigor structurally**, and the drill fleet → team → dimension → cited
  repo evidence exists end to end.
- **The engine-mix caveat now reaches the board PDF verbatim** — the prior run's core complaint,
  closed on this half («EXEC-BRIEFING-0716-1», «fixed», ceiling recorded).
- **The vanishing-scan bug is dead** on the DB path — «resolved-verified» with a ceiling.

## The honest negatives

**Two findings resolved «uncertain — not reproducible on this host», and that is the correct
outcome, not a gap in the run.** «DANA-L1-001»/«-002» need an org whose rollup yields a *non-null*
forecast that still flags «lowData». L2 generated **six** board PDFs («vercel»|«acme» ×
30d|90d|180d, all HTTP 200) and **not one contains a «Trajectory:» line** — «forecastTrajectory»
returns null below 2 distinct calendar days, and «seed-org.mjs» scans an org in a single pass. The
fixtures cannot produce a forecast at all. Per v1.2 this is «uncertain», never «refuted».
**Concrete fixture gap for «env.md»: a seeded org with ≥3 scans of one repo across ≥2 calendar days
(≥14-day span for «DANA-L1-002»).**

«DANA-L1-005»/«-009» (the briefing narrative) are likewise gated off — «BRIEFING_NARRATIVE» and
«ANTHROPIC_API_KEY» are both absent — and were declared as preconditions *before* browser time was
spent, which is exactly what v1.2 added the rule for.

## Panel verdict

**The reasoning is ahead of the reporting.** All three Characters independently reached the same
shape: where Ascent *thinks* — the roadmap, the discrepancies, the adoption/rigor split, the ranked
one move — it clears a senior bar and occasionally exceeds it, and each said so unprompted. Where it
*presents* — the usage banner, the board PDF's denominators, "Value this period" over a regression,
the unsourced evidence labels, the missing badge — it undercuts the very work that earned the trust.
The prior run's panel verdict was "a correct caveat computed somewhere in the app fails to propagate
to the highest-stakes surface." Part of that is now genuinely fixed (engine mix reaches the board).
**The same shape survives elsewhere, and one instance survived a full run→drain→ship cycle unchanged
into a second reporting** — which, as Dana put it, *"after two runs, starts to read as a decision
rather than a backlog."*

Segment read: **it wins the engineer and the VP on substance and loses them on the artifact they
would forward.** It loses the buyer earlier and more cheaply — not on quality, which impressed him,
but on a sign-in wall standing in front of the one proof he trusts, under a page promising no signup.
`;

fs.writeFileSync(path.join(dir, "SUMMARY.md"), body.replace(/«|»/g, "`").trimStart());
console.error("SUMMARY.md written");
