# Ascent as a transition companion — vision → feature pass

## The shift in what Ascent *is*

Today Ascent **scores** repos and orgs. The real product is a **companion that helps an
organization transition to AI-native engineering** — by reflecting where it stands, surfacing
gaps as things to *explore* (never as orders), and **capturing the org's own best practices so
they can be reused across teams and codebases without leaking proprietary code.**

Three truths from the vision, and what each demands of the product:

1. **Every scan must yield explorable action points for *structural* codebase changes that
   enable AI-driven development.** Not "you scored 40/100" — but "AI agents can't safely work
   here yet; here's the structural gap, and here's how to explore closing it."
2. **Inputs to contributors, not directives.** We don't tell engineers what to do. We surface
   the *gaps in the level of trust* and give them the inputs to explore them, step by step, at
   their own pace. The maturity ladder is a **trust ladder**: how much the org can trust AI in
   its workflow (which needs both adoption *and* the rigor to ship AI output safely).
3. **Keep & reuse best practices, skills, and artifacts across the company — without leak.**
   The strongest repos already hold the org's institutional AI knowledge (a deep CLAUDE.md, an
   eval harness, a tight PR process). Ascent should **mine those exemplars, templatize their
   *shape* (not their code), and systematically offer them to the teams/repos that lack them.**

## The voice change (cuts across everything)

| From (grading) | To (companion) |
|---|---|
| "Add a CLAUDE.md." | "AI agents have no project guidance here. **Explore:** what would an agent need to know to contribute safely — commands, architecture, the rules it must never break?" |
| "D8 = 31." | "AI is used here, but its output isn't governed yet. **A gap in trust** — explore making AI changes reviewable." |
| "Contributor X: 12% AI." | "X hasn't leaned into AI yet. **Inputs to explore:** the repos they own already have guidance Y could build on." |

Imperative → invitational. Score → gap-to-explore. Judgement → inputs.

---

## Feature pillars

### Pillar 1 — Trust-gap exploration (reframe the recommendation engine)
Recommendations become **exploration cards**, each with: *what's missing · why it matters for
AI-driven dev · questions to explore (not steps to execute) · what "good" looks like here
(pointer to an exemplar)*. Powered by the LLM (mock fallback), shown on the repo report and
rolled up to the org "moves." A **trust-ladder** strip shows the current rung and what the next
rung of trust would need.

- Touches: `scoring/recommendations.ts` (fallback), the LLM prompt, `ReportView` roadmap,
  org Overview "highest-leverage moves" → "gaps the org could explore."

### Pillar 2 — Practice Library (capture & reuse, without leak)  ← most differentiated
The org's own playbook, mined from its best repos. For each **practice** (deep agent guidance,
eval/golden harness, structured PR process, ADRs/runbooks, prompt/agent library, test
discipline):
- **Exemplars** — which repos do it well (the ones to learn from).
- **Gaps** — which repos lack it (where to apply it next).
- **Reusable shape** — the *structure* of the exemplar (e.g., "this CLAUDE.md covers commands,
  architecture, test-after-change, constraints, MCP/hooks") + a **templatized starter**, so the
  practice travels without the proprietary code traveling.
- **Systematic apply** — "propagate to these N repos" ties straight into the leverage engine.

A new **Practice Library** tab on the org dashboard. This is the "keep & reuse across the
company without leak; systematically apply to teams & codebases" capability.

- Touches: `analyze` (we already detect guidance depth, evals, prompt libs, PR templates —
  extend to capture exemplar *shape*), new `getOrgPractices` aggregate, new org tab.

### Pillar 3 — Contributor trust exploration (inputs, not rankings)
Reframe the contributor view from "who's AI-native" (a leaderboard that judges) to **"where each
person could explore growing trust in AI"** — surfacing inputs: which of their repos lack
guidance they could seed, which practices they've already championed (and could spread). Same
data, invitational framing.

- Touches: `Contributors` tab copy + a per-contributor "exploration inputs" hint.

---

## Suggested execution order

1. **Pillar 1** — the voice change is foundational; it makes every section read as a companion
   and is the surface the Practice Library plugs into.
2. **Pillar 2** — the Practice Library: the most differentiated, most B2B-valuable capability,
   and the truest expression of "reuse across the company."
3. **Pillar 3** — contributor reframing (light, builds on the existing tab).

## Delivered (P1–P3 ✅)

- **P1 — Trust-gap exploration.** `LlmRoadmapItem.explore[]` + reframed `recommendations.ts` catalog
  (gap-as-observation titles + invitational questions, no imperatives) + prompt rewrite ("Ascent is a
  companion, not a boss"). Persisted `Recommendation.explore`. Report shows a **Trust ladder** strip
  (L1–L5, current rung, next-rung note) and **exploration cards** ("Explore →" questions) in both the
  roadmap and the trackable recommendations; org Overview reads "Gaps to explore across the fleet."
- **P2 — Practice Library.** `src/lib/practices.ts` catalog (8 practices, leak-free templatized starters)
  + `getOrgPractices` (per practice: exemplar to learn from ≥70, gap repos <40, adoption) + new
  **Practices** tab. Vercel: agent-guidance exemplar = ai-elements (9 gaps), AI-harness = workflow
  (11 gaps), agent-in-loop = greenfield (16 gaps). The reusable *shape* travels; the code doesn't.
- **P3 — Contributor trust exploration.** Contributors tab reframed from leaderboard to *inputs to
  explore* (invitational copy, champions as exemplars-to-learn-from, "these are inputs, never directives").

The org dashboard is now a 5-tab hierarchy: Overview · Repositories · Contributors · Delivery · Practices.

## The e2e pass ✅ (delivered)
Playwright over the **live app + live LLM** — `playwright.org.config.ts` + `e2e/org-suite/`,
run with `npm run test:e2e:org` against the live :3007 server (real Postgres, seeded Vercel org,
`claude-cli` provider). Org-auth is the only shortcut (auth unconfigured → pages open). A
`global-setup` fails fast if the org isn't seeded. **17 tests, all green.** Assertions are
**business-value**, not "renders":
- **overview** — header/tabs, real maturity/adoption/rigor, goal direction, movers, and that the
  highest-leverage items read as *gaps to explore* (observations + "affects N repos"), not orders.
- **repositories** — leaderboard (≥10, links to reports) + heatmap exposing per-dim strengths.
- **contributors** — asserts the *inputs-not-directives* framing + champions-as-exemplars + bus-factor.
- **delivery** — PR discipline, branch-governance guardrail gaps, real commit activity.
- **practices** — exemplar to learn from + gap repos + leak-free reusable shape (the reuse story).
- **scan-intelligence (live LLM)** — a real scan yields 9 dimensions, posture, level, and ≥3
  exploration-framed action points hitting structural AI-enablement dims (D1/D4/D8); the report page
  renders the trust ladder + exploration cards.
