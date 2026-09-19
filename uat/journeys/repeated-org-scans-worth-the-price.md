---
character: (shared — run across the pricing-20 roster)
goal: "I've been running the org scan on a cadence for a while now. Is the *recurring* output still telling me something new and trustworthy enough that I'd keep paying for it — at my company's size and budget?"
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org with scan HISTORY across ≥2 dates (so trajectory/movers/trends exist); npm run db:local:seed + a re-scan, or scripts/seed-org.mjs with repeated runs; see uat/env.md. L2 engine = LLM_PROVIDER=claude-cli (real Claude output, not the mock floor).
references:
  - https://www.gartner.com/en/documents/ — SaaS renewal / "value realization" norm: a recurring tool is renewed only when each cycle surfaces a *new, actioned* decision; "we stopped opening it" is the churn signal. (training-data anchor; per-character refs sharpen this.)
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: leaders want one consolidated, *re-pullable* number + the next move per cycle, not a dashboard to re-interpret each time.
---

## Trigger (why now)
This is **not** the first-look journey. The Character has already adopted Ascent's org dashboard and has been scanning their fleet on a cadence (weekly / monthly / quarterly, per their situation). A budget moment has arrived — a renewal, a credit top-up, a CFO line-item review, a "do we expand seats" question, or simply "is this still earning its keep?" They open the dashboard the way they have N times before and ask, cold-eyed, whether the **repetition** is paying off.

## Definition of done (their POV)
- After looking at the **recurring** surfaces — fleet number + **trajectory/ETA**, **movers since last period**, **/trends** history, the **digest/alert** they'd get between logins — they can say whether *this cycle* surfaced **something new and actionable** they didn't already know, or just re-rendered last cycle's number.
- They can judge whether the **movement is real signal vs. re-scan noise** — i.e. whether a score change reflects the repo actually changing, or the LLM wobbling within its guardband on an unchanged repo. (If they can't tell, that's a trust finding that kills repeat value.)
- They can map the **recurring value to the recurring cost** at *their* tier: credits burned per scan-cycle vs. the included allotment (Free 0 / Pro 100 / Team 500 / Enterprise ∞), the **retention window** their tier buys (30 / 180 / 365 / custom days — i.e. how long the trajectory can even look back), and whether the **price is visible enough to decide** (Pro/Team show only "prepaid credits", no subscription $; Enterprise is "contact us").
- They reach a **renew / downgrade / churn / upgrade** verdict for their company size+situation, with a one-line reason — and a number for how much time the recurring read saves vs. their manual cadence.

## Out of scope
- The first-time "what is this / is the single score credible" evaluation (that's the funnel + the existing adopt/prove journeys) — assume they already bought that.
- Transacting (actually buying credits / changing the Polar subscription) — they inspect price/usage to *decide*, not to purchase.
- Per-developer surveillance / individual ranking — fleet & team posture only.

## Discovery hints
Entry point(s): `/org/[slug]` (overview), then wherever the *recurring* value would live — `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing`, and the cadence controls (schedule / alerts / rescan). Do NOT script the steps — getting lost is itself a finding. Watch especially: (a) does the **trajectory/movers** actually say what changed *since last time*, or just restate the current number; (b) can they trust a move as real vs. LLM/guardband noise; (c) is the **per-cycle cost↔value** legible at their tier; (d) is the **price even visible** for the tier they're on; (e) at low velocity (stable/mature/embedded repos) does repetition still surface anything, or does it flatline into "nothing new"?

## Frozen happy path  (filled in only on `promote`)
