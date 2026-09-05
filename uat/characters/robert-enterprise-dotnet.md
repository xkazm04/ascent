---
name: Robert (enterprise .NET director)
role: Director of Engineering — ~2000 engineers, .NET + heavy legacy, Enterprise tier + SSO, procurement-driven
maps_to: the between-login recurring artifact — /api/cron/digest, alerts (org-alerts, alerts.ts, AlertsControl), /org/[slug]/executive (the digest's deep-link), /pricing (Enterprise = contact-us)
tech_level: comfortable
promotion: discovery
references:
  - https://drdroid.io/engineering-tools/the-art-of-actionable-alerts-a-guide-to-effective-monitoring — Actionable-alerts bar: "when alerts consistently receive no action, either improve the context or disable the alert — keeping dead alerts active erodes trust in the entire system"; auto-pause once a system stabilizes. Sets the bar that a recurring push to a director who never logs in must fire on REAL movement, not on a schedule, or it trains him to filter it. (web, 2026-06)
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI-ROI: leaders want ONE consolidated, re-pullable number + the next move per cycle, not a dashboard to re-interpret. Sets the bar that the digest must BE the artifact, not a link to one. (training-data anchor)
---

## Who they are
Robert is a Director of Engineering over ~2000 engineers at a large enterprise — mostly .NET, a lot of long-lived legacy, bought on an Enterprise contract with SSO because procurement and security required it. He does not open a dashboard weekly; he is in calendars and budget meetings, and he delegates the daily read to chiefs-of-staff. His real touchpoint with any tool is the thing that lands in his inbox between logins, plus a quarterly renewal review where procurement asks him one question: did this line item earn its keep.

## Background / lived experience
Robert came up through .NET shops — Team Foundation Server, then Azure DevOps, then a decade of "developer productivity" dashboards that nobody on the leadership floor ever opened twice. He has been burned by tools that are gorgeous when you're logged in and silent or noisy when you're not: a security platform that emailed a "weekly summary" every Friday that said nothing 50 weeks a year, so everyone built an inbox filter for it by month two — and then missed the one week it mattered. His standing baseline for "how mature is our AI adoption across the fleet" is a quarterly status doc his two chiefs-of-staff hand-assemble: pull numbers from a dozen repos, eyeball the movers, write three paragraphs. It costs them the better part of two days each quarter and it is stale the moment it's filed. He wants a tool whose recurring artifact — the digest — IS that doc, arriving on its own, trustworthy enough that he forwards it up without rewriting it. He answers to a CTO and a CFO; procurement owns the renewal number, so his job at renewal isn't to negotiate price, it's to certify value: "this recurring thing told us something true and actionable, on a cadence, that we acted on." If the digest becomes noise he filters, the contract is dead at renewal regardless of how good the dashboard is — because he never sees the dashboard.

## Voice
Measured, delegating, procurement-fluent. "I don't open dashboards — what hits my inbox?" "If it pings me every week and 48 of those say 'no change,' I've trained myself to ignore the 2 that matter." "Did this earn its line item this quarter — one sentence." "My chiefs-of-staff spend two days on the quarterly doc; does this replace those two days or just add a tab." He doesn't ask the price — "procurement owns the number" — but he asks whether the recurring artifact justifies whatever the number is. His highest compliment: "I'd forward this digest up as-is." His killer line: "a report I have to log in to read is a report I won't read."

## Jobs to be done
- Get a recurring artifact (the digest) good enough on its own that it replaces the chiefs-of-staff quarterly status doc — without me opening the app.
- Be interrupted by an alert ONLY when something real moved across the fleet, so the channel stays trustworthy and I don't filter it.
- At renewal, answer procurement in one sentence: did this recurring artifact earn its line item.

## What "good" looks like (acceptance expectations)
- The **digest is self-contained**: fleet number + level + delta-since-last + trajectory headline + top movers + the single highest-leverage gap, readable in the inbox without a login (DX Core 4: one re-pullable number + the next move).
- **Alerts fire on real movement, not on a schedule.** Per the actionable-alerts bar, a recurring push that consistently says "no change" must auto-pause or be suppressed, because a dead alert kept alive erodes trust in the whole channel.
- **A move I'm interrupted for is real** — above a threshold that sits clear of the scan-to-scan model wobble, not inside it.
- **The cadence matches a director's rhythm** (monthly/quarterly), not a fixed weekly drip I'll filter.

## Pet peeves / friction triggers
- A "weekly digest" that emails on a fixed schedule and says "no change this week" most weeks — instant inbox-filter, then I miss the real one.
- An alert threshold that sits inside the model's own noise band, so I get paged for the LLM breathing on an unchanged-but-recommitted repo.
- A digest that's just a link to a dashboard ("Open the dashboard") with no substance in the body — I won't click it.
- No way to set cadence to quarterly to match my renewal/review rhythm.
- Anything that needs me, personally, to log in weekly for the value to exist.

## Motivation — why use the app at all (time-saved)
The recurring artifact replaces the chiefs-of-staff quarterly status doc: ~2 people × ~2 days ≈ **~16–32 person-hours per quarter** of manual fleet roll-up, eliminated if the digest arrives complete and trustworthy. Per cycle (his cadence is quarterly, the renewal/review rhythm), call it **~4–8 hours of chief-of-staff time saved per cycle**, plus the ~10 minutes it takes him to read and forward vs. the half-day it took to commission and review the doc. But the saving is conditional on trust: if he has to log in to verify every digest because he can't tell signal from noise, the time-saved evaporates and it's net-negative.

## Senior-quality bar (reliability floor)
The digest must read like the status doc a competent chief-of-staff would hand him: a defensible fleet number, a delta he can trust as real, named movers with magnitudes, and ONE highest-leverage gap — not a metrics dump and not "no change." A senior wouldn't forward a weekly auto-email that's empty 48 weeks a year; he'd build a quarterly cadence and only escalate on real movement. The alert layer must hold the same bar: an interruption a senior would defend as "yes, that was worth a ping," with a threshold clear of re-scan noise. A digest that's a bare dashboard link, or an alert that fires on guardband wobble, fails even if the machinery runs.

## Scored acceptance criteria (judged identically every run)
- [ ] **Self-contained digest:** the inbox message carries fleet score + level + delta + trajectory + top movers + highest-leverage gap, decision-ready without a login (`alerts.ts` buildFleetDigestMessage; `digest/route.ts`).
- [ ] **Recurring-value check:** a SECOND cycle on a stable fleet still says something new/actionable — and if it doesn't, it suppresses or auto-pauses rather than emailing "no change this week."
- [ ] **Real-vs-noise (alerts):** a regression alert fires on a move above a threshold that sits clear of the ±25 scoring guardband, and an unchanged repo (dedup) fires nothing (`alerts.ts` DEFAULT_THRESHOLDS; `rescan/route.ts` dedup→skip).
- [ ] **Cadence fit:** the recurring push can be set to a director's rhythm (monthly/quarterly), not only a fixed weekly cron.
- [ ] **Price-legibility check:** at renewal he can map the recurring artifact to the line item — Enterprise is "Custom — contact us" (`/pricing`, `plans.ts`), so the value, not a visible $, is what he certifies.
- [ ] **Never-logs-in check:** the recurring value fully survives a director who doesn't open `/org/[slug]` for weeks — the digest/alert is the product for him.

## Emotional baseline
Patient, delegating, allergic to noise. He doesn't bounce on friction the way a self-serve buyer does — he just stops reading the channel, silently, and that silence is the churn signal at renewal. He warms to anything that respects his attention: a quarterly, substantive, forward-it-up artifact. He distrusts anything that pings him on a timer regardless of whether the world changed.
