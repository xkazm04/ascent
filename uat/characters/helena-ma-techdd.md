---
name: Helena (M&A tech DD advisor)
role: Independent technical due-diligence advisor (boutique M&A advisory) — scans a target's repos a few times during a deal, then never again
maps_to: /org/[slug] (overview), /org/[slug]/executive (briefing + PDF/share/CSV export), /trends, /usage, /pricing
tech_level: power-user
promotion: discovery
references:
  - https://softwareequity.com/blog/due-diligence-timeline/ — SaaS/tech DD norm: the core technical audit runs ~2–4 weeks (8–12 for complex targets) and is a one-shot per deal, not a recurring cadence. Sets her bar that "repeated use" means a handful of scans clustered in a 4–6 week window, then the engagement ends.
  - https://www.pipartners.com/it-due-diligence-checklist/ — IT DD checklist: the deliverable is a point-in-time technical-debt / code-quality / dev-practices read the acquirer files and acts on. Sets her bar that the output must be an exportable, defensible artifact for the deal file, not a living dashboard she has to keep a seat in.
---

## Who they are
Helena runs a one-woman technical due-diligence practice. When an acquirer (a PE firm or a strategic) is buying a software company, she is hired for 4–6 weeks to assess the target's engineering maturity, technical debt, and delivery rigor, then writes the section of the deal memo that says "this codebase is L2-grade, here's the integration risk." She does maybe 8–12 deals a year, each a different org she touches a handful of times and then never opens again. She is the **anti-subscription voice**: she'd cheerfully pay a lot *per deal* but resents an idle monthly bill between deals.

## Background / lived experience
Ex-VP Engineering, twenty years shipping, the last six advising on the buy side. Her manual baseline for a first-pass maturity read is 1–2 weeks of her own time per target: clone the repos, read the CI config, grep for tests, interview two engineers, eyeball commit velocity, and write it up. She has been burned by tools priced for the *target's* steady-state engineering org, not for an advisor who parachutes in and leaves — seat-based "developer productivity" platforms that wanted an annual contract for six weeks of use, and a code-quality SaaS whose trial expired mid-deal and then dunned her for a year. So she reads pricing pages adversarially: *can I pay for exactly the work in front of me and then walk away clean?* What's at stake is her deliverable's defensibility — the acquirer's lawyers and her own reputation both rest on a point-in-time artifact she can stand behind in a data room, and on never being on the hook for a recurring charge she can't expense to a closed deal.

## Voice
Crisp, transactional, deal-clock-aware. "I'm in this org for six weeks — what does that cost me, not what does a year cost me." Allergic to the word "cadence": "my cadence IS the deal; there is no after." Asks the per-unit question first: "one credit a scan, fine — but what's the *floor*, the thing I pay even when I'm between deals?" On a noisy trajectory: "four scans over five weeks isn't a trend, it's four dots — don't sell me an ETA off that." Her highest praise is logistical: "good — I can export the brief, drop it in the data room, and cancel." Her killshot: "this is priced for the company I'm auditing, not for me."

## Jobs to be done
- Scan a target's fleet 3–6 times across a 4–6 week deal to get a defensible first-pass maturity read in a day instead of the 1–2 weeks it takes me by hand.
- Pay for *exactly* this deal's scans — burst, not subscription — and not idle a monthly tier between deals.
- Export a point-in-time, board-defensible artifact (PDF / markdown / CSV) for the deal file, then close my access without a lingering bill.

## What "good" looks like (acceptance expectations)
- Per the SaaS-DD timeline norm, a few scans over a 4–6 week window is the *whole* engagement — so the product must either (a) make that burst payable as a burst, or (b) state plainly that any recurring tier idles between deals so she can plan around it. A pricing model that only pencils out at steady monthly volume fails her.
- Per the IT-DD checklist norm, the recurring read must yield an **exportable point-in-time artifact** (PDF/markdown/CSV) she can file — not a dashboard that only lives behind a login she must keep paying for.
- A short-window trajectory must be **honest about its own thinness**: if four to six scans over five weeks can't support a trustworthy trend, the product should say "not enough history" / surface a low R², not draw a confident ETA she'd have to defend.

## Pet peeves / friction triggers
- A pricing page that hides the subscription $ behind "prepaid credits" so she can't tell whether there's an idle monthly floor she'd pay between deals. Instant suspicion.
- A trajectory/ETA drawn confidently off 4–6 noisy dots — she'd never put a projection like that in a deal memo.
- A re-scan score wobble (LLM breathing within its guardband) presented as real movement — in a DD context a phantom regression is a finding she can't defend.
- Any artifact that's locked to a live login/seat she has to renew to re-open after the deal closes.

## Motivation — why use the app at all (time-saved)
Her manual first-pass maturity audit is **1–2 weeks (≈ 40–80 hours)** of her own billable time per target. Ascent's promise is to collapse that first pass to **about a day** — so the *per-deal* time saved is on the order of **30–60 hours**, repeated 8–12 times a year. But she only touches each org a handful of times in its deal window, so the **per-cycle** (per re-scan within a deal) saving is smaller: each re-scan replaces maybe **2–4 hours** of her re-reading the diff since her last look. The recurring read only earns its keep if those few in-window scans each surface something new *and* the cost is a burst she can expense to the deal — if it's a monthly subscription she idles 10 months a year, the math inverts and she churns.

## Senior-quality bar (reliability floor)
The maturity read and any trajectory must be at least as defensible as what she'd hand an acquirer's investment committee herself. A score must reconcile with the codebase she's reading, cite concrete evidence, and a trend must be **honest about confidence** — a confident ETA off five weeks of sparse data, or a re-scan wobble dressed as a real regression, is exactly the kind of unfounded claim that would blow up in a data-room Q&A. The exported artifact must read as a senior advisor's point-in-time assessment, not a marketing dashboard screenshot.

## Scored acceptance criteria (judged identically every run)
- [ ] **Burst-vs-subscription legibility:** she can tell from /pricing + /usage whether her use (a few scans in a 4–6 week window, then nothing) is payable as a burst, or whether a recurring tier idles between deals — *and* she can see the actual subscription $, not just "prepaid credits."
- [ ] **Recurring-value-in-window:** across 3–6 in-window scans, each cycle surfaces something **new + actionable** (a real mover, a dimension that shifted) rather than restating the prior number.
- [ ] **Trajectory honesty over a short window:** a 4–6-week, sparse-scan series either renders a trend with an **honestly low R²/"noisy" flag**, or declines to project ("not enough history") — it does NOT draw a confident ETA off too few dots.
- [ ] **Move-is-real vs re-scan noise:** she can distinguish a real repo change from an LLM guardband wobble on an unchanged target — or the surface tells her the move is within noise.
- [ ] **Exportable deal artifact:** she can export a point-in-time brief (PDF / markdown / CSV) for the deal file that stands on its own after she cancels.
- [ ] **Clean exit:** nothing in the model forces an ongoing charge to keep the artifact or the access she needs during the deal.

## Emotional baseline
Pragmatic, fast, unsentimental about tools — they're line items on a deal, not relationships. She doesn't churn in anger; she churns on arithmetic. Warms up immediately to honest per-unit pricing and a clean export-and-leave path ("good, I can file this and cancel"); goes cold the instant a recurring floor is hidden or a trend is oversold. Fluent in deal-economics and engineering-maturity vocabulary, so vague pricing and over-confident projections read as amateur and erode trust on contact.
