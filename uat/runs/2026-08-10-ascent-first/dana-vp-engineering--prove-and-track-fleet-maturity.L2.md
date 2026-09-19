# Dana — L2 addendum (live)

> Appended, not replacing, the L1 voice in
> `dana-vp-engineering--prove-and-track-fleet-maturity.md`.

## What L2 was sent to answer, and how it resolved

| L1 finding | `l2_priority` | L2 outcome |
|---|---|---|
| **DANA-L1-001** (recurrence 2) — low-data trajectory renders a bare dated ETA because the partial fix *deleted* the hedge instead of replacing it | Generate the board briefing on a low-data org and read the trajectory line | 🟡 **`uncertain — not reproducible on this host`** |
| **DANA-L1-003** (recurrence 2) — `/usage` low-balance banner false-fires | Drive `/usage` and enumerate every branch | 🔴 **confirmed + widened** |
| **DANA-L1-009** — narrative prompt told to flag thin data, payload no longer carries the thinness | Generate the narrative on a low-data fixture, plus a control arm | 🟡 **`uncertain`** — `BRIEFING_NARRATIVE` and `ANTHROPIC_API_KEY` both absent; surface is doubly gated off |
| prior-run #1 — caveats don't reach the board export | Re-certify | 🟢 **`resolved-verified`** (engine-mix half) with a recorded ceiling |

### The honest negative: DANA-L1-001 could not be earned
L2 generated **six** board PDFs — `org=vercel` and `org=acme` × `range=30d|90d|180d`, all HTTP 200 —
and extracted the text of each. **Not one contains a `Trajectory:` line.** `briefing.ts:283` sets
`forecastHeadline` to `null` whenever `rollup.forecast` is null, and it is null for both seeded orgs
at every period. The low-data-**with**-forecast branch is structurally unreachable on the available
fixtures.

Per the v1.2 rule this resolves **`uncertain — not reproducible on this host`** — never `refuted`.
The L1 finding stands as `confirmed` at L1 on executed code; what is missing is live confirmation,
and saying so is the point. **A future run needs a fixture with ≥3 scans of one repo across a
window** so the OLS fit produces a forecast that still flags `lowData`. That is now a concrete
`env.md` gap, not a vague one.

> **Method note against my own orchestration:** the run brief handed this walker a "recurrence lead"
> asserting `briefing.ts:393` renders the headline *unconditionally*. That was the orchestrator's
> misreading — line 391 guards it with `if (b.forecastHeadline)`, and the PDF renderer carries the
> confidence hedge deliberately (`briefing-document.tsx:122-126`). The lead was retracted mid-run.
> The walker then found the **real** defect, which is sharper than either version: on `lowData` the
> fix nulls `forecastConfidence`, so the hedge is *omitted* rather than replaced — a bare dated ETA
> with no caveat at all.

### The confirmed one: `/usage`, second cycle running
Driving `/usage?org=vercel` captured both sentences on **one page**:

- `usage.text.txt:16` — *"Out of private-scan credits — the next private scan will be refused (402) until you top up."*
- `usage.text.txt:117` — *"Comfortably within your 5/mo Free allotment."*

Executing the gate (`src/app/usage/page.tsx:142`) across every branch exposed something the code
read alone did not — **the condition is non-monotonic**:

| creditBalance | billable | banner |
|---|---|---|
| `null` | 0 | none |
| **0** | **0** | **"will be REFUSED (402)"** |
| 0 | 5 | "will be REFUSED (402)" |
| 3 | 5 | "Low balance: 3 credits left…" |
| 10 | 5 | none |
| **1** | **0** | **none** |

A brand-new org that has never run a private scan is told it is cut off; **topping up by a single
credit silences the alarm without changing anything real.** The contradicting allowance copy comes
from a different component entirely (`AllotmentPanel.tsx`), which is why the two never reconcile.

### New at L2 — the reconciliation sweep (L2-NEW-03)
The live board PDF for `org=vercel` states, on one page: *"Across 6 of 6 repositories scanned"* ·
*"Coverage: 6/6"* · *"Of 2 repositories comparable across the period"* · *"PERCENTILE — vs 1 repos"* ·
*"shared by 3 repositories"*. Each is correct in its own scope. Together, on a board slide, they are
four denominators and no explanation — and the percentile is a benchmark against a corpus of one,
rendered with an em dash where the number should be.

## Dana's voice — L2

> I'll start with the part that actually moved me, because I was ready to be annoyed. The briefing
> PDF now says, in the body, "Scored by Claude CLI ×5, Mock (deterministic) ×4 — some scores this
> period used the deterministic mock engine, not the live model." Last time that caveat existed
> somewhere in the app and never made it to the thing I'd forward. Now it's in the artifact. That's
> the fix I asked for, and it landed. I want to say that first because I'm about to be difficult.
>
> The difficult part is that I asked for a number I could defend, and the PDF gives me four. Six of
> six repositories. Two comparable. Shared by three. And a percentile "vs 1 repos" with a dash
> where the percentile should be. Every one of those is probably right in its own little scope. I
> don't get little scopes in a board meeting. I get one slide and a CFO who reads the smallest
> number on it out loud. "Versus one repo" is not a benchmark, it's an apology, and it's sitting in
> a headline slot on a page with my org's name at the top.
>
> Then the usage page told me I'm out of credits and the next scan will be refused, and eight lines
> down told me I'm comfortably within my allowance. Same page. And this is the second run in a row
> I've reported it — which, after two runs, starts to read as a decision rather than a backlog. I
> can live with a bug. What I can't do is show a colleague a dashboard that contradicts itself in
> one screen, because the next question isn't about credits, it's "what else on here is wrong?"
> That's the cost. Not the banner. The doubt it seeds about the six panels around it.
>
> Would I put the headline on a board slide? The maturity number, yes — 72, L4, down 6, adoption 57
> against rigor 79. That separation is genuinely the thing I can't buy anywhere else and the reason
> I'd keep paying. The one recommended move is real and it's ranked, not a backlog dump. That's a
> four-to-eight week exercise I got in two tabs, and I don't want to lose that in the complaining.
>
> But I'd retype the slide myself rather than export the PDF, and that is the whole finding. The
> export exists so I don't have to be the last line of defence, and today I still am.

**L2 verdict:** `L2-conditional`. Time-saved holds strongly on the read (weeks → minutes); it
leaks on the *forward*, where she still hand-checks the artifact meant to remove that work.
