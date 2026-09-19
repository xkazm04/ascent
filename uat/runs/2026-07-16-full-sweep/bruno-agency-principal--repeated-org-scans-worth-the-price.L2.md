# L2 — Bruno (agency principal) × "Repeated org scans worth the price"

cert_level: L2 (live, `claude-cli`-confirmed) · date: 2026-07-16 · reasoned from `_L2-shared-pricing-evidence.md` (no fresh browser drive — this Character's facet is trust-in-the-resold-artifact + per-client price legibility, both bear directly on the shared run)

## 1. First-person reaction to the live evidence

"Okay, I read through what the live run actually turned up, and it's mixed news — some of it's genuinely good, but there's a new crack that lands right on the thing I said mattered most: whether I can trust a number before I put it in front of a client.

Start with what held up. The R²/noise hedge I liked in my L1 pass — it's real, and the live run just proved it's *more* real than I gave it credit for. They re-scanned the same two repos 21 days apart, same commit, live claude-cli both times — overall score didn't move a point on either repo, and the fleet view on `/org/vercel` correctly rendered that as `→0`, neutral, not styled like a fall or a gain. That's exactly the 'is this a real move or the model breathing' question I need answered before I narrate anything to a client, and it answered clean.

But then there's the org-level Executive Briefing — my board/PDF/LLM-export surface, the one with 'Download PDF' and 'Copy for LLM' sitting right there — and on the identical low-data situation, it shows a *dated, confident-sounding* ETA — '~4 weeks (2026-08-13)' — with **zero** confidence caveat. Not a softened caveat, not a small-print footnote — nothing. The per-repo Trends page for the SAME data says 'trend confidence — low data (n=2)' in plain text. Same underlying number, two different surfaces, one honest and one silent, and the silent one is the exact page my export buttons live on. That's not a hypothetical for me — a brand-new client relationship is *always* going to be low-data for the first couple of cycles, and that's precisely when I'd be tempted to lead with a punchy 'on track to hit L3 by mid-August' line in the deck. If I do that off a briefing that's silently overconfident, and the client asks me six weeks later why the date slipped, I'm the one who told them a number the tool itself knew was shaky and didn't say so. That's worse than my old hand-written deck, where at least *I* knew how much I was guessing.

Second thing: I still can't see what any one client costs me. The live run's `/usage` check confirms what I flagged in L1 — it's a single whole-org number, no segment breakdown anywhere in the data path — and it surfaces a NEW problem on the same page: a big warning banner saying 'next private scan will be refused' that fires just because the org has never bought overflow credits, even when the monthly allowance is sitting there untouched. That's not my exact bug (I'm not confusing my own bill), but it tells me the per-client-cost page hasn't been finished carefully — there's a live, code-confirmed contradiction between two panels on the same screen. If I'm cross-referencing usage by hand anyway to get a per-client number, I don't want to also be second-guessing whether the page is lying to me about being about to get shut off.

The share-link branding leak and the blended digest — nobody drove those live in this run, so I can't say they're fixed or that they got worse. They stand exactly where my L1 left them: open, code-confirmed, unverified live.

**Verdict: renew, but conditional — same call as L1, and if anything the live run gave me one more reason to hold the line.** The PDF is real and I'd bill for it. But 'evidence behind the scores' was one of my two non-negotiables, and the live run just showed me a specific, reproducible case where the board-facing export drops that evidence silently instead of degrading gracefully like its sibling page does. Combine that with the share-link leak I already flagged and the still-missing per-client cost, and I'm not signing an annual deal — I'm renewing month-to-month until I see those three things closed, especially the new one, because a client-facing surface that quietly overclaims is worse than one that's merely incomplete.

**Time saved, honestly assessed today:** the ceiling is still ~28 hrs/month across 8 clients if everything I need is true. Live evidence didn't move that ceiling, but it also didn't let me raise my floor — I'd still budget real review time per client (checking the exec briefing's low-data cases by hand before forwarding, manually computing per-client cost, and remembering never to send the share link). Call it **~10 hrs/month (600 min) actually reclaimed today**, not the full 28 — the gap between those two numbers is exactly the three open items."

## 2. Adversarial verification of L1 findings against the live evidence

| L1 finding | L1 verdict | Live evidence bearing on it | L2 disposition |
|---|---|---|---|
| L1-BRUNO-01 — share-link hardcodes Ascent branding | confirmed (code-check) | Shared L2 run did not drive the share-link surface at all (no `/share/briefing/[token]` hit in the evidence log). | **Not tested live — carried forward unchanged, still open.** No new evidence either way. |
| L1-BRUNO-02 — `/usage` has no per-segment/per-client breakdown | confirmed (code-check) | Live `/usage?org=vercel` (§6) is a single whole-org figure — `Monthly allotment · Free plan`, one `Est. cost`, one token count, one engine-mix line, no client/segment dimension anywhere on the rendered page. Consistent with the code-level claim (this run used a single-org, non-segmented fixture, so it doesn't add a second segment to prove the absence directly, but it does independently confirm the page has no such control surfaced at all). | **CONFIRMED** — live rendering matches the static claim exactly; still open. |
| L1-BRUNO-03 — weekly digest blends all clients into one push | confirmed (code-check) | Shared run did not exercise `/api/cron/digest` live. | **Not tested live — carried forward unchanged, still open.** |
| L1-BRUNO-04 — share-link omits movers/topGainers section | confirmed (code-check) | Not tested live (same reason as BRUNO-01). | **Not tested live — carried forward unchanged, still open.** |
| L1 "Trust check" — R²/noisy hedge + mock-degraded flag + `deltaCrossesEngine` consistently surfaced across page/PDF/share-link | passed (x) | Live evidence **partially undermines this.** The noise-band mechanism for movers/digest is now materially better than L1's static read gave it credit for (§3, resolved-verified vs. the 2026-06-20 baseline). But §4 finds the confidence caveat is **silently dropped, not degraded gracefully,** on the exec-briefing surface specifically when data is low (as opposed to merely noisy) — and that surface feeds both the PDF and the "Copy for LLM" export via the same `briefingMarkdown()` function. L1's blanket "consistently surfaced" claim did not anticipate the low-data-vs-noisy distinction; it is **too generous for the exact export surfaces Bruno relies on.** | **REFINED, not simply confirmed or refuted** — see new finding below. |
| L1 "Recurring-value check" (deferred to L2 as untestable statically) | `[~]` deferred | Live evidence (§2, §3) shows the mechanism working correctly on a genuinely-flat pair: `/trends?repo=vercel/ai` renders an honest "Holding around 80 … no level change projected" with an explicit low-data caveat — exactly the "tell me the truth about a stable client" behavior Bruno needs. This is a real, positive resolution of the deferred item **on the per-repo trends surface**. It does not resolve the org-level exec-briefing case, which is the surface Bruno actually exports (see above). | **Partially confirmed (mechanism is real and well-behaved on `/trends`), partially still open (fails on the exec-briefing export path).** |

## 3. New finding for Bruno's angle (from shared evidence)

**L2-BRUNO-05 — Executive-briefing trajectory ETA is silently overconfident on low-data periods, exactly the surface Bruno exports to clients.**
- Live: `/org/vercel/executive` renders *"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"* with **zero** confidence/low-data qualifier (`grep -c "confidence" org_vercel_executive.html` → 0), while `/trends?repo=vercel/ai` for the identical `lowData: n<3` case renders an explicit `trend confidence — low data (n=2)`.
- Root cause (code-confirmed): `src/lib/org/briefing.ts:242-248`'s `forecastConfidenceNote()` returns `null` on low data instead of the honest string `Trajectory.tsx` uses for the same condition; `executive/page.tsx:159-161`'s guard renders nothing when it's `null`. `briefingMarkdown()` shares the same `forecastConfidence != null` gate, so the exported PDF and "Copy briefing for LLM" text are equally silent.
- **Why this is Bruno's finding specifically:** this is the exact surface + exact export mechanism (PDF, LLM-copy) his "senior-quality bar" requires to carry "evidence behind them" before it reaches a client CTO — and it's most likely to bite in a new client's first couple of cycles, which is structurally always low-data. Severity: major, trust-eroding, on his highest-stakes surface.
- Relationship to L1: this is genuinely new — Bruno's L1 static pass checked that `forecastConfidenceNote` exists and is reused across page/PDF/share-link, and concluded the trust mechanic was "consistently surfaced." It did not catch that the *low-data* branch of that same function silently degrades to nothing rather than to the honest caveat its sibling component uses. The shared live run surfaced this by actually rendering the page and diffing it against the per-repo equivalent — something the L1 code read alone would not have caught without also grepping the rendered HTML.

## 4. Findings

```json
[
  {
    "id": "L2-BRUNO-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Executive-briefing PDF/LLM-export trajectory drops the low-data confidence caveat that the identical per-repo trends page shows",
    "expected": "The client-facing export (PDF / 'Copy briefing for LLM') should carry the same honest 'trend confidence — low data (n=X)' caveat that /trends renders for the identical lowData situation, since it is the surface Bruno actually hands to a client CTO.",
    "got": "src/lib/org/briefing.ts's forecastConfidenceNote() returns null on lowData instead of an honest string; executive/page.tsx:159-161 and briefingMarkdown() both render nothing, so the dated ETA headline ships with zero caveat on PDF/share/LLM-copy paths.",
    "evidence": ["src/lib/org/briefing.ts:242-248", "src/app/org/[slug]/executive/page.tsx:159-161", "live: org_vercel_executive.html grep confidence -> 0 occurrences", "live: trends-ai.html shows 'trend confidence — low data (n=2)' for the same underlying forecast"],
    "code_check": "confirmed-present (live-rendered)",
    "verdict": "confirmed",
    "resolution": "open",
    "new_vs_l1": true
  },
  {
    "id": "L2-BRUNO-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "/usage low-balance banner is factually wrong for a fresh org with untouched allowance — same page Bruno needs for per-client cost legibility",
    "expected": "The usage page Bruno relies on for cost↔value legibility should not contradict itself between panels.",
    "got": "Live /usage?org=vercel renders 'Out of private-scan credits — next scan will be refused' on an org with 0 private scans and its full 5/mo Free allowance untouched, directly contradicted two lines later by 'Comfortably within your allotment.' Root cause: src/app/usage/page.tsx:142 checks creditBalance===0 without checking usage.usageThisMonth against the allowance.",
    "evidence": ["src/app/usage/page.tsx:142", "src/app/usage/usageDashboard.tsx:45-51", "live: usage_org_vercel.html"],
    "code_check": "confirmed-present (live-rendered)",
    "verdict": "confirmed",
    "resolution": "open",
    "new_vs_l1": true
  },
  {
    "id": "L1-BRUNO-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "title": "Shared read-only briefing link is not white-labeled — hardcodes the Ascent logo/name",
    "code_check": "confirmed-absent (L1, not re-driven live in this shared run)",
    "verdict": "carried forward, unconfirmed live",
    "resolution": "open"
  },
  {
    "id": "L1-BRUNO-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "major",
    "title": "No per-client (per-segment) cost breakdown on /usage — only whole-org credit burn",
    "code_check": "confirmed-absent, and independently corroborated by the live rendering of /usage (single blended figure, no segment control)",
    "verdict": "confirmed",
    "resolution": "open"
  },
  {
    "id": "L1-BRUNO-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "missing-feature",
    "severity": "minor",
    "title": "Weekly digest/alert is whole-org, not per-client",
    "code_check": "confirmed-absent (L1, not re-driven live in this shared run)",
    "verdict": "carried forward, unconfirmed live",
    "resolution": "open"
  },
  {
    "id": "L1-BRUNO-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "bruno-agency-principal",
    "cert_level": "L2",
    "type": "quality-gap",
    "severity": "minor",
    "title": "Shared read-only briefing omits the movers/movement section the PDF has",
    "code_check": "present-but-missed (L1, not re-driven live in this shared run)",
    "verdict": "carried forward, unconfirmed live",
    "resolution": "open"
  }
]
```

### What the live evidence protected (strengths reconfirmed)
- Score-move noise legibility (movers/digest surfaces) is materially better than a static read alone would suggest — real, live-confirmed `→0` neutral rendering on a genuinely flat re-scan pair, and the mock→live engine-transition muting works as designed.
- `/trends` per-repo trajectory is honest about low-data — exactly the behavior Bruno needs, just not (yet) mirrored on the surface he actually exports.
- Subscription price legibility (`/pricing`) is genuinely resolved — Bruno can now compute a per-scan-cycle unit price without contacting sales, even though the per-client dimension he specifically needs is still missing.

## Verdict

**L2-conditional (renew, not upgrade)** — the live evidence keeps Bruno's L1-conditional call intact but replaces one of its "trust check passed" assumptions with a specific, reproducible crack on the exact surface (PDF / LLM-copy of the executive briefing) his senior-quality bar cares most about. Two majors are now live-confirmed as open (L1-BRUNO-02 usage segmentation, and the new L2-BRUNO-05 confidence-caveat gap), one new major surfaced adjacent to his price-legibility need (L2-BRUNO-06 usage banner bug), and three L1 items (share-link branding, digest, share-link movers) remain unverified live in this run — genuinely open, not resolved by omission.

## 5. Character voice — closing take

"Same bottom line as last time I looked at this, plus one thing that actually worries me more now than it did before: I found a page that tells the truth about a shaky number ('low data, don't trust this yet') sitting right next to a page — my export page — that takes the exact same shaky number and states it as a date. If I'm the guy who copies that date into a client deck, I'm the one holding the bag when it doesn't happen. Fix the confidence caveat on the briefing export, give me a real per-client cost number, and close out the share-link leak I already flagged, and I'll sign the annual deal. Until then it's month-to-month, and I'm telling my account team: read the exec briefing yourself before you forward it — don't trust the tool to tell you when it doesn't know."
