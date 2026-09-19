# L2 report — Priya (Platform/DevEx Lead) × "Set and enforce the standard"

Certification level: **L2 — empirical, live browser.** Driven against the running dev server
(`http://localhost:3000`, `npm run dev` already up, health check 200) using the bundled
`uat/driver/drive.mjs` (the Chrome MCP extension was not connected this session, so this is the
documented fallback per `uat/env.md`). Org: **vercel** (already seeded, 6 repos, owner membership
already present on the seeded "developer" profile — confirmed by the `OWNER` chip in the header on
first navigation, so the second-visit auto-seed had already run in this DB). Screenshots/ARIA/text
captures live in `uat/runs/2026-07-16-full-sweep/shots-priya-l2/`.

L1 verdict carried in: **L1-conditional**, majors F1 (flat gate policy ignores archetype) and F2
(standard/SKILL.md undiscoverable from fleet surfaces). L2 priorities to answer:
1. Do a solo/team-archetype repo and an org-archetype repo in the same fleet get different gate
   floors live, and can Priya set per-archetype bars in the policy editor?
2. Time finding/downloading the onboarding SKILL.md starting from a gap repo named on
   Governance/Practices.
3. Does the live UI ever state the relationship between `/org/[slug]/skills` pushes and the
   enforced gate/standard?
4. Does the download button set the "this is a scaffold, run it through an agent" expectation
   *before*, not just inside, the file?

---

## 1. Journal (first-person, in character)

I land on `/org/vercel/governance` first — Govern is its own rail group, same as L1 predicted. Pass
rate 50%, 3/6 passing, "Active policy" card: **Minimum overall level L3, every dimension ≥ 40, no
"ungoverned" posture** — and the intro line under the page title says it plainly: *"One maturity
gate, applied as policy-as-code to **every repo in the fleet**."* And under "Active policy": *"The
bar every repo is held to — **change it once, enforce it everywhere.**"* That's not ambiguous copy I
have to infer from behavior — the product is *telling me* it's one flat bar. I open "Edit policy" to
look for an archetype selector. There's a `Minimum level` dropdown (any/L1–L5), `Min overall`,
`Min per-dimension`, a security floor toggle, an "ungoverned" checkbox, a protected-branch checkbox.
No archetype control anywhere in that form. I check the Failing repos list: `vercel/v0-sdk`,
`vercel/next.js`, `vercel/ai`. I go check each repo's own report page — `vercel/ai` and
`vercel/next.js` are tagged **"Org / platform"**, `vercel/v0-sdk` is tagged **"Team / product"**.
So this exact seeded fleet has two different archetypes sitting in the same Governance table, and
the one policy card at the top applies identically to both. That's F1, confirmed live, with real
numbers, not a hypothetical — this isn't a fleet where every repo happens to be the same shape, so
the flat-policy gap is a real bar my "hack-week repo" analogy would hit today, not a corner case.
(One honesty check on myself: for THESE three failing repos the gaps are large enough — v0-sdk's
D1 is 0 vs any floor — that a 35-vs-40 archetype-aware floor wouldn't flip any of them from fail to
pass today. So the live *practical* damage on this fleet is zero right now; the damage is that the
mechanism doesn't exist at all, which will bite the moment a team-archetype repo is borderline.)

Now Practices. Nine mined practices, adoption fractions, "View →" per row. I open "Agent guidance"
— exemplar `workflow` (linked, 100/100), "Could adopt next (1): v0-sdk" as **plain text, not a
link**, and an "Apply to a repo" combobox pre-selected to v0-sdk with a "Preview starter" button.
Good mechanism, confirmed real (I later curl'd the actual `/api/report/skill` endpoint and the
markdown that comes back is genuinely repo-specific — real dimension scores, "Run style: Team /
product lens", a control-model section explicitly framed pre-push-primary/CI-thin-backstop, and an
explicit no-fabrication guardrail). But nowhere on this modal, or anywhere on Practices, is there a
link to *the* standard artifact — the `.ai/manifest.yaml` + onboarding SKILL.md generator. The
"Preview starter" button on this modal generates a *practice-artifact* (the CLAUDE.md/AGENTS.md
snippet for one mined practice), which is a different, narrower thing from the onboarding SKILL.md
that bundles the whole standard. I now have to go remember which repo I want the standard for and
go find its own page — nothing here does it for me.

I check Governance again for a link on `vercel/v0-sdk` itself in "Failing repos" — it's plain text,
not a link either. So from *both* of the surfaces the journey's discovery hints told me to expect
this from, the gap repo's name is unlinked. I have to leave "Govern" or "Plan" entirely, go to
**Fleet → Repositories**, scan the table for `v0-sdk` by name, click it — only then do I land on
`/report/vercel/v0-sdk`, where I finally see the **"✦ Onboarding skill"** button in the header next
to Export PDF. Timed honestly: that's Governance → mental-note-repo-name → Fleet rail
group → Repositories tab → scan table → click repo → land on report → click "Onboarding skill" —
7 discrete navigations for something the journey's premise says should be reachable in one or two
hops from the fleet page that's already naming the repo. In a live browser that's maybe 20-30
seconds once you already know Repositories is where repo links live; the first time, before you've
learned that lesson, it's the kind of "wait, where did report pages even live" hunt that costs
real minutes — confirming F2 live, not just in the code.

I click the Onboarding skill link. It's a plain `<a>` — no confirmation dialog, no on-page blurb
next to the button. There IS a native browser tooltip (`title` attribute) if I hover before
clicking: *"Download a personalized Claude Code onboarding skill (drop it in .claude/skills/ and
run it to act on this report)"* — that does hint it's something to *run*, not read, but it's a
passive hover tooltip most people miss entirely (nothing forces a hover before a click), and it
still doesn't say the words that would actually calibrate me: "this ships with TODOs you're
expected to fill by running it." I only learn that once I open the downloaded file and read its own
guardrails section. So the expectation-setting exists, but only inside the artifact, with a weak
outside echo — not the "stated before I click" bar the L1 priority asked me to check.

Last stop: `/org/[slug]/skills`, under Library. Copy: *"Your org's reusable Claude/LLM skills —
author once, the whole team discovers and reuses them. Copy a skill into Claude Code, or download
it as a SKILL.md."* Token minting scopes: Read/download, Register/update, Report usage. Nowhere on
this page — not in the intro copy, not near the token panel — does it say whether a skill pushed
here becomes (or feeds, or is unrelated to) the gate policy and `.ai/` standard I just spent ten
minutes setting on Governance and Practices. It reads as its own product ("a skills library"), full
stop. If I actually minted a token today and wired a team's local Claude skill to push here, I
would have zero live confirmation whether that connects to my rollout at all — confirming F3 live.

## 2. Findings — live evidence

```
F1 (confirmed at L1, RECONFIRMED LIVE with stronger evidence)
id: priya-set-enforce-standard-l2-f1
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L2
type: quality-gap
severity: major
impact: { frequency: high, reachability: high, trust_erosion: high }
dimension: trust
title: Governance's own copy states the flat-policy design as a feature, and the live
  fleet already mixes archetypes under it
expected: A gate she can make archetype-aware (per her scored criterion), or at minimum a UI
  that doesn't actively assert "one bar for every repo" as the selling point.
got: Governance page text (live): "One maturity gate, applied as policy-as-code to every repo
  in the fleet" and "The bar every repo is held to — change it once, enforce it everywhere."
  The Edit-policy form (live ARIA: combobox "Minimum level" any/L1-L5, spinbuttons for
  min-overall/min-per-dimension, 3 checkboxes) has no archetype control. The seeded vercel
  fleet genuinely mixes archetypes under this one policy: vercel/ai and vercel/next.js are
  tagged "Org / platform" on their report pages, vercel/v0-sdk is tagged "Team / product" —
  confirmed via live report-page captures, not inferred.
evidence:
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/01b-governance-2ndvisit.aria.yaml:36,41,46-66
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/04-report-v0sdk.text.txt:17 ("Team / product")
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/06-report-ai.text.txt:17 ("Org / platform")
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/07-report-nextjs.text.txt:17 ("Org / platform")
  - src/lib/org/governance.ts:67,92 (ORG_POLICY_ARCHETYPE="org" hardcoded)
code_check: present-but-missed
verdict: confirmed
resolution: open
ceiling: n/a (open finding, not resolved)
note_to_self_honesty_check: for THIS fleet's 3 currently-failing repos the gap sizes are large
  enough that a 35-vs-40 archetype floor difference would not flip any of them pass/fail today
  — so live PRACTICAL damage on this exact seed is zero right now. The finding is the missing
  mechanism, which will bite the first time a team-archetype repo is borderline (a realistic,
  not edge-case, future state for any fleet Priya's size).
```

```
F2 (confirmed at L1, RECONFIRMED LIVE + timed)
id: priya-set-enforce-standard-l2-f2
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L2
type: confusion
severity: major
impact: { frequency: high, reachability: high, trust_erosion: med }
dimension: clarity
title: No link from Governance or Practices to a gap repo's report/onboarding-skill page —
  confirmed live, 7-hop path measured
expected: Given Governance/Practices already list the gap repo by name (v0-sdk), a direct link
  to that repo's report/standard, per the journey's discovery hint.
got: On Governance, "Failing repos" shows "vercel/v0-sdk" as plain text (not a link) in the ARIA
  tree. On the Practices modal, "Could adopt next (1) v0-sdk" is also plain text — only the
  EXEMPLAR repo ("workflow") is a link, to /report?repo=vercel%2Fworkflow. The only path to the
  gap repo's own report page is: Governance/Practices (read repo name) → leave Govern/Plan →
  Fleet rail group → Repositories tab → scan table for the name → click it → land on
  /report/vercel/v0-sdk → click "Onboarding skill". Measured as 7 discrete navigations from
  where the journey's own discovery hint says she'd start looking.
evidence:
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/01b-governance-2ndvisit.aria.yaml:72,77,80 (repo names as
    plain "text", not "link")
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/03-practice-modal.aria.yaml:139-141 ("Could adopt next (1)
    v0-sdk" plain text vs. "workflow" which IS a link)
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/05-repositories.aria.yaml:184-186 (repo name link only
    exists on the separate Fleet > Repositories table)
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/04-report-v0sdk.aria.yaml:32-33 (Onboarding skill link,
    only reachable after landing on /report)
code_check: present-but-missed
verdict: confirmed
resolution: open
```

```
F3 (confirmed at L1, RECONFIRMED LIVE)
id: priya-set-enforce-standard-l2-f3
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L2
type: trust
severity: minor
impact: { frequency: med, reachability: high, trust_erosion: med }
dimension: trust
title: /org/[slug]/skills never states its relationship to the gate/standard, confirmed live
expected: Explicit copy: does a skill pushed here become/feed the enforced .ai/ standard, or is
  it an unrelated library.
got: Live page copy in full: "Your org's reusable Claude/LLM skills — author once, the whole
  team discovers and reuses them. Copy a skill into Claude Code, or download it as a SKILL.md."
  Token-scope descriptions: "Read / download skills", "Register / update skills", "Report
  usage." No sentence anywhere on the page ties this to Governance's gate policy or the
  standard generated on /report. Page presents as a self-contained "skills library" product.
evidence:
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/08-skills.text.txt:29-58 (full page copy)
code_check: confirmed-absent
verdict: confirmed
resolution: open
```

```
F4 (confirmed at L1, RECONFIRMED LIVE — nuanced: disclosure exists but is weak)
id: priya-set-enforce-standard-l2-f4
journey: set-and-enforce-the-standard
character: priya-platform-lead
cert_level: L2
type: confusion
severity: minor
impact: { frequency: med, reachability: high, trust_erosion: low }
dimension: senior-quality
title: The scaffold/TODO expectation is set only in a hover tooltip, not on-page before the click
expected: A stated expectation ("this is a starter scaffold — run it through an agent to
  finish") visible BEFORE the click, not discovered only after downloading and reading the
  file's own guardrails section.
got: The live button is a plain <a href="/api/report/skill?..."> with a native `title`
  attribute: "Download a personalized Claude Code onboarding skill (drop it in .claude/skills/
  and run it to act on this report)" — a passive hover-only tooltip, no modal, no inline copy
  near the button, no confirmation step. Confirmed by reading the rendered ARIA link (title
  attributes don't surface as accessible description in the captured snapshot, so a
  screen-reader/non-hover user gets zero warning) and the component source directly.
evidence:
  - src/components/report/ReportHeader.tsx:99-105 (title attr, no other disclosure)
  - uat/runs/2026-07-16-full-sweep/shots-priya-l2/04-report-v0sdk.aria.yaml:32-33 (link exposes no
    description in the accessibility tree — title isn't surfaced)
  - downloaded uat/runs/2026-07-16-full-sweep/shots-priya-l2/v0sdk-skill.md — the TODO/guardrail framing
    only appears starting at line ~47 of the file itself
code_check: present-but-broken
verdict: confirmed
resolution: open
```

No new (L1-missed) findings surfaced — the surface model held. The one place L1 slightly
under-specified was F2: L1 flagged the SKILL.md button as undiscoverable from fleet pages, but
didn't note that the repo NAME itself is unlinked on Governance/Practices (L1 read
`ReportHeader.tsx` and the report/skill route but didn't check whether `governance/page.tsx`'s
repo-name cells render as `<Link>` or plain text) — L2 sharpened this into the concrete 7-hop path.
That's a refinement of an existing finding, not a new surface-model gap.

## 3. Adversarial verification pass

- **F1** — could a skeptic say "the flat policy never actually produces a wrong verdict, so who
  cares"? I checked: on this exact seed, correct — none of the 3 failing repos would flip under a
  35-floor. But the *design* claim ("one bar, apply everywhere," verbatim in the UI) is what fails
  her criterion, independent of today's numbers, and the mixed-archetype fleet proves it's not a
  hypothetical setup. **CONFIRMED**, with the practical caveat now explicit in the finding itself
  (honesty requirement met).
- **F2** — could this be "she just didn't look at Repositories"? No — the point isn't that the path
  doesn't exist, it's that neither surface the journey's own hints point her to (Governance,
  Practices) links the named repo at all; I measured the actual hop count live. **CONFIRMED.**
- **F3** — could the relationship be implicit/obvious from context (e.g., "of course it's the same
  standard")? No — the two artifacts (`.ai/manifest.yaml`+SKILL.md vs. the Skills Library's
  arbitrary named skills) are architecturally different systems in the code
  (`src/lib/standard/` vs `src/app/api/org/skills/*`); nothing on the page even asserts they're
  related, so a skeptical Priya reading only the page has no way to know. **CONFIRMED.**
- **F4** — could a skeptic say "hover tooltips are a normal, sufficient pattern"? For a power user
  who reads carefully, maybe — but her scored criterion is specifically about avoiding the
  "boilerplate with TODOs as the deliverable" trap, and a title attribute that most people click
  through without hovering is a genuinely weak signal for that specific risk, especially since the
  ARIA tree exposes no description at all (screen-reader/keyboard users get nothing).
  **CONFIRMED**, downgraded to minor/present-but-broken rather than confirmed-absent since some
  disclosure does exist.

## 4. Scored acceptance criteria — L2 verdict

- [x] Fleet conformance visible and reconciles — confirmed live (pass rate, failing reasons,
  cheapest-path-to-green all rendered from one rollup).
- [x] Path to green, not just a red list — confirmed live: `closestToGreen` links deep to
  `/practices#practice-{id}`, and the Practices modal's "Preview starter"/"Apply to a repo" flow
  is real and produces genuinely repo-specific content (verified by downloading the actual
  SKILL.md for v0-sdk).
- [~] One policy, no drift — confirmed live between dashboard/CI-snippet/gate-query (identical
  `L3 / min_dimension=40 / no_ungoverned=1` values in all three renderings on the same page); NOT
  confirmed across archetypes — same partial-pass as L1, now with concrete live numbers (F1).
- [ ] Gate is archetype-aware — **fails live**, exactly as L1 predicted, now proven against a
  real mixed-archetype fleet (F1).
- [~] `.ai/` standard is repo-specific and senior-grade — content quality confirmed live
  (downloaded, genuinely grounded, correct control-model framing, explicit no-fabrication
  guardrail); discoverability from the fleet confirmed broken live, worse than L1 estimated (F2:
  repo names themselves are unlinked, not just the SKILL.md button).
- [x] Starter PR / practice artifact leak-free and mergeable — not independently re-verified at
  L2 beyond confirming the modal flow renders correctly; no new evidence against L1's pass.
- [~] Authored/rolled out in minutes — the fleet-read leg is genuinely ~5-10 min live; the
  standard-fetch leg costs a real, measured 7-hop detour per gap repo (F2) — net still faster
  than a manual audit, but not the "minutes, frictionless" bar for that half.
- [x] Score reads as friction-to-remove — confirmed live, same repo-level (never per-engineer)
  framing throughout.
- [x] No fabrication — confirmed live by reading the actual downloaded SKILL.md content.
- [ ] Skill-sync states its relationship to the standard — **fails live**, confirmed absent (F3).

## 5. Priya's voice — the live verdict

*"Alright, I actually went and clicked through it instead of reading the code, and my read from the
transcript mostly holds — with receipts now. The Governance page LITERALLY tells me 'one bar,
change it once, enforce it everywhere' in its own copy. That's not a bug I'm inferring, that's the
product stating its own limitation as a tagline. And I didn't have to imagine a mixed-archetype
fleet to prove it matters — this exact seeded org has an 'Org / platform' repo (vercel/ai) and a
'Team / product' repo (v0-sdk) sitting in the same failing-repos list under the same policy card.
Today the gap sizes are big enough that it doesn't change any verdict — I'll give it that, credit
where due — but the day one of my team-tier repos is borderline, I'm the one arguing with a staff
engineer about why their scratch-tier repo needs the same D1 floor as our platform SDK, and the
tool gives me no lever to fix that. That's the exact fight I told you I built a scorecard tool to
avoid.

"The standard hunt was worse live than it read on paper. I know the repo's name from Governance —
v0-sdk — and there is NO link on that page, and NO link on the Practices modal either. I had to
leave the section I was in, go to Fleet, go to Repositories, scan a table, click the name, THEN I'm
on the report page, THEN I see the onboarding button. Seven stops for something you already know
the name of. Once I download it, the content itself is good — genuinely this repo's real scores,
real archetype language, an actual pre-push/CI framing I'd write myself — so the machinery isn't
the problem, the map to it is.

"And nobody told me before I clicked that the file I was about to get is a scaffold I still have to
run through an agent. There's a tooltip if I hover — fine, but I don't hover, I click, and half my
staff engineers won't either. Tell me on the page: 'This is a starter — drop it in
.claude/skills/ and run it; some sections are marked TODO by design.' One sentence. You already
wrote that sentence — it's just hiding inside the file instead of next to the button.

"And the Skills page — I minted zero tokens today because I genuinely don't know if pushing a
skill there is my standard, or SOME OTHER standard my teams could quietly diverge into. That's not
a minor copy nit for me, that's the exact 'two sources of truth' scenario I have a pet peeve about
by name. Say the sentence, whichever way it's true, and I'll trust it either way.

"Bottom line, unchanged from the code read but now with confidence instead of a hunch: I'd ship the
practices rollout tomorrow. I'd fix the archetype gate and the discoverability hop before I put my
name on the rest. It's close — closer than most things I've evaluated — but 'close' isn't 'shipped'."*

## 6. Verdict inputs

- **Journey definition-of-done**: NOT fully met live. Two of five DoD bullets fail outright
  (archetype-aware gate; SKILL.md discoverable in minutes from the fleet surfaces), one is
  partial (skill-sync relationship unstated). The core "fleet read" and "path to green" bullets
  ARE met live and are genuinely strong.
- **Estimated time-saved, re-measured against the live experience**: the Governance+Practices
  fleet read is genuinely ~8-10 min live (confirmed, matches L1's estimate). The per-repo standard
  fetch is where L1's estimate needs revising DOWN: L1 guessed "3-5 min each once found"; live,
  the *finding* step alone (not generation, which is instant) cost ~1-2 min of real navigation
  per repo the first time, on top of the fetch — call it 4-6 min/repo once you've learned the
  Fleet→Repositories detour, longer the very first time. Over 3 failing repos that's roughly
  15-20 min of pure navigation tax that a fleet-surface link would collapse to near zero. Net
  estimate: **~150 minutes saved** (vs. L1's conditional ~180) for a first-pass rollout across
  the 3 gap repos in this seed — still a wide margin over the "day per repo" manual-audit
  baseline, but the discoverability tax measurably eats into the promised "minutes."
- **Grounding score**: unchanged from L1 at the artifact-content level (5/6, confirmed by reading
  the actual downloaded SKILL.md) — L2 didn't find new grounding gaps, it found delivery/UX gaps
  around a genuinely well-grounded artifact.
