---
character: Tomáš (prospective buyer)
goal: "We just spent six figures on AI coding tools and leadership wants to know it's working — is this thing worth a deeper look, or is it another demo? Two minutes, then I'm out."
promotion: discovery
seed: no auth/DB needed — public marketing + a public-repo scan. See uat/env.md (LLM_PROVIDER=auto falls back to deterministic mock; the public funnel works with DATABASE_URL unset). Scan target: a real public repo he'd already understand, e.g. vercel/next.js or facebook/react.
references:
  - https://learn.g2.com/software-pricing-transparency — G2 2025: ~4% of products show price; hidden pricing drops vendors off the shortlist. Sets the no-contact-wall, numeric-pricing bar for this journey.
  - https://www.markepear.dev/blog/selling-to-developers — "market to devs, sell to their boss"; free self-serve experience is non-negotiable; evaluators want to test in their own environment over a sales call. Sets the frictionless-self-serve-scan-as-CTA bar.
  - https://trustmary.com/social-proof/how-trust-elements-impact-b2b-buying-decisions/ — quantified, outcome-anchored proof beats logo walls and self-claims. Sets the credible-proof bar.
---

## Trigger (why now)
Leadership signed a big org-wide AI-coding-tool contract last quarter and is now asking Tomáš, in a hallway and then in writing, "are we actually getting value out of this?" He doesn't have a defensible answer and doesn't want to hand-build one every quarter. A peer mentioned Ascent — "the maturity index for AI-native engineering" — so he's opening the landing page cold, between meetings, to decide in a couple of minutes whether it's worth a real evaluation or just another dev-tools pitch he can dismiss.

## Definition of done (their POV)
- He can state, after ~2–3 minutes, **what Ascent is, who it's for, whether it works, what it costs, and what the next step is** — in plain words, without booking a call or signing up.
- He found **the price** — actual numbers — from the landing page, with no contact-sales wall in the way.
- He ran **one public scan himself** on a repo he knows, with no login, and the report looked **senior-grade** — scores that reconcile with that codebase, cited evidence, a specific next move — not toy/demo output.
- He's reached a clear gut verdict he could defend to leadership: **"worth a deeper look"** or **"this is a demo, not a product."**

## Out of scope
- Anything behind auth — `/org/[slug]` dashboards, trends, usage, org rollups. He is the buyer, not the daily dashboard user; he won't sign in during this first look. (Don't flag authed org features as "missing" — they're simply not part of this journey.)
- Actually purchasing scan credits / completing a Polar checkout. He's deciding whether to evaluate, not buying yet.
- The depth/correctness of the org-intelligence product itself — this journey judges the *public funnel and one public scan*, the surface a buyer sees before committing.
- The PR CI gate mechanics in a real pipeline (he may notice `/badge` and the gate exist as proof points, but he won't wire one up).

## Discovery hints
Entry point(s): `/` (landing). Do NOT script the steps — the Character finds his own path; getting lost is itself a finding. Natural surfaces he may reach on his own: `/about` (what is this / who's it for), `/pricing` (what does it cost — watch for any contact-wall), the landing ScanForm and a resulting `/report` (his own self-serve proof), `/launch` (the fleet-map experience), `/badge` (a credibility/proof point). The two highest-signal questions: can he find **numeric pricing without a wall**, and is the **public-scan report senior-grade or toy**.

## Frozen happy path  (filled in only on `promote`)
<!-- empty until this journey graduates to an acceptance gate via `/uat promote evaluate-whether-to-adopt` -->
