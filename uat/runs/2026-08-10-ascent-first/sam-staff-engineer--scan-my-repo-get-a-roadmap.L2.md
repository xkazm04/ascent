# Sam — L2 addendum (live)

> Appended, not replacing, the L1 voice in `sam-staff-engineer--scan-my-repo-get-a-roadmap.md`.

## What L2 was sent to answer

| L1 finding | L2 outcome |
|---|---|
| **SAM-L1-04** (recurrence 2) — scan ends on `/report?repo=…`, permalink never surfaced; *data* half believed fixed | 🟢 data half **`resolved-verified`** live · discoverability half **still open** |
| **SAM-L1-02** — `scoreIntegrity` computed, persisted, rendered by nothing | ⚪ code-confirmed; the fields are present in the live payload and absent from the rendered report |
| senior-quality of the live output | 🟢 **clears the bar**, decisively |
| *(new at L2)* does the LLM actually move the score? | 🔴 **L2-NEW-01** — barely |
| *(new at L2)* does the report show things the model never saw? | 🔴 **L2-NEW-02** — yes |

## The carry-forward, verified
A real `claude-cli` scan of `vercel/swr` ran through `POST /api/scan` — **193 seconds**,
`engine.provider: "claude-cli"`, `model: "sonnet"`. Twenty-six minutes later, after a **server
restart**, `/report/vercel/swr` was driven **anonymously** and rendered the whole thing: L3
Augmented, 47, "Scanned 26m ago", `engine: claude-cli · sonnet`, confidence 85%, the passport, and
the Scoring / Dimensions / Roadmap / Sandbox / Contributors sections. The 2026-07-16 vanishing-scan
bug is genuinely dead on the DB path. Its **ceiling** is recorded: DB-off was not driven, and the
permalink is still never handed to the user.

## The two control arms — the run's sharpest instrument
The app persists `signalScore` (detector, no LLM) beside `llmScore` and the blended `score`, so the
"did the AI actually do anything" question is a **measurement, not an inference**:

| | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 |
|---|---|---|---|---|---|---|---|---|---|
| signal | 0 | 100 | 75 | 0 | 45 | 75 | 80 | 21 | 40 |
| llm | 6 | 97 | 77 | 5 | 48 | **75** | 78 | 22 | **40** |
| Δ | +6 | −3 | +2 | +5 | +3 | **0** | −2 | +1 | **0** |

Guardband allows ±25; the model used at most 24% of it. **Net effect of a 193-second Claude call on
the headline: about ±2 points.** Second arm: `TECH_STACK_PROMPT` is unset, so the stack never
enters the prompt — yet "STACK / TypeScript / React" renders in the passport readout beside scores
the model *did* produce.

But the same call produced the roadmap ("0 of 8 Action references pinned to a SHA"; "56% of sampled
merged PRs carry an approving review") and a `discrepancies` block in which **the model overturns
the app's own D9 detector**: the "Signed releases 0/10" result is a false negative, because
`trigger-release.yml` sets `permissions: id-token: write` and installs npm ≥11.5.1 for OIDC trusted
publishing, which does emit Sigstore provenance.

## Sam's voice — L2

> Fine. It's good. I came in expecting to catch it out and it caught *itself* out, which is a
> harder trick.
>
> The thing that got me isn't the score. It's the discrepancies block. It ran its own D9 check,
> got "signed releases: 0 of 10," and then said — in writing, on the page — that its own detector
> is wrong, and gave me the reason: the release workflow sets `id-token: write` and pins npm above
> 11.5.1, so it *is* publishing with provenance, the checker just can't see it. I've never had a
> tool argue with itself in my favour. Every scanner I've used would have shipped the zero and let
> me find out. That single block did more for my trust than the entire score ring.
>
> And the roadmap is specific in the way I demanded and did not expect. Not "improve supply chain."
> "Zero of eight Action references pinned to a SHA." That's a number I can grep and a ticket I can
> write. "56% of merged PRs have an approving review despite a ruleset requiring one" — it noticed
> the gap between the policy and the practice, which is exactly the thing a maturity dashboard
> normally launders. Okay. That's actually right.
>
> Now the part that bothers me, and it's not a bug, it's a story problem.
>
> I waited 193 seconds. I went and looked at what those 193 seconds bought, because the app is
> honest enough to persist both numbers. The detector said D2 was 100, the model said 97. Detector
> said D6 was 75, model said 75 — identical. Across nine dimensions the model moved the needle by
> two points. It's allowed to move it by twenty-five. So the headline number I waited three minutes
> for is, within rounding, the number the free deterministic path would have handed me instantly.
>
> That's not a scandal. The blend is documented, the guardband is documented, and honestly
> guardbanding an LLM against a detector is the *correct* design — I'd have built it that way. But
> the README says the model "calibrates the signal scores," and that is the weakest true thing you
> could say about it. The model doesn't calibrate. The model *explains*, and the explanation is the
> product. You're selling the ring and giving away the reasoning.
>
> The other thing: it shows me "STACK: TypeScript, React" in the readout, and the model never saw
> that. There's a flag, it's off by default, deliberately, for good calibration reasons — I read
> the comment, it's a defensible call. But nothing on the page tells me which facts the model read
> and which ones you bolted on afterward. For a tool whose whole pitch is "here's the evidence
> behind every number," having ambiguous provenance *about your own provenance* is the one own-goal
> you can't afford. Same for the contributors panel. Label it, or don't show it next to the scores.
>
> Would I stake my name on the badge? I would — except there's still no badge on the report. Three
> runs of this and the one artifact my JTBD is built around has no path through the product.
>
> Would I tell a peer? Yes, with a caveat I'd say out loud: "ignore the number, read the
> discrepancies." Which is a strange sentence to have to say about a scoring product.

**L2 verdict:** `L2-conditional`. Senior-quality bar **met on substance** — the reasoning is better
than what most staff engineers would produce in a day. Time-saved holds (~5h20m realized against
his stated "better part of a working day" baseline). Two of his seven criteria still fail, and both
are his named automatic-failure conditions: unsourced evidence labels, and no badge path.
