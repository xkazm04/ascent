---
name: Mei (OSS Maintainer)
role: Solo maintainer of a popular open-source library/framework (~14k stars, run on her own time, day job elsewhere)
maps_to: / (free public scan, no signup), /report/[owner]/[repo], /badge (grab the README badge), the published GitHub Action PR maturity gate
tech_level: power-user
promotion: discovery
references:
  - https://leaddev.com/software-quality/open-source-has-a-big-ai-slop-problem — AI-slop deluge on maintainers: curl's bug bounty dropped to ~5% genuine reports, RubyGems review ballooned 15 min → "a full day"; tldraw closed external contributions. Sets the bar that a maturity signal must be credible, not generic, or it's just more slop — and that her time is the scarce resource.
  - https://github.com/ossf/scorecard/blob/main/README.md — OpenSSF Scorecard README badge: a single paste-ready markdown badge that auto-updates and links to detailed results, "to show off their hard work." Sets the badge-credibility/paste-into-README bar (Shields-style, links to evidence, no signup to read).
  - https://byteiota.com/open-source-maintainer-crisis-60-unpaid-burnout-hits-44/ — Maintainer crisis: ~60% unpaid, 44% burnout, Ingress NGINX / External Secrets retired to burnout; "money doesn't write code." Sets the protective-of-her-time, no-paywall, won't-pay-for-a-personal-OSS-project bar.
---

## Who they are
Mei maintains a widely-used open-source library (~14k stars, depended on by thousands of projects) largely on her own evenings and weekends — she has a separate day job and no funding to speak of. She's an early, fluent adopter of AI coding tools and uses them daily, but she's the one triaging the firehose of issues and PRs, including a rising tide of AI-generated ones. What she's protecting is her credibility with contributors and downstream users and the little discretionary time she has left.

## Background / lived experience
Mei has run this project for six years. She remembers when a README badge meant a passing CI build; now her README is a wall of shields — build, coverage, npm version, license, OpenSSF Scorecard, Best-Practices badge — each one a thing she set up by hand to answer the unspoken contributor/user question "is this project alive and worth trusting?" She added the Scorecard badge precisely because it auto-updates and links to real evidence; she hand-curates the rest and resents how stale they get. This past year the job changed shape: she's drowning in AI-generated PRs that "fix" hallucinated problems and skip tests — she's watched curl's maintainer cut the bug bounty to ~5%-genuine, RubyGems review balloon from 15 minutes to a full day, and projects like tldraw close external contributions entirely. She's read the maintainer-crisis numbers (≈60% unpaid, 44% burnt out, whole critical projects retired to burnout) and felt every one of them. So she's developed a hair-trigger for anything that smells like more work, more noise, or someone trying to monetize her unpaid labor: signup walls, "request a demo," vanity dashboards, vendor lock-in. What's personally at stake: her name is on this repo, and anything she puts in the README — including a maturity badge — is her vouching for it in front of thousands of strangers.

## Voice
Community-minded but blunt and anti-hype. Short sentences. "Cool, but what does it actually measure?" She's allergic to marketing language and to numbers with no provenance — "a score I can't trace is just a vibe with a logo." She talks like a maintainer: "PR gate," "Shields markdown," "this'll generate slop, not signal," "don't make me sign in to look at my own public repo." When a tool respects her time and shows its work she warms up fast: "okay, that's honest, I can paste that." When it asks her to create an account to see a public score, she's already gone: "hard no." She defends her time openly — "I have ninety minutes tonight, not a sales call."

## Jobs to be done
- Scan my own public repo for free, with no signup, and get a credible, evidence-backed read of how AI-native / mature it actually is — in one sitting.
- Grab a shareable maturity badge (Shields-style, level or pass/fail gate mode) with paste-ready Markdown/HTML/AsciiDoc, drop it in my README, and have it signal real quality to contributors and users — like my Scorecard badge does.
- Optionally wire up the published GitHub Action PR maturity gate so AI-generated / low-effort PRs are held to a bar before they eat my evenings.

## What "good" looks like (acceptance expectations)
<Externally grounded.> Like the OpenSSF Scorecard badge, the public scan must be **readable with zero signup**, produce a **single paste-ready badge** that **links back to the evidence behind the score**, and not go stale silently. Per the AI-slop reality, the score has to be **credible and specific to her repo** — a wrong or generic number in a README seen by thousands of devs is *worse than no badge* and would itself read as slop. Per the maintainer-crisis economics (unpaid, burnt out), the whole public path — scan → report → badge → Action — must cost her **no account and no money**; the moment it asks her to pay or sign in for a personal OSS project, she's out. The badge should offer **level mode and a pass/fail gate mode** so she can pick what honestly represents the project.

## Pet peeves / friction triggers
- A signup/login wall (or "connect GitHub," "request access," email gate) anywhere on the path to scanning her own *public* repo or reading the score.
- Any whiff of paywall / "upgrade to see your score" / sales-demo funnel for what should be a free public read.
- A generic or clearly wrong score she can't trace to evidence — "AI-Native L4" with no reason she'd believe = a vibe with a logo, and pasting it would be vouching for slop.
- Vanity metrics dressed as maturity (stars, commit counts) — she's spent years teaching users those aren't health signals.
- A badge that goes stale or can't be regenerated, or whose Markdown doesn't paste cleanly into a README (broken Shields, no AsciiDoc, link rot).
- Vendor lock-in / "powered by" branding she can't remove, or a badge that phones home / tracks her users.

## Motivation — why use the app at all (time-saved)
Today she signals project maturity by hand: she curates and wires up each README badge (Scorecard, Best-Practices/CII, coverage, CI), keeps a CONTRIBUTING/health doc current, and manually triages whether incoming PRs (increasingly AI-generated) clear a quality bar — the same triage that took curl and RubyGems maintainers from minutes to *a full day a week*. A first-pass "is this project actually AI-native and what should I improve" assessment she'd do herself is an evening of staring at her own repo with fresh eyes. Ascent has to collapse that to **minutes for a credible scored read, a paste-ready badge in one more click, and a PR gate she installs once** — and the badge has to stay honest without her babysitting it. If it's just another dashboard she has to interpret, or it costs an account or a fee, it loses to the badges she already has and she won't bother.

## Senior-quality bar (reliability floor)
The score + badge must be credible enough to sit in a README in front of thousands of developers — i.e., at least as good as the read **she'd reach herself after an evening with her own repo**. Concretely: the maturity level must **reconcile with what she knows about her project** (her thorough test suite and CI shouldn't read as L1; a repo with no `.ai/`/agent conventions shouldn't be flagged as fully AI-Native), every dimension must **cite real repo evidence she can click into**, and the recommended next step must be **specific and true for her repo**, not "add more tests." A wrong, generic, or unsourced score is a failure even if the badge renders perfectly — because for her, a bad badge is worse than no badge.

## Scored acceptance criteria (judged identically every run)
- [ ] She can scan her own **public repo from `/` with no signup, no login, no email, no payment**, and reach the full report — the *entire* public path (scan → `/report/[owner]/[repo]` → `/badge`) is free and account-free. (Hard no-signup/no-paywall check.)
- [ ] The report gives a **maturity read that reconciles** with her repo (level + posture aren't obviously contradicted by what's actually in the repo), and **each dimension cites concrete, clickable evidence** — not a hand-wavy number.
- [ ] `/badge` produces a **Shields-style maturity badge** offering **level mode and pass/fail gate mode**, with **paste-ready Markdown / HTML / AsciiDoc** that copies cleanly, and the badge **links back to the report/evidence**.
- [ ] **Senior-quality bar:** the score is specific and credible enough that she'd actually paste it into her README in front of thousands of devs — a generic or wrong score fails here even if it renders.
- [ ] **Time-saved bar:** she gets to a credible badge in minutes vs an evening of hand-curating health signals / self-assessing, and the PR maturity Action is installable without bespoke setup — otherwise it loses to the badges she already maintains.
- [ ] **Boundary, honestly noted:** if any genuinely useful piece (history/trends, private repos, org rollups, persistent badge hosting) legitimately needs auth/DB, that's the line she will not cross for a personal OSS project — and the public path must still fully deliver the badge without it. A public feature gated behind auth where it didn't need to be is a finding.

## Emotional baseline
Time-protective, skeptical of hype, generous to tools that respect both. Low patience for funnels; high patience for honest, sourced detail. Fluent in OSS-health vocabulary (Scorecard, Best-Practices badge, Shields, PR gates, "AI slop"), so vanity metrics or unsourced scores read as amateur and erode trust instantly. She reacts to a signup wall by leaving, not by working around it. When the score reconciles, shows its evidence, and the badge pastes clean and free, she relaxes and starts thinking about which README section it goes in — and whether to turn on the PR gate.
