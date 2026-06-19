---
character: Elena (CTO / Founder)
goal: "Are we actually keeping up on AI-native engineering — and where are we behind — without a sales call, a spreadsheet, or leaking my private code?"
promotion: discovery
seed: a public org or repo for the no-auth path (e.g. paste `vercel/next.js` or your own public org at /onboarding); for the private/org dashboard use ASCENT_AUTH_BYPASS=1 + seeded org (npm run db:local:seed). See uat/env.md
references:
  - https://foundercollective.com/blog/the-ai-native-cto/ — The AI-native CTO: small AI-leveraged teams out-shipping much larger ones; "AI fluency is the new technical debt." Sets the trigger (the fear of falling behind) and the bar that the read must be fast and decision-grade, not a metrics wall.
  - https://aws.amazon.com/bedrock/faqs/ — AWS Bedrock: inputs/outputs never train Amazon or third-party models, not shared with providers, encrypted, stays in-Region, optional PrivateLink. Sets the privacy definition-of-done before she'll scan private code.
  - https://jellyfish.co/library/devops/maturity-model/ — DevOps maturity loop (scope → data/interviews → gap → plan). Sets the time-saved anchor: the manual alternative is a multi-week audit she'd never run.
---

## Trigger (why now)
Her CEO co-founder asked, again, in a board-prep doc: "are we AI-native enough to outrun the bigger players, or are we quietly falling behind?" Elena has a gut feel but no defensible read across her repos, and she just read another "3 engineers + AI out-built our team of 30" story that hit a nerve. She has fifteen minutes between meetings, no patience for a sales call or a spreadsheet, and she wants to know — today — whether her instinct ("a couple of squads are genuinely AI-native, most just bolted Copilot on") holds up against the actual code, and what the single highest-leverage move is. Privacy is on her mind from the first click: the moment this touches her real code she needs to know where it goes.

## Definition of done (their POV)
- She got a real, **evidence-cited** AI-native maturity read — fast, no signup or sales call to reach first value.
- The read **reconciles with what she already knows** about her teams (and ideally surfaces a gap she hadn't named), and it **separates adoption from rigor** rather than flattering her with "everyone uses Copilot."
- She can **drill from any score to the cited repo evidence** — she can answer "says who?" without leaving the report.
- Before pointing it at private code, she could **determine from the product where her code goes** — that a Bedrock / in-boundary, no-training, not-shared path exists — clearly enough to feel safe scanning a private repo.
- She walks away with **one highest-leverage move** stated in engineering terms, tied to the cited gap — a decision she could act on Monday, not a dashboard to interpret.

## Out of scope
- Buying credits / completing a paid B2B checkout (she may glance at /pricing to size it, but purchasing is a separate journey).
- Configuring real Bedrock/Gemini keys or actually routing live private code through a provider (she only needs to *confirm the privacy path exists and is legible* — the run itself can be mock/public).
- The PR CI gate / badge embedding (a different job than the "are we keeping up?" read).
- Multi-org admin, team/member management, audit log, billing metering internals.
- Comparing two historical scans / long-run trend analysis (this is a first read, not a trend study).

## Discovery hints
Entry point(s): `/` (single-repo scan) and `/onboarding` (import + scan a whole org). Do NOT script the steps — the Character finds her own path; getting lost, hitting a setup wall before first value, or being unable to tell where her private code goes is itself a finding. Note specifically whether she can reach a first evidence-cited read with no signup, whether the org read reconciles with a CTO's sense of her teams (adoption vs rigor), and whether the privacy/Bedrock story is legible *at the point she'd scan private code* — not only buried in docs.

## Frozen happy path  (filled in only on `promote`)
<not yet promoted — discovery>
