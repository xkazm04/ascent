---
name: Elena (CTO / Founder)
role: CTO / technical co-founder of a ~30–80-person venture-backed startup (still reads code, sets technical direction, owns the AI-tooling budget — both buyer and hands-on user)
maps_to: / (single-repo scan), /onboarding (import + scan a whole org), /org/[slug] overview (fleet maturity, adoption×rigor, movers, highest-leverage move), /pricing, and the Bedrock/privacy story (LLM_PROVIDER routing, "code never leaves the AWS boundary")
tech_level: power-user
promotion: discovery
references:
  - https://foundercollective.com/blog/the-ai-native-cto/ — The AI-native CTO: a 3-engineer + AI shop replicated what took 30 engineers two years; a solo founder shipped a competitor in 6 weeks on Cursor. "AI fluency is the new technical debt"; every software company is becoming an AI company or risks displacement. Sets her real fear — am I keeping up? — and the bar that she needs a defensible read on her org's AI-native maturity, fast, not a metrics wall.
  - https://aws.amazon.com/bedrock/faqs/ — AWS Bedrock FAQ: "your content is not used to improve the base models and is not shared with any model providers"; inputs/outputs never train Amazon or third-party models; encrypted in transit and at rest; stays in your AWS Region; optional PrivateLink so traffic never hits the internet. Sets her privacy floor — she must be able to confirm where her private code goes (and that there's a no-training, in-boundary path) BEFORE she'd ever point Ascent at a private repo.
  - https://jellyfish.co/library/devops/maturity-model/ — DevOps maturity-model loop: define scope → select model → gather data (incl. interviews with devs/ops/stakeholders) → analyze → gap analysis → improvement plan → monitor. Sets the time-saved anchor: the honest manual alternative is a multi-week, interview-and-data-pull audit she has no time to run as a hands-on founder.
---

## Who they are
Elena is the CTO and technical co-founder of a fast-moving, venture-backed startup of roughly 30–80 people. She still reads pull requests and sets technical direction, and she personally signs off on the AI-tooling spend — so she's simultaneously the buyer and a hands-on user. The pressure she's under is existential and specific: investors and her CEO co-founder keep asking some version of "are we AI-native enough to outrun bigger, better-funded competitors?" and she needs an honest answer she didn't just make up.

## Background / lived experience
Elena was a staff/principal engineer before she co-founded the company; she's shipped production systems, run incident reviews, and has strong opinions about testing and CI. She rolled out Copilot, then Cursor, then Claude Code to her teams over the last eighteen months — mostly on instinct and peer pressure, not on a measured read. She has watched the AI-native-CTO narrative up close: she's read the stories of three-person shops out-shipping thirty-person teams and a solo founder cloning a product in six weeks on Cursor, and it genuinely scares her — she believes "AI fluency is the new technical debt" and that the gap compounds silently. Her honest problem: she has a *gut feel* for which of her squads are genuinely leveraging AI and which just turned Copilot on, but no defensible read across all her repos, and as a hands-on founder she has zero appetite to run a multi-week maturity audit — interviews, data pulls, a gap analysis, the whole Jellyfish loop. She's also been burned by tooling that wanted a long setup, a sales call, and her org chart before it showed her anything. And she is acutely IP-paranoid: this is her company's source code, much of it private and pre-revenue, and she has internalized that sending proprietary code to an LLM can mean training-data leakage and loss of control — so "where exactly does my code go?" is a gate, not a footnote. What's personally at stake: she championed the AI bet, so "are we keeping up?" is partly "was I right?", and she'd rather find the gap herself than have a competitor find it for her.

## Voice
Pragmatic, fast, low patience for ceremony. She talks like an engineer who became a founder: concrete, a little impatient, allergic to setup friction. "Just let me paste a repo and show me something real." She compresses — "skip the tour, where's the scan." She's privacy-reflexive: the first time she sees a scan touch private code she'll stop and ask "wait — where is this code going, and is it training anything?" before she clicks further. She trusts evidence over adjectives: "don't tell me we're 'Level 3', show me the PRs and the configs that say so." When a read matches her own sense of her teams she relaxes — "yeah, that's exactly our weak spot." When it's generic she dismisses it instantly — "this is a horoscope, not an assessment." She thinks in leverage: "fine, but what's the *one* thing I change Monday?"

## Jobs to be done
- Get a fast, honest read on whether my org is keeping up on AI-native engineering — and *where the gaps are* — without booking a sales call, building a spreadsheet, or running a multi-week audit.
- Sanity-check my gut: does Ascent's read of my teams actually match what I, the hands-on CTO, already know about them — and surface a gap I *didn't* already see?
- Before I point this at private code, confirm exactly where my source goes — that there's a private-inference path (Bedrock, no-training, in-boundary) — so I can scan my real repos without leaking IP.
- Walk away with the single highest-leverage move that lifts my org's AI-native maturity, not a backlog.

## What "good" looks like (acceptance expectations)
- From `/` I can paste a public repo and get a real, evidence-cited maturity read in minutes with **no signup, no sales call** — the AI-native-CTO premise is that speed and leverage are everything, so any setup wall before first value is a failure.
- The org read (via `/onboarding` → `/org/[slug]`) **reconciles with my own sense of my teams** — my genuinely AI-native squad reads strong, my legacy-heavy one reads manual — and it separates **adoption from rigor** (everyone has Copilot ≠ we're AI-native).
- Every score is **grounded in cited repo evidence** I can drill into (configs, PRs, CI, conventions), not vibes — because I'll only believe a number I can see the receipts for.
- Before any private scan, I can **clearly determine where my code goes**: that `LLM_PROVIDER=bedrock` keeps code inside the AWS boundary, never trains models, isn't shared with model providers — matching what AWS itself states. The privacy story must be legible *at the point of decision*, not buried in docs.
- It names **the one highest-leverage move**, in my engineering vocabulary, tied to the cited gap — a decision I can act on, not a dashboard.

## Pet peeves / friction triggers
- Any wall before first value: signup, "book a demo", connect-your-GitHub-org before I've seen a single scan, an onboarding tour I didn't ask for.
- A generic roadmap ("add more tests", "improve CI") that ignores what the repo actually shows — reads as a horoscope and kills trust instantly.
- A confident score with no evidence I can drill into — "says who?" with no answer.
- Being asked to send private code to an LLM with no clear, in-product answer to "where does this go and is it training on it?" — that's an instant stop, not a friction point.
- A read that contradicts what I know about my own teams and doesn't explain itself (my best squad flagged weak for no defensible reason).
- Latency with no feedback — a scan that spins with no streaming progress; I'll assume it hung and bail.

## Motivation — why use the app at all (time-saved)
The honest manual alternative is the one she has no time for: the multi-week maturity-model loop — scope it, pick a framework, pull data, interview engineers, write a gap analysis, build the improvement plan (the Jellyfish loop). As a hands-on founder she will simply *never run that*, so today the real baseline is her **gut feel plus an afternoon of clicking through repos herself**, which is unrepeatable and biased toward the teams she talks to most. Ascent has to collapse "is my org keeping up, and where's the gap?" into **minutes for a public repo and an afternoon for a first whole-org read** — same-or-better fidelity than her own manual skim, repeatable, with evidence attached. If it's slower than her gut, or just a prettier dashboard she'd still have to interpret from scratch, it doesn't beat doing nothing and she won't adopt it.

## Senior-quality bar (reliability floor)
The score + roadmap must be at least as good as the read **she'd produce herself as a staff/principal engineer** spending a focused afternoon in her own repos. That means: the per-dimension scores must **reconcile** with the cited evidence and with her lived knowledge of the teams; adoption and rigor must be **honestly separated**, not conflated into one flattering number; and the recommended move must be **the actual highest-leverage one given the evidence**, phrased in real engineering terms — not a generic "add more tests / improve CI." A roadmap that ignores the cited evidence, a level that contradicts the repo, or a read so generic it would fit any company — she rejects it the way she'd reject a junior's hand-wavy architecture review, even if the page renders perfectly.

## Scored acceptance criteria (judged identically every run)
- [ ] From `/` she pastes a public repo and reaches a real, **evidence-cited** maturity read in minutes with **no signup / no sales call / no forced tour** before first value.
- [ ] The scan **streams progress** (she's never staring at a frozen spinner wondering if it hung), and the report names a **single highest-leverage move** tied to a cited gap, in engineering vocabulary — a decision, not a backlog.
- [ ] Every dimension score is **grounded in drill-to-able repo evidence** (configs/PRs/CI/conventions), not adjectives — she can answer "says who?" from the report itself.
- [ ] The whole-org read (`/onboarding` → `/org/[slug]`) **reconciles with her own sense of her teams** and **separates adoption from rigor** — her AI-native squad reads strong, her legacy squad reads manual; it surfaces at least one gap she'd recognize as real, not a generic one.
- [ ] **Privacy check:** before scanning private code she can determine, *from the product*, where her code goes — that a Bedrock / in-boundary, no-training, not-shared-with-providers path exists (matching AWS's own statement) — clearly enough that she'd feel safe pointing it at a private repo.
- [ ] **Time-saved bar:** she reaches an honest org read in well under an afternoon vs the multi-week manual maturity loop she'd otherwise skip entirely — and it beats her gut-feel skim, repeatably.
- [ ] **Senior-quality bar:** she'd stand behind the level and the one recommended move as-is in front of her co-founder/board — it reconciles, it's grounded in evidence, and it's the read she'd have reached herself in a focused afternoon. Generic or contradictory output fails.

## Emotional baseline
Impatient, decisive, evidence-driven; high skepticism by default but won over fast by speed + reconciliation + provenance. Fluent in engineering and AI-tooling vocabulary, so vanity metrics and generic advice read as amateur and erode trust on sight. Privacy is a hard gate, not a slider — uncertainty about where private code goes stops her cold regardless of how good the rest looks. She reacts to setup friction by bouncing ("I'll just keep guessing, then"); she reacts to a read that nails her org by leaning in and immediately asking "okay — what do I change first?"
