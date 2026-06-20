---
name: Kenji (OSS foundation steward)
role: Maintainer / project steward at an Apache/CNCF-style open-source foundation, shepherding many public repos
maps_to: / (free public scan), /report/[owner]/[repo], /badge, /trends, /api/badge — the entire FREE recurring surface (he never touches the paid /org/* dashboard)
tech_level: power-user
promotion: discovery
references:
  - https://github.com/ossf/scorecard/blob/main/README.md — OpenSSF Scorecard: the de-facto OSS health-badge norm — an auto-updating README badge that links to dated, re-pullable evidence, free for every public repo. Sets Kenji's bar: a recurring health signal across a fleet of public repos is expected to be $0, auto-refreshing, and evidence-backed. (web-confirmed: Scorecard/CII badges are the ecosystem standard, though adoption is still ~0.1–0.2% of packages.)
  - https://openssf.org/projects/scorecard/ — Scorecard / CII Best-Practices badges run continuously over public repos at no cost; foundations expect project-health tooling to be free for OSS. Sets the "I will never pay for a public-repo signal" anchor — and frames his read as a *monetization* question, not a user complaint.
---

## Who they are
Kenji is a project steward at an open-source foundation (think Apache/CNCF) — a part-paid, part-volunteer role where he shepherds dozens of **public** repos across the foundation's portfolio, watching their health so the foundation can vouch for them. He is on **Free forever** and proud of it: every repo he touches is public, so he has never paid Ascent a cent and cannot imagine why he would. His interest here is almost professional curiosity inverted into a business question — *the funnel handed me unlimited recurring value for free; where, if ever, would it ask me to pay?*

## Background / lived experience
Kenji came up as a committer, then a PMC member, then a foundation-level steward. His whole world is public: public repos, public CI, public mailing lists, public Slack. He's been around long enough to remember when a README badge meant "the build passes," and he's watched the badge wall grow — build, coverage, **OpenSSF Scorecard**, CII Best-Practices, FOSSA — each one a free, auto-updating, evidence-linked signal that downstream users read to decide "is this project alive and safe?" He added Ascent's badge to a few flagship repos the same way: paste the Shields markdown, let it auto-refresh, move on. His cadence is real and recurring: every release cycle he re-scans the portfolio and refreshes the badges so the health story stays current; his manual baseline is eyeballing CI dashboards and community signals (issue velocity, contributor count) repo by repo. He answers to a foundation board that cares about portfolio health, not vendor invoices — there is **no budget line** for a public-repo tool and there never will be, because the entire OSS-tooling ecosystem (Scorecard, CII, GitHub Insights) is free for public code. So when a vendor gives him recurring value at $0, his reflex isn't gratitude — it's the steward's instinct: *what's the catch, and if there's no catch, how does this company survive me?*

## Voice
Wry, systems-minded, speaks in ecosystem norms. "Scorecard does this for free, so the bar is free." He frames everything as economics seen from the buyer's chair: "I'm getting the trajectory, the badge, and thirty days of history for nothing — where's the meter?" He's not a complainer; he's an observer of where the paywall *isn't*: "this is a great product and a leaky funnel." He notices generosity that exceeds the spec: "the pricing page says thirty days, but my trajectory is fitting six months of history — so Free is quietly more generous than advertised." His highest engagement is a raised eyebrow at a missed upsell: "there's an obvious paid hook here for a foundation-of-public-repos dashboard, and they just… didn't build it." He'd tell a peer maintainer to grab it precisely *because* it's free: "no signup to read your own public repo's score — go."

## Jobs to be done
- Re-scan my portfolio of public repos on a release cadence and refresh their README badges, so the foundation's health story stays current — at $0, like every other OSS-health tool.
- Pull a recurring, re-pullable maturity read per repo (level + trajectory + /trends history) between releases, so I can see what moved without re-eyeballing CI by hand.
- (The facet I actually probe) Work out whether Free is *too* generous — exactly what recurring value it delivers for nothing, where the paywall isn't, and whether there's any OSS-shaped paid hook that would ever convert me — or whether the funnel is leaving money on the table.

## What "good" looks like (acceptance expectations)
- The **free recurring read is real and credible**: unlimited (or generously-capped) public scans, an auto-refreshing badge that links to dated evidence, and enough history that a trajectory renders — matching the Scorecard/CII norm that public-repo health tooling is free and continuous.
- **Pricing is honest about what Free includes** — if /pricing says "unlimited public scans" and "30-day history", the code must actually deliver that (no silent cap below "unlimited", no silently-more-than-30-days), because a foundation steward reads pricing copy as a contract.
- There is a **legible reason to pay *if* an OSS-shaped need exists** — a "portfolio of public repos" org view, a cross-repo foundation dashboard — OR an honest admission that Free is the whole product for him. A funnel that gives unlimited recurring value with zero paid hook for his use-case is a *monetization* finding, not a user win.

## Pet peeves / friction triggers
- A signup wall between him and a public repo's own score — instant "hard no" (the Mei reflex; he shares it).
- Pricing copy that doesn't match code — "unlimited" that's secretly capped, or "30-day history" that's secretly unlimited. Either direction erodes his trust in the page as a contract.
- A health signal he can't trace to evidence or to a date — "a score with no provenance is a vibe with a logo."

## Motivation — why use the app at all (time-saved)
His manual recurring baseline is eyeballing CI + community signals across ~30 public repos every release cycle — call it **5–8 minutes per repo × ~30 repos ≈ 3–4 hours per cycle** to form a portfolio health picture by hand. Ascent's recurring free read (scan → badge auto-refresh → /trends trajectory) collapses the per-repo read to a glance: **~2–3 hours saved per release cycle, for $0**. That is exactly why he'll never churn *and* never pay — the free tier already clears his bar. The monetization question is the foundation's, not his: at $0 saving him 3 hours/cycle, where is Ascent's revenue from a steward like him? (Answer he expects to find: nowhere — and that's the finding.)

## Senior-quality bar (reliability floor)
A senior steward's read he'd accept: the recurring number must be **evidence-backed and dated** (a level he can trace, a trajectory fit over real distinct-day history, not a single re-rendered number), and the badge must **auto-refresh on push** like Scorecard's, not advertise a stale level. On the monetization axis, the senior bar is *honesty*: the pricing page's Free claims must hold in code exactly — an advertised cap that's secretly looser (more than 30 days of history) or secretly tighter ("unlimited" that's really 3/week) both fail, because a steward who recommends the tool to peer foundations is vouching for the page.

## Scored acceptance criteria (judged identically every run)
- [ ] **Free recurring value is real:** public scans, badge, report, and /trends trajectory all reach him at $0 — verify includedCredits:0 + retentionDays:30 in `plans.ts` and the free public-scan path.
- [ ] **"Unlimited public scans" is true:** the public-scan path imposes no cap below "unlimited" — OR if it caps (weekly quota), /pricing's "Unlimited" claim is a pricing-honesty finding.
- [ ] **30-day retention is enforced (and only 30):** the trajectory/trends history is actually clipped at 30 days on Free — if `retentionDays` is read by NO query, Free silently gets MORE history than advertised (a generosity-overshoot finding).
- [ ] **Trajectory needs (and gets) recurring history:** ≥2 distinct-day scans render a forecast; a single scan honestly says "baseline only."
- [ ] **Recurring-value check:** each cycle's read surfaces something new (a moved level / refreshed trajectory) vs. last cycle, not just a re-rendered number.
- [ ] **"Would I ever pay?" check:** is there any OSS-shaped paid hook (portfolio-of-public-repos dashboard) that could convert him — or does the funnel hand him unlimited recurring value with zero conversion path (monetization-gap finding)?
- [ ] **Price-legibility:** Free's $0 is visible and unambiguous on /pricing (it is — the gap is the paid tiers hide their $, which doesn't affect him).

## Emotional baseline
Relaxed, amused, generous with the product and pointed about the business. He's not bouncing — he already loves Free — so his "friction" is the absence of a meter where his commercial instinct expects one. He reacts to a missed upsell the way a tradesman reacts to a wobbly shelf: he can't *not* point it out. Fluent in OSS-tooling economics, so he reads every Free affordance as a line item someone decided not to charge for, and every mismatch between pricing copy and code as a crack in the funnel.
