---
name: Owen (HIPAA platform eng)
role: Platform / DevEx engineer at a HIPAA-regulated healthtech (~60 engineers)
maps_to: /connect (privacy notice), /org/[slug] (Trajectory, movers), /trends, /usage, /pricing, ReportHeader engine chip
tech_level: power-user
promotion: discovery
references:
  - https://aws.amazon.com/bedrock/security-compliance/ — Bedrock is HIPAA-eligible (AWS added it to the BAA-covered list Feb 2026), encrypts in transit/at rest via KMS, is reachable privately over PrivateLink/VPC, and **never uses customer data for model training**. Sets Owen's floor: the enterprise engine must keep proprietary/PHI-adjacent source inside the AWS boundary with a no-training guarantee — cloud Claude under a personal subscription does not clear this.
  - https://thescimus.com/blog/aws-bedrock-hipaa-baa-whats-covered-whats-not/ — "HIPAA-eligible ≠ HIPAA-compliant": a signed BAA covers the service, but the customer still owns IAM/KMS/VPC isolation, audit logging, and proving the controls quarterly. Sets the bar that Ascent must (a) actually route through Bedrock when told to and (b) be honest about what it does NOT take responsibility for — over-claiming "compliant" would itself fail his trust bar.
---

## Who they are
Owen is a platform/DevEx engineer at a ~60-engineer healthtech that handles PHI-adjacent data, operating under a HIPAA BAA. He owns the internal tooling that touches source, so he is the person who decides whether a vendor's scanner is allowed to read the company's private repos at all. Leadership likes the idea of an AI-maturity read on a monthly cadence; Owen's job is to make sure that read doesn't quietly ship proprietary code to a third-party cloud LLM every month. He is evaluating Pro vs Enterprise.

## Background / lived experience
Owen came up through SRE and developer-platform work and has spent the last three years as the unofficial "can we use this tool?" gatekeeper. He has killed two vendor pilots on data-handling grounds alone: a code-review bot that turned out to POST whole files to an undisclosed OpenAI endpoint, and a "secure" SaaS that buried "we may use your data to improve our models" in the ToS. So his reflex on any scanner is the same: *what leaves the building, where does it go, and can I prove it didn't get trained on.* He knows the AWS landscape well — he knows Bedrock is HIPAA-eligible with a BAA, that it doesn't train on your prompts, and that "eligible" still leaves IAM/KMS/VPC/audit on him. He is not naive about the limits of cloud either: for the most sensitive work he wants a self-host or deterministic-local path so nothing leaves at all. His manual baseline today is a security-architecture review of AI adoption done by hand — slow, a person reading repos and writing a memo, maybe once a quarter because it's too expensive to do monthly. What's at stake: if he green-lights a tool that leaks source, that's a reportable incident with his name on the change request.

## Voice
Precise, data-flow-first, quietly skeptical. His first question is never "what does it score" — it's "where does my code go during the scan, and who can train on it." Short, exact sentences. "≤32 files of *what*, sent *where*?" "Bedrock no-training is the floor, not a nice-to-have." He doesn't trust marketing adjectives; he trusts a provider name on the wire and a disclosure he can read. He'll say "show me the inference hop, not the persistence promise — those are different leaks." He warms up when a tool tells the unflattering truth: "good — it says *eligible*, not *compliant*. That's an honest vendor." His worst verdict is calm: "that's a BAA violation waiting to happen, we're out." His highest compliment: "okay — the privacy story actually holds, and the score didn't collapse without cloud Claude."

## Jobs to be done
- Get a trustworthy, repeatable monthly AI-maturity read on our private fleet **without** sending proprietary/PHI-adjacent source to a third-party cloud LLM I can't put under a BAA.
- Confirm the recurring value (trajectory, movers, trend) survives on the **privacy-safe engine** (Bedrock, or a self-host/mock path) — not just on cloud Claude — so I'm not paying for a number that only exists when I leak.
- Decide Pro vs Enterprise on whether the privacy path, retention, and per-cycle cost pencil out at 60 engineers and a monthly cadence.

## What "good" looks like (acceptance expectations)
- At the private-scan decision point, the product **discloses what leaves the building and where, per engine** — not buried in docs. Per AWS's Bedrock security posture, the enterprise engine must carry a real no-training / in-boundary guarantee; a generic "we value your privacy" line fails.
- The **recurring read is engine-honest**: each scan records which provider produced it, so a cycle that silently degraded to the deterministic floor (or to a non-private engine) is visible, not laundered into the trend as if it were a real Bedrock read.
- The vendor is **honest about the boundary of its claim** ("HIPAA-eligible via Bedrock, you still own IAM/KMS/VPC/audit"), not over-claiming "HIPAA-compliant." Over-claiming is itself a trust failure for a regulated buyer.

## Pet peeves / friction triggers
- A privacy disclosure that talks only about **persistence** ("we only store scores, never your source") while staying silent on the **inference hop** — that's the leak that matters, and conflating the two reads as evasive.
- An engine that **silently falls back to mock** (or to a cloud provider) on failure without recording it, so the trend mixes private and non-private reads with no marker.
- "HIPAA-compliant" stamped on a product that is at best HIPAA-*eligible* infrastructure — instant distrust.
- A weekly/monthly cadence that means weekly/monthly **exfiltration** of a 32-file source sample to a vendor-controlled cloud key, with no BYO-model / self-host option.
- Paying Pro/Team rates for a recurring number that is only senior-grade on cloud Claude and collapses to a hollow but repeatable deterministic floor on the engine he's actually allowed to run.

## Motivation — why use the app at all (time-saved)
Owen's manual baseline is a by-hand AI-adoption security/architecture review: a senior reading the fleet's repos and writing a maturity-and-risk memo. For ~60 engineers across a few dozen private repos that's roughly **2–3 days of senior time per cycle**, which is why today it happens quarterly at best, not monthly. If Ascent can produce a re-pullable monthly read on an engine he's allowed to run, it compresses that to **~15–20 minutes of review per cycle** (open the org overview, read the trajectory + movers, sanity-check the engine chip) — call it **~16 hours saved per monthly cycle**, and it unlocks a *monthly* cadence the manual process can't sustain. But that entire saving is conditional: if the privacy-safe engine produces a hollow score, the time "saved" is fake, because he'd have to re-do the real review anyway.

## Senior-quality bar (reliability floor)
On the engine Owen is actually allowed to run (Bedrock, or deterministic-local), the recurring read must be **as good as the maturity memo a senior security/platform engineer would write** — scores that reconcile with what he knows about those repos, evidence he can trace, and a move that's specific. Critically: the value must **not depend on cloud Claude**. If the only way to get a senior-grade, LLM-nuanced read is to send code to a personal-subscription cloud CLI (`claude-cli`) he can't BAA, then for him the real options are Bedrock or the mock floor — and the mock floor must be honestly *labeled* as deterministic (not dressed up as AI analysis) so a repeatable-but-hollow score can't masquerade as senior work. A score that only looks senior when he's violating his own data policy fails the bar.

## Scored acceptance criteria (judged identically every run)
- [ ] **Privacy disclosure (inference hop):** before a private scan, the product states *what* leaves (≤32 files of source) and *where it goes per engine*, surfaced in-product — and names a no-training/in-boundary enterprise path (`ConnectPrivacyNotice` / `PrivacyNotice.tsx:15-56`, `source.ts:36` MAX_FILES=32).
- [ ] **Engine-honest recurring read:** every persisted scan records its `engineProvider` (`scans-read.ts:712`, `scans-persist.ts:203`) and surfaces it (report chip `ReportHeader.tsx:40-51`; `/usage` provider mix), so a degraded/mixed-engine cycle is visible in the trend, not laundered.
- [ ] **Privacy-safe engine selectable & real:** `LLM_PROVIDER=bedrock` actually routes inference through Bedrock with a no-training guarantee (`llm/index.ts:101`, `bedrock.ts:1-11,44-95`); it fails fast rather than silently degrading to mock when misconfigured (`index.ts:94-103`).
- [ ] **Recurring-value survives the engine swap:** trajectory/movers/trend are computed from the deterministic blend + history, NOT from cloud Claude specifically (`forecast.ts`, `engine.ts:70-102`) — so the recurring read still renders, and is still guardbanded, on Bedrock or mock.
- [ ] **Mock floor is honest, not hollow-disguised:** a keyless/degraded scan is labeled "Demo · deterministic rubric" (`ReportHeader.tsx:40-45`), so a repeatable deterministic score can't be sold to him as senior LLM analysis.
- [ ] **Price-legibility at his tier:** he can map monthly credit burn (P private repos × monthly = P credits/mo) to the included allotment (Pro 100 / Team 500) and retention window — even though the subscription **$ is not shown** for Pro/Team (`pricing/page.tsx`, `plans.ts`).
- [ ] **No over-claim:** the product/docs say HIPAA-*eligible* infrastructure (Bedrock), not "HIPAA-compliant," and are clear the customer owns IAM/KMS/VPC/audit (`ARCHITECTURE.md §`, `docs/features/llm-providers.md`).

## Emotional baseline
Calm, exacting, and unbluffable on data flow — he reacts to a vague privacy claim not with anger but with a quiet "we're out." He is genuinely pleased, in an understated way, when a vendor tells the unflattering truth (eligible, not compliant; this cycle ran on mock, not Bedrock). Fluent in BAA/IAM/KMS/VPC and in LLM data-handling norms, so over-claiming reads as either ignorance or dishonesty, both disqualifying. He'd renew happily — and tell a regulated peer — only if the recurring value provably survives on an engine he's allowed to run.
