# Tomáš — L2 addendum (live)

> Appended, not replacing, the L1 voice in
> `tomas-prospective-buyer--evaluate-whether-to-adopt.md`. The escalation between the two IS the
> signal (v1.2).

## What L2 was sent to answer
`TOMAS-L1-01` — L1 predicted, from code, that the free public scan is behind GitHub OAuth in
production, and flagged that it **could not be reached** on a host running `ASCENT_AUTH_BYPASS=1`.
That was the correct call, and it is exactly the environment-precondition class v1.1 added to the
method after a keyless-path finding went undiscoverable on a keyed host.

## Precondition satisfied — the arm was run
Rather than resolve it `uncertain`, L2 **built the missing arm**: the dev server was stopped and
restarted with `ASCENT_AUTH_BYPASS=0` / `ASCENT_OPEN_ORG_DASHBOARDS=0`. Supabase auth vars are
present in `.env.local`, so `authGateEnabled()` is true — the production shape. The header flipped
from `vercel / developer / Sign out` to `ORG DEMO / Sign in`, confirming the arm was real and not a
cached render.

```
POST /api/scan  {"url":"sindresorhus/is-odd"}
-> HTTP 401 {"error":"Sign in to run a scan.","code":"auth_required"}
```

## The widening L2 produced
L1 called it "the free scan is walled". L2 makes it more precise and **worse for this Character
specifically**:

| Anonymous action | Result |
|---|---|
| `GET /report/vercel/swr` | **200** — full 272-line report |
| `GET /api/badge/vercel/swr` | **200** |
| `GET /api/gate/vercel/swr?min_level=L3` | **422** (the gate works) |
| `POST /api/scan` | **401 auth_required** |

**Everything read-only is open. The one thing that is walled is running a scan yourself.** And the
hero CTA still reads "Scan a repository" (`landing-anon.text.txt:21`). Tomáš's scored criterion is
not "see a report" — it is *"run one public scan **myself** on a repo I know"*, because a
self-serve trial is the only proof he trusts over a vendor's self-claims. So the product leaves
open every surface that would **not** convince him and walls the single one that would.

Set against `README.md:94-98`, under the literal heading **"Free & public — no signup"**:
*"Everything here works anonymously"* · *"Scan any public repo → a full, auditable report."*

## Tomáš's voice — L2

> At L1 I said "worth a deeper look, conditionally." I'm walking that back a notch, and it's not
> because the product got worse. It's because I finally tried the thing the front page told me to.
>
> The landing page is good. Honestly good — one sentence, I knew what it was. Price in one click:
> zero, ten, twenty. No form. I've evaluated a dozen tools this year and maybe two got that far
> without asking who I work for. The report I looked at was the best surprise: it said SWR has
> almost no AI tooling and a 98 on testing, which is exactly what SWR is, and it argued with its
> own detector about signed releases. A tool that tells me its own checker got something wrong is
> a tool I start trusting.
>
> Then I clicked "Scan a repository" on a repo of ours. Sign in.
>
> That's the whole evaluation, right there. Not because a login is outrageous — I sign into things.
> Because the page above the button says "no signup," and the README says "everything here works
> anonymously," and neither is true for the only action that would have convinced me. I can read
> your demo. I can't test my own repo. Those are not the same product, and the one you advertised
> is the one I can't have.
>
> And I'd have found out anyway, thirty seconds later, that my org doesn't fit your pricing either.
> Ten members on the top listed tier. I have six teams. So the transparent price I liked so much
> isn't my price — mine is "Custom, contact us," and the button for it goes to an About page. You
> showed me a number I can't buy and hid the one I can.
>
> Would I forward the report to leadership? The report, yes — genuinely, it reads like a staff
> engineer wrote it, and that's rare. Would I forward the *product*? Not yet. I'd send one line to
> whoever owns this: your scan is better than your funnel, and your funnel is currently lying about
> your scan.
>
> Who would I loop in internally? Nobody, this week. That's the honest answer. I'd bookmark it and
> wait to see whether the sign-in wall is a decision or an accident. If it's a decision, say so on
> the button and I'll respect it. If it's an accident, it's costing you the exact buyer you built
> the pricing page for.

**L2 verdict:** `L2-conditional` — the job (decide whether to evaluate) completes, but on the
strength of a report he could only *read*, never *run*. Adoption call: **"worth a deeper look, but
I'm not starting one until the free scan is actually free."**
