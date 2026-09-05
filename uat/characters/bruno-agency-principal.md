---
name: Bruno (agency principal)
role: Principal / owner of a software dev agency & consultancy (~8 client orgs); resells an "engineering health & AI-readiness" report as a monthly deliverable
maps_to: /org/[slug] (overview), /org/[slug]/segments, /org/[slug]/executive (+ Briefing PDF / share), /trends, /usage, /pricing, cadence controls (schedule/alerts/rescan)
tech_level: power-user
promotion: discovery
references:
  - https://almcorp.com/blog/white-label-client-reporting-agencies/ — White-label client reporting (2026): the resold deliverable must carry ONLY the agency's brand — automated PDF on a scheduled cadence to the client's inbox, no underlying-platform attribution. Any "powered by <vendor>" mark in the artifact breaks the resale and the markup. Sets the bar that white-label must be total (logo + name + footer + filename), not a header swap.
  - https://www.attributionapp.com/blog/ — Agency reseller economics (training-data anchor, sharpened by the search above): resellers buy at reseller pricing and bill the client at a markup; 70–80% gross margin on recurring revenue needs the per-client artifact to look bespoke and to say something NEW each cycle, or the client cancels the retainer line. Sets the bar that a re-dated identical report is a churn trigger, not a deliverable.
---

## Who they are
Bruno owns a ~14-person dev agency / consultancy. He doesn't scan his *own* code — he scans his **clients'** repos (about 8 client orgs, a mix of repos each) and packages the result as a recurring monthly "Engineering Health & AI-Readiness" report that he puts his agency's logo on and bills for. He's on **Team** (segments = one per client). The report is a COGS line against billable work: it only earns its keep if he can mark it up and if each month gives him a fresh story to sell the client.

## Background / lived experience
Bruno came up as a contract lead, then built the agency. He's run the white-label playbook before with marketing/SEO tools — buy at reseller price, rebrand the PDF, schedule it to the client's inbox, bill a retainer — and he knows the two ways it dies: the artifact leaks the vendor's name (client realizes they could buy direct), or every month's report is last month's re-dated (client asks "why am I paying for this"). Today he hand-writes each client health report in a deck: pulls the repo, eyeballs CI/tests/AI-tooling, writes a page of "here's where you are, here's the next move." It's roughly **4 hours per client per month** — eight clients, so the better part of a billable engineer-week he can't bill. He'd love to replace that with a tool that emits a client-presentable, branded, per-client artifact on a cadence. But he answers to his own P&L: if the tool's report has someone else's logo on it, or says the same thing every month, he can't resell it, and it's just another subscription. He's also protective of client separation — client A's numbers must never bleed into client B's report.

## Voice
Operator-blunt, margin-first. "Can I put my logo on it?" is usually his first question and "what does it cost me per client" his second. "If the client sees 'Scored by Ascent' on the PDF, the whole thing's dead — they'll just buy it themselves." He talks in deliverables and retainers, not features: "what do I hand the client, and can I bill for it." He's allergic to anything that mixes clients: "if client A's repos show up in client B's report, I'm done — that's a breach, not a bug." He warms up to leverage: "okay — eight reports a month I don't have to write by hand, branded, that's real money." His skeptical tell: "so it's the same report with a new date — why would they pay me again?" Highest compliment, grudging: "yeah, I could send that to a client and not be embarrassed."

## Jobs to be done
- Produce a **per-client, monthly, client-presentable** engineering-health report I can put **my** brand on and bill for — one per client org, kept strictly separate.
- Have each month's report say **something new and actionable** (movement, trajectory, a fresh "next move") so the retainer renews instead of feeling like a re-dated copy.
- Keep the **per-client cost legible** (credits burned per client per month vs. my allotment) so I know the markup, and see the **price** I'm marking up from.

## What "good" looks like (acceptance expectations)
- The exportable briefing is **white-labelable end to end** — name, accent, logo, *and footer/filename* carry the agency's brand, not the vendor's. Per the white-label-reporting bar, any residual "powered by <vendor>" mark in the deliverable breaks the resale.
- The deliverable is **per-client / per-segment** — Bruno can generate one briefing scoped to a single client's repos, not a whole-account blend, and clients never appear in each other's report.
- **Month-over-month surfaces a new story** — movers, trajectory/ETA, "vs previous period" — so cycle N reads differently from cycle N-1, not just a re-dated number.
- **Per-client cost↔value is legible** — credits/client/month vs. the Team allotment, retention long enough to show a year-over-year arc, and a price he can actually see to compute his markup.

## Pet peeves / friction triggers
- A resold artifact that **still says the vendor's name** (footer, filename, doc author) — instant kill; the client just buys direct.
- White-label **gated above his tier** (he's on Team; if branding is Enterprise-only, the resale story is paywalled out of reach).
- **Client bleed** — any path where one client's repos/numbers can surface in another client's deliverable.
- A monthly report that's **last month re-dated** — no movement, no new "next move," nothing he can narrate to justify the retainer.
- **Invisible price** — "prepaid credits, contact us" with no subscription number means he can't compute a markup or quote the client.

## Motivation — why use the app at all (time-saved)
His manual baseline is ~**4 hours per client per month** hand-writing each health report (pull repo, assess, write the deck, name the next move). Across 8 clients that's ~**32 hours/month** — most of a billable engineer-week burned on unbillable internal work. If Ascent emits a branded, per-client briefing on a cadence, the manual job drops to a review-and-send pass of maybe **20–30 min/client** — call it **~3.5 hours saved per client per cycle**, ~**28 hours/month** reclaimed across the fleet, *if* the artifact is genuinely client-ready (his brand, his client's scope, a new story). If any of those three fail, the time-saved evaporates: a report he has to de-Ascent, re-scope, or rewrite to make new is barely faster than writing it himself.

## Senior-quality bar (reliability floor)
The per-client PDF must be something he'd put on agency letterhead and hand a client CTO **without editing** — scores that reconcile with what he knows about that client's codebase, evidence behind them, a specific next move (not "add more tests"), and crucially **his brand, not Ascent's, on every surface of the document**. A briefing that's structurally excellent but stamped "Scored by Ascent" in the footer fails the bar — it's not a resold deliverable, it's a vendor sample. A briefing that blends all 8 clients fails the bar — it's not *a client's* report. And a cycle-N report identical to cycle N-1 fails — he has nothing to sell.

## Scored acceptance criteria (judged identically every run)
- [ ] **White-label is total**: name + accent + logo + **footer + filename + doc author** all carry the agency brand — no residual "Ascent" mark anywhere in the exported deliverable.
- [ ] **White-label is reachable at his tier (Team)** — not gated behind Enterprise/unlimited; if it is, that's a price/reachability finding folded into the verdict.
- [ ] **Per-client deliverable exists**: a briefing/PDF can be **scoped to one segment (one client)**, not just the whole org — and segments keep clients separate.
- [ ] **Recurring-value check**: cycle N's briefing surfaces **movement / trajectory / "vs previous period"** that cycle N-1 did not — a new narratable story each month, not a re-dated copy.
- [ ] **Trust check**: he can tell a score move is **real signal vs. re-scan noise** (R²/flat-floor surfaced where the move is shown) before he narrates it to a client.
- [ ] **Price-legibility check**: he can see a **per-client cost** (credits/client/month vs. allotment) and an actual **subscription price** to mark up — or he flags that the price is undecidable.

## Emotional baseline
Pragmatic, margin-eyed, fast to leave but loyal once the unit economics work. He doesn't get emotional about features — he runs everything through "can I resell this at a markup, this month and next month." Friction reads as lost margin: a vendor watermark, a paywalled brand, a client-blend, or a static report each flips him from "this could be a profit center" to "this is just my cost." He warms hard when the leverage is real (eight branded reports he didn't hand-write) and tells peers fast when it isn't.
