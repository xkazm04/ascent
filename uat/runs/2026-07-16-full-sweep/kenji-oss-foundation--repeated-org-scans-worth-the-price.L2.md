# L2 (live-evidence-adversarial) — Kenji (OSS foundation steward) × "Repeated org scans worth the price"

cert_level: **L2**
date: 2026-07-16
evidence source: `uat/runs/2026-07-16-full-sweep/_L2-shared-pricing-evidence.md` (live claude-cli run, `vercel` org, this session — not re-driven for this character)

---

## 0. Scope note — what the shared evidence can and cannot say about MY facet

My angle isn't "does the org dashboard work" — I never touch it as a user. My angle is the buyer's-chair
question: *is Free's recurring value real, is the pricing copy honest, and is there any OSS-shaped lever
that would ever get money out of a foundation like mine?* The shared evidence run seeded and scanned the
`vercel` **org** (a metered, non-`"public"` dashboard) with `ASCENT_AUTH_BYPASS=1` set for the whole
session. Two consequences for grading my own L1 findings:

- **F1 (the `/trends` sign-in gate) cannot be confirmed OR refuted by this evidence** — auth was bypassed
  for the entire live run, so nobody hit the anonymous-visitor redirect path I flagged. My L1 verdict was
  code-citation-based (`trends/page.tsx:41-52`, `authGateEnabled()`), not a live click-through, and it
  stays exactly that: a confirmed-in-code, not-confirmed-live claim. The shared evidence is silent on it,
  not contradicting it.
- **F2 (the 5/mo public-scan quota) is also untouched** — the seeded scans went through the org-scoped
  `POST /api/org/import` path (metered against org credits), not the anonymous `POST /api/scan` public
  path my quota citations are about. No new confirmation, no refutation.

Everything else in the shared evidence — pricing numbers, the credits-flow table, the Free-tier `/usage`
bug, and the executive-briefing confidence gap — lands squarely inside my "would I ever pay, and can I
trust the numbers on the page that would ask me to" facet, even though I personally never open
`/org/vercel/executive`. Here's what it does to my four scored findings.

---

## 1. F3 (monetization gap — no OSS-foundation framing) → **confirmed, and now priced to the dollar**

Shared evidence §5 pulls the live `/pricing` table:

| Tier | Price | Scans/mo | Seats | Retention |
|---|---|---|---|---|
| Free | $0 | 5 | 1 | 30d |
| Pro | $10/mo | 100 | 3 | 180d |
| Team | $20/mo | 500 | 10 | 365d |
| Enterprise | Custom | Unlimited | Unlimited | Custom |

This is, almost word for word, the pitch I wrote myself in my L1 closing line: *"Team gets you 500 scans
and a fleet view for $20/mo."* I called that number without having seen the pricing page render live —
turns out I called it exactly right. 500 scans/mo comfortably covers a 30-repo foundation's release-cycle
cadence (30 repos × ~1 scan/cycle, with room for re-scans on the same commit — which §5's credits table
confirms are free/uncounted on every tier, not just mine). That's not a hypothetical anymore; it's a real
$20/mo line item sitting on the page, unmarketed for my use case. **F3 stands, confirmed, with the exact
number now verified live rather than inferred from the code.** The blurbs (`plans.ts`) are still "small
team" / "more volume, more seats" — no "public portfolio" or "foundation" word anywhere in the copy the
evidence pulled. Nothing closes this gap; it's still a missed line, not a broken one.

## 2. NEW finding — the exact paid tier I'd have to recommend has a trust gap on the one axis I care about most

Shared evidence §4 is new information I didn't have at L1: on `/org/vercel/executive` — the board-facing
briefing that a Team-tier subscriber would export via "Download PDF" or "Copy for LLM" — the trajectory
line renders a confident, dated ETA (*"At risk of slipping to L3 · Augmented in ~4 weeks (≈ 2026-08-13)"*)
with **zero** confidence/low-data caveat, on the identical low-n data that the free, unauthenticated-in-my-
world `/trends` page correctly flags as `"trend confidence — low data (n=2)"`. Same underlying flag
(`lowData`), two different renderings — one honest, one silent — traced to `src/lib/org/briefing.ts:242-248`.

This matters to my facet specifically because of what I'd be recommending. If I go back to my foundation
board with "there's a $20/mo tier that gives us a fleet dashboard and an executive briefing," I am, by
definition, vouching for that briefing's numbers the same way I vouch for the badge today. My whole bar is
"evidence-backed and dated, not a vibe with a logo" — and the shared evidence shows the flagship paid
surface fails exactly that bar on its highest-visibility number, in a way the free surface next to it
doesn't. I wouldn't walk away from the pitch over this — it's a one-line fix, and the free surfaces I
actually use are clean — but it downgrades my pitch from "the paid tier is obviously solid, just
unmarketed for us" to "the paid tier is unmarketed for us AND has a rough edge I'd want fixed before I
put my name on the recommendation." **New finding, moderate severity for my facet** (I'm not the one
burned by it — a Team-tier buyer following my advice would be).

## 3. NEW finding — a Free-tier org's `/usage` page would greet a foundation's first trial with a false "you're about to be locked out" banner

Shared evidence §6: a Free-plan org with **0 private scans** and its full 5/mo allowance untouched still
renders a warning-colored *"Out of private-scan credits — the next private scan will be refused (402)
until you top up"* banner, because the check (`creditBalance === 0`) tests the wrong pool — the prepaid
overflow-credit balance, not the actual monthly allowance the scan endpoint checks first. It directly
contradicts the very next line on the same screen: *"Comfortably within your 5/mo Free allotment."*

This is a new, live-confirmed finding that bears on my facet even though I don't personally open `/usage`:
it's exactly the "pricing copy vs. code" mismatch class I watch hardest for, just relocated to an adjacent
page. If our foundation ever spun up a trial org to test the Team-tier pitch I'm the one proposing, the
first thing a board member or fellow steward would see is a page telling them they're locked out with
zero usage — which is precisely the kind of "wait, is this a bait-and-switch?" reaction that would kill
the recommendation before anyone got to the real (accurate) $20/500-scans math in §1. **New finding,
directly relevant severity for my facet: it's a self-inflicted wound on the exact conversion path F3 says
is missing marketing for.** Cheap fix per the evidence (gate on `usage.usageThisMonth`, not raw balance).

## 4. F5 (badge/re-scan-caching strength) → reinforced

Shared evidence §5's "Where your credits actually go" table states plainly: *"Re-scan an unchanged
commit — Cached — re-running a scan on the same commit never costs a credit… ○ Free ✓ Included [all
tiers]."* The evidence's own methodology note (§1, step 3) had to deliberately mangle a stored `headSha`
to force a second billable-looking scan for testing — an unplanned live demonstration that the free-forever
caching behavior I praised in F5 is real and had to be worked around, not just claimed. **Confirmed,
strengthened, no change to verdict.**

## 5. F1 and F2 → unchanged, not adjudicable from this evidence (see §0)

Both remain at their L1 status: code-confirmed, not live-confirmed. Nothing in the shared evidence
contradicts them (the sign-in gate code and the quota code weren't touched or altered), but nothing in it
walks the anonymous path either, because the session ran with auth bypassed throughout. I'm not
downgrading my confidence in either — the code citations are unambiguous — but per the instruction to
reason only from the evidence in front of me, I mark them **not-retested** rather than **reconfirmed**.

## 6. F4 (30-day-retention overshoot, generosity strength) → unchanged, not directly retested

The shared evidence confirms `retentionDays: 30` is the number stated in `plans.ts`/`/pricing` (§5's
table), consistent with what I cited at L1. It does not re-run my specific claim that `/trends`' single-
repo history query never calls `retentionCutoff()` — the live run's history pulls were 21-day-old records
well inside the 30-day window anyway, so even if the clip were enforced it wouldn't have shown up as a
visible difference in this dataset. **Unchanged from L1, not re-verified live, no contradiction.**

---

## Findings (L2)

1. **[confirmed, sharpened]** F3 — no OSS-foundation framing on Pro/Team tiers, now confirmed with live,
   exact pricing ($10/100, $20/500) matching my own predicted pitch verbatim. `src/app/pricing/page.tsx`,
   `src/lib/plans.ts`. Severity: minor (unchanged — missed upsell, not a broken promise).
2. **[NEW, confirmed via shared evidence]** The Team-tier's flagship board deliverable (executive
   briefing) shows a confident dated trajectory ETA with no low-data caveat, while the free `/trends`
   surface shows the caveat for the same underlying data. `src/lib/org/briefing.ts:242-248`. Severity:
   moderate for my facet — undercuts the credibility of the exact tier I'd have to recommend.
3. **[NEW, confirmed via shared evidence]** A Free-tier org's `/usage` page falsely claims imminent
   lockout on 0%-used allowance — a live trust-eroding mismatch on the page a trial foundation org would
   see first. `src/app/usage/page.tsx:142`. Severity: moderate for my facet — a self-inflicted friction
   point on the exact conversion path F3 says is otherwise open.
4. **[confirmed, reinforced]** F5 — badge/cached-rescan free-forever behavior confirmed live, including
   an unplanned demonstration that the caching had to be circumvented to test billing at all.
5. **[unchanged, not retested]** F1 (trends sign-in gate) and F2 (5/mo public quota) — the shared
   evidence's auth-bypassed, org-scoped session doesn't bear on either; both remain code-confirmed only.
6. **[unchanged, not retested]** F4 (30-day retention overshoot) — consistent with, but not independently
   re-verified against, the shared evidence's 21-day-old dataset.

---

## Character voice — first-person reaction to the live evidence

*Two things land on my desk today that I didn't have last week. One confirms my own math — I said "Team,
$20/mo, 500 scans, fleet view" as a guess, and the live pricing page says the same number back to me,
digit for digit. That's satisfying in the way it always is when you do the arithmetic before checking the
receipt and you're right. The gap I flagged is real, it's precisely priced, and nobody's closed it.*

*The other two things are new, and they're the kind of thing that makes me trust the free tier MORE and
the paid tier's pitch LESS, which is an odd split to end up on. The executive briefing — the thing I'd
actually be recommending to my board if I ever recommended anything — hands out a dated ETA with a
straight face on data that the free trend page next to it is honest enough to call "low confidence."
That's not a dealbreaker, it's a tell: the surface built for the money conversation cares less about
provenance than the surface built for free. And the usage page telling a brand-new, untouched Free org
it's about to get refused — that's the exact "pricing copy doesn't match code" smell I go looking for,
just relocated one page over from where I was looking. If a fellow steward spun up a trial org on my
recommendation and saw that banner first, I'd never hear the end of it.*

*Verdict: I'm not going anywhere — Free still clears my bar completely for the report, the badge, the
one-repo glance, and none of today's evidence touches that. I'll keep recommending it to peers on exactly
those terms. But my "would this company ever get a check from a foundation" answer just went from "yes,
if they bothered to say so" to "yes, if they bothered to say so AND fixed two rough edges on the tier
they'd be selling me." Renew my own free-forever status without a second thought; hold my endorsement of
the paid path until the exec briefing stops being more confident than its own data and the usage page
stops crying wolf on an org that hasn't spent a dime.*

## Time-saved (unchanged from L1, still my honest number)

~2-3 hrs/release-cycle is the promise (badge auto-refresh + trend glance vs. 5-8 min/repo × ~30 repos by
hand). Nothing in the shared evidence changes which slice of that I can actually realize — still fully
realized on the always-free, mock-scored badge path (all ~30 repos), partially realized on the LLM-graded
report/trend path (5 repos/cycle before the quota wall, per F2, unretested this round). Blended estimate
held at **~150 minutes/cycle**.

---

## Verdict

**Renew** (Free, unconditionally) / **no change to my non-recommendation of the paid tier** — the shared
evidence sharpens the paid-tier pitch's exact economics in my favor (F3) while surfacing two new reasons
(executive-briefing overconfidence, usage-page false-lockout) I'd want fixed before I'd put my name behind
suggesting it to the foundation board.
