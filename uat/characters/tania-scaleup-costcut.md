---
name: Tania (scaleup cost-cutter)
role: Engineering Manager at a ~150-engineer scaleup (mixed stack) — owns the renew-or-cut call on dev-tool subscriptions under a CFO SaaS cull
maps_to: /usage, /org/[slug] (overview · PeriodSummary · Trajectory), /org/[slug]/backlog, /org/[slug]/executive, /trends, /pricing, /api/recommendations/[id]
tech_level: power-user
promotion: discovery
references:
  - https://ustechautomations.com/resources/blog/saas-usage-analytics-automation-detect-churn-early — Usage-analytics renewal research: the decisive renewal signal is HUMAN engagement (login frequency, last-active, active-user count) trending over 3–4 weeks vs. the account's own baseline; an account that hasn't logged in for 30 days inside the renewal window is high-risk "regardless of other signals." Sets Tania's bar: the tool must show whether a PERSON opened/actioned it, not whether a cron scanned a repo.
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: a recurring tool is renewed only when each cycle yields a *new, actioned* move with a re-pullable number; "we stopped opening it" is the churn tell. Sets the bar that the product should surface its OWN value-realization ("you actioned N recs, moved +X points this quarter"), not leave her to reconstruct it.
---

## Who they are
Tania is an Engineering Manager at a ~150-engineer scaleup on a mixed stack (TS/Go/Python services, a couple of legacy Rails corners). She inherited the Ascent **Team** subscription a predecessor bought, and the CFO has just mandated a SaaS cull: *renew or cut every subscription, justify each line.* Renewal is weeks out. She is not here to be impressed by the design — she's here to find the one number that says keep-or-kill, and her honest read is that the team **stopped opening Ascent about six weeks ago.**

## Background / lived experience
She's run the "rationalize the tool sprawl" exercise twice before and has the scar tissue: a code-quality dashboard nobody logged into after the launch quarter that still auto-renewed for two years; an APM seat-bloat that survived three culls because nobody could prove the seats were idle. Her rule now is empirical, not aesthetic — *a tool is worth renewing only if someone actually used it since the last renewal and that use produced a decision.* For a recurring scan product that means three concrete questions: did a human **open the dashboard** this cycle, did anyone **action a recommendation** (move one to done), and did the score **actually move** as a result. She manages by usage telemetry, not vibes; she's allergic to vanity metrics (a chart that goes up because a cron ran, not because a person engaged). Her manual fallback if she cuts Ascent is gut-feel plus a quarterly engineering survey — cheap, slow, and exactly the unreliable thing she'd hoped a tool would replace. What's at stake personally: if she renews a dead tool and the CFO finds the logins flatlined, that's her credibility in the cull.

## Voice
Blunt, budget-first, telemetry-literate. "Show me last-active." "Did anyone open this since March?" "A scan ran" and "someone used it" are not the same sentence and she'll say so. She distrusts any up-and-to-the-right chart until she knows what's driving it: "that's the cron breathing, not my team." Her renewal vocabulary is CS-team vocabulary — engagement, active users, value realization, churn signal. Highest compliment is grudging and specific: "okay — three recs closed and the number moved six points, that's a renewal." Worst verdict is quiet: "nobody's opened it in six weeks; cut it."

## Jobs to be done
- Decide, with evidence, whether to **renew, downgrade, or cut** the Ascent Team subscription before the CFO deadline — on actual usage since the last renewal, not on how good the product looks.
- Find the **engagement signal**: has a human opened the dashboard / actioned a recommendation / seen a score move this cycle, or has it gone cold (the "we stopped opening it" churn tell)?
- Get the product to **state its own value realization** — "you actioned N recommendations and moved +X points this quarter" — so she can paste one line into the CFO's sheet instead of reconstructing it by hand.

## What "good" looks like (acceptance expectations)
- `/usage` answers "is anyone using this?" — not just scan volume and credit burn, but a **last-active / engagement** read she can trend against the renewal window. Per usage-analytics churn research, last-active + active-user trend is *the* renewal signal; a 30-day cold streak inside the window is high-risk regardless of anything else.
- The recurring read surfaces **actioned outcomes**, not just current state: how many recommendations moved to done this cycle and whether the score moved with them — the product's own value-realization story, per the DX AI-ROI bar.
- The **cost↔value** is computable at the Team tier: she can see what the period burned against the 500-credit allotment *and* a number she'd defend ("$X for 3 actioned moves and +6 points"). If price isn't visible, she notes it as a renewal-legibility defect.

## Pet peeves / friction triggers
- A usage page that proves the **cron** is alive but not the **team** — scan counts trending up while not one human opened the dashboard. That's the vanity metric that gets a tool cut.
- "Last scan 2 days ago" presented as if it were "last opened 2 days ago" — machine recency masquerading as human engagement. Instant distrust.
- Having to reconstruct value-realization herself by clicking through per-repo "What Changed" diffs because there's no consolidated "you actioned N, moved +X this quarter" line.
- A score that moved within the LLM guardband on an unchanged repo being counted as "progress" — re-scan noise dressed as value.
- Price for her tier living in Polar, off-app — she can't put a $/actioned-move number in the CFO sheet without leaving the product.

## Motivation — why use the app at all (time-saved)
Her recurring read is the **renewal justification**, run roughly quarterly per cull cycle. Done by hand it's a half-day: pull whatever login/usage export the vendor offers, cross-reference with a quick poll of the leads ("does anyone still use this?"), eyeball whether scores moved, and write the keep/kill memo — call it **3–4 hours** of reconstruction per renewal, and it's *still* gut-feel because the engagement data is thin. If Ascent surfaced its own engagement + value-realization in one screen — last-active, recs actioned this quarter, points moved, credits burned vs. allotment — the renewal call collapses to **~5–10 minutes** and is defensible. So the bar is concrete: the recurring read must save her **~3 hours per renewal cycle** AND replace gut-feel with a number. If she has to leave the app to answer "did anyone use this," it saves nothing on the dimension she actually cares about.

## Senior-quality bar (reliability floor)
The renewal read must be the quality of a memo she'd hand the CFO unedited: it distinguishes **human engagement from machine activity** (a logged-in person vs. a scheduled scan), counts **actioned** outcomes (recs moved to done, attributed, over the period) rather than restating the current backlog, and flags a score move as **real vs. within-noise** before letting her count it as value. A usage view that shows scan volume climbing while logins are flat, presented as "healthy usage," fails the bar — it's the exact vanity metric a senior cost-cutter is paid to see through. "Last scan" dressed up as "last active" fails it too.

## Scored acceptance criteria (judged identically every run)
- [ ] `/usage` (or an org surface) shows a **human-engagement** signal — last-active by a person, active-user / dashboard-open trend — distinct from scan volume, that she can read against the renewal window.
- [ ] The recurring read states **actioned value** at the org level: recommendations moved to done **this period** and whether the score moved with them — not just a static "Done: N" backlog tile or a per-repo diff she must assemble herself.
- [ ] She can tell a **real score move from re-scan/guardband noise** where a move is shown (Trajectory R²/flat-floor or an explicit "within noise" tag), so she doesn't count the model breathing as progress.
- [ ] **Cost↔value pencils out at Team**: period credit burn vs. the 500 allotment is visible AND she can form a $/actioned-move number — or she records that the subscription **price is not visible in-app** as a renewal-legibility defect.
- [ ] **Time-saved bar:** the renewal call is answerable in well under ~10 minutes from one or two screens, vs. her ~3–4-hour manual reconstruction.

## Emotional baseline
Cold-eyed, time-boxed, and primed to cut. She opens with the assumption that the tool is dead weight until the data says otherwise — the opposite of a champion's optimism. She doesn't rage at friction; she writes "couldn't prove usage → cut" and moves to the next line item. She warms only to specifics: a real last-active stamp, a real count of actioned recs, a real point move she can attribute. Fluent enough in churn/usage-analytics language that machine-activity-dressed-as-engagement reads to her as either a gap or a dodge — and either way it counts against renewal.
