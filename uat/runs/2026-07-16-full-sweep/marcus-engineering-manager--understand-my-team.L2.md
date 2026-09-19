# L2 (empirical, live) — Marcus (Engineering Manager) × "Understand my team"

cert_level: L2 · date: 2026-07-16 · env: `npm run dev` (already running, reused) · seed: `vercel` org already seeded (`/org/vercel`, 6 repos, 54 contributors) via `scripts/seed-org.mjs` · driver: `uat/driver/drive.mjs` (no browser MCP connected this session — extension not installed/logged in) · one live `claude-cli`/Sonnet scan triggered directly for the roadmap-phrasing check

L1 verdict carried in: **L1-conditional**, majors: F1 (`#1 ★` rank badge). L2 priorities from the L1 report: (1) does the champions badge visually read as a leaderboard live, (2) is the Contributors-vs-Adoption framing inconsistency visible/confusing, (3) does the "simulated spend" badge register before a skim, (4) does the org-level adoption number/bus-factor table reconcile with a real seeded org in <2 min, (5) does the live LLM roadmap read invitational.

---

## 1. Journal (first-person, in character)

I reuse the running dev server (health check 200) and go straight to `/org/vercel/contributors` — that's my Thursday-before-the-skip-level habit, and `vercel` is the org this environment has seeded (54 real contributors across 6 repos — bigger than my actual two squads of ~12, but it's what's here, so I read it as if it were mine).

Tiles load instantly: 54 contributors, 19% AI-active, 18% org AI commit share, 0 solo-maintainer repos. That's a sentence I could say to Dana in the time it takes to say it — good.

Then the champions grid. And there it is, rendered exactly as the code promised: **`dnukumamras  #1 ★`** in bold blue, top-right corner of a bordered card, a progress bar underneath. Five more cards follow the same pattern down to `#6 ★`. The softening line — "exemplars whose approach the team could learn from" — sits as one paragraph *above* the whole grid, not attached to each card. In an actual skim (which is exactly how I'd read this before a meeting) my eye lands on the rank number and the name before it ever reaches that sentence. This is not a subtler leaderboard than the code suggested — visually it is *more* leaderboard-y than I expected: three-column grid, bold rank badge, star, progress bar. It reads exactly like an app-store top-chart or a fantasy-sports card. My pet peeve, unsoftened, at a glance.

I drift to Adoption, curious whether the org fixed this anywhere. Same six names, same underlying percentages (dnukumamras 100%, karthikscale3 71%, gr2m 75%...) — but rendered as a plain "AI champions" meter list, no rank number, headed "Culture carriers." So somebody on this team already made the right call once. It just didn't propagate to the tab I hit first. If Dana lands on Contributors before Adoption — and there's nothing steering her there first — she sees the scoreboard version.

Back to Contributors for the bus-factor table: repo, contributor count, top contributor, top-share meter, bus-factor number, decision column. Genuinely good — v0-sdk's alex-grover at 44%/bus-factor 2, vercel itself at 19%/bus-factor 4. No repo actually hit bus-factor 1 in this seed, and the tile up top confirms "0 solo-maintainer repos" — that number reconciles with the table instantly, no mental math required. Individual involvement is still collapsed behind "NAMES INDIVIDUALS — EXPAND." I didn't force it open (opt-in is opt-in) — a driver click on that control timed out, consistent with it being a native `<details>` toggle rather than a button.

Delivery tab: "SIMULATED SPEND" sits as a labeled pill right next to the Table/Map toggle — same visual weight as the tabs beside it, not hidden. I scroll down expecting to have to squint at a dollar figure with fine print. Instead: AI spend/mo, Cost/AI PR, Idle spend/mo, and Ungoverned/mo all render as a flat gray **"—"** with "connect a provider" underneath. There's no dollar amount here at all to misread — the only real numbers on this module are AI reach (20%) and Governed AI (63%), both plainly disclosed as git-derived. The takeaway sentence spells it out too: "Spend, idle, and ROI are a deterministic sample until you connect a provider." I was ready to catch myself grabbing a screenshot of a fake number — there's nothing to grab. I was wrong to worry about this one.

Adoption tab's "Team adoption" panel gives me exactly the one move I said I wanted: `workflow` team at 35% AI share vs several teams flat at 23% — a real, cited gap I'd actually raise in a retro, not "add more tests."

Then I click through to a team repo report and, separately, trigger a fresh live scan on a small public repo to see what the real model says when it isn't a cached demo. The live roadmap items read like a peer wrote them: "What would you want a new AI contributor to know before it touches source/core/Ky.ts?" / "Would enabling Dependabot security updates or CodeQL change how much routine dependency churn could be delegated to automation?" — every "explore" bullet is a question, not an instruction. Nothing said "add X." That's the bar.

## 2. Code cross-checks

- **F1 (rank badge)** — `src/app/org/[slug]/contributors/page.tsx:29-31` renders `<span>#{i + 1} ★</span>`. Live render confirms it exactly: bold, colored, top-right of each card, 3-up grid. `code_check: present-as-designed`.
- **F2 (Contributors vs Adoption inconsistency)** — `ChampionsGrid` (ranked) vs `adoption/ChampionsCard.tsx:38-51` (unranked meter list) render simultaneously live, same underlying six names/percentages, different framing. `code_check: confirmed-present`.
- **F3 (simulated spend disclosure)** — re-read `src/components/org/delivery/ai/AiRoiLedger.tsx:16-40,93-119`: when `model.fidelity === "simulated"`, every `$`-cell renders `locked` → literal `"—"` + `"connect a provider"` subtext (`Money` component, line 33-36), and the takeaway paragraph (112-127) states plainly "Spend, idle, and ROI are a deterministic sample." There is no fabricated dollar figure anywhere in this state — L1's specific worry ("$4,200/mo idle spend") cannot occur; idle/ungoverned spend show `"—"` too when simulated, not a placeholder dollar amount. `code_check: present-but-L1-overstated-the-risk`.
- **F5 (live roadmap phrasing)** — triggered a real scan (`POST /api/scan {"url":"https://github.com/sindresorhus/ky","mock":false}`, `engine: {provider: "claude-cli", model: "sonnet"}`, confidence 0.85, ~162s wall time). Returned `roadmap[]` items are uniformly phrased as questions ("What would you want...", "Would...", "Is there appetite for..."), matching `src/lib/scoring/prompt.ts`'s SYSTEM-prompt instruction. `code_check: confirmed-present, live-verified`.

## 3. Findings (L2)

- **F1 — MAJOR — CONFIRMED (upgraded confidence) — the champions rank badge visually reads as a leaderboard, more so than the code alone suggested**
  - evidence: `uat/runs/2026-07-16-full-sweep/shots/contributors_1.png` — `#1 ★` … `#6 ★`, bold blue, top-right of bordered cards in a 3-column grid, progress bar under each; the softening sentence ("exemplars whose approach the team could learn from") is one paragraph above the whole grid, not per-card.
  - `file:line`: `src/app/org/[slug]/contributors/page.tsx:29-31`
  - `verdict`: confirmed. A skeptic's refutation attempt — "surely the intro copy reframes it before you reach the cards" — does not hold: in a skim (the Character's actual behavior), the eye reaches the rank badge before the intro sentence registers, and the badge carries no context of its own.
  - `l2_priority` resolved: reads as a leaderboard live, not softened in practice.
  - `suggested_acceptance`: drop the `#{i+1}` ordinal (Adoption's `ChampionsCard` proves the same data reads fine unranked); if a distinction badge is wanted, move it inside each card next to the softening language, not as a floating rank number.

- **F2 — MINOR — CONFIRMED — Contributors and Adoption tabs visibly disagree on ranking framing for the same data**
  - evidence: `uat/runs/2026-07-16-full-sweep/shots/contributors_1.png` (ranked grid) vs `uat/runs/2026-07-16-full-sweep/shots/adoption_1.png` (unranked meter list, same six names/percentages, labeled "Culture carriers")
  - `file:line`: `src/app/org/[slug]/contributors/page.tsx:18-44` vs `src/components/org/adoption/ChampionsCard.tsx:38-51`
  - `verdict`: confirmed, live-visible within the same 2-minute skim.

- **F3 — REFUTED at L2 (downgrade from L1's "confirmed minor")** — the specific "screenshot a fake dollar figure without noticing the badge" risk does not occur
  - evidence: `uat/runs/2026-07-16-full-sweep/shots/delivery_1.png` — AI spend/mo, Cost/AI PR, Idle spend/mo, Ungoverned/mo all render as `"—"` (locked, gray) with "connect a provider" underneath; `"SIMULATED SPEND"` is a header-level pill with the same visual weight as the Table/Map toggle, not a small tooltip. Confirmed in code: `src/components/org/delivery/ai/AiRoiLedger.tsx:33-36` (`locked ? "—" : value`).
  - `verdict`: refuted. L1 was right that provenance disclosure exists, but wrong about the failure mode — a skimming Marcus has no plausible fake number to misquote to Dana; the module shows dashes, not sample dollars. Ceiling that remains: `AI reach` (20%) and `Governed AI` (63%) tiles are real and unlocked, so if Marcus skims *only* those two numbers without reading "SIMULATED SPEND" at all, he could still believe the whole module (including the greyed dollar tiles he'd have to actively misread as data) is live — but there's no concrete dollar figure to misquote, which was the finding's actual scenario.

- **NEW (L2, surface-model gap L1 didn't flag) — MINOR — the seed tooling cannot produce a Marcus-shaped ("~12 engineer") org fixture; only real public GitHub orgs are seedable**
  - evidence: `scripts/seed-org.mjs` usage (`node scripts/seed-org.mjs <org> [count]`) only imports a real public GitHub org's repos; the only available seeded org (`vercel`) has 54 real contributors across 6 repos, not a ~12-person team. `uat/env.md`'s own example org is `vercel`.
  - `type`: confusion (test-harness), not a product defect. `dimension`: n/a (env/fixture).
  - `verdict`: confirmed as a testability gap, not a product finding. The numbers *do* reconcile internally (19% AI-active / 18% commit share match identically across Contributors and Adoption tabs, and the bus-factor table's "0 solo-maintainer repos" tile matches all six table rows showing bus-factor ≥2) — so JTBD #1's "reconciles in under 2 minutes" criterion is satisfiable in principle and was satisfied here in well under a minute. But a literal "does this match what I know about my 12 direct reports" check is untestable with the current seed tooling; `env.md` should note this limitation or the character's acceptance criteria should be read as "internally consistent," not "matches a specific headcount."

- **F5 — STRENGTH — CONFIRMED live — the AI-generated roadmap is genuinely invitational, not directive**
  - evidence: live `claude-cli`/Sonnet scan of `sindresorhus/ky` (`engine: {provider: "claude-cli", model: "sonnet"}`, confidence 0.85). Sample `explore` items: *"What would you want a new AI contributor to know before it touches source/core/Ky.ts or the hooks system?"*, *"Would enabling Dependabot security updates or CodeQL change how much routine dependency churn could be delegated to automation?"* — every item is phrased as a question, none as a command.
  - `file:line`: `src/lib/scoring/prompt.ts:109-150` (SYSTEM prompt enforcing this), live-verified via `POST /api/scan`.
  - `verdict`: confirmed. This directly answers l2_priority #5 with a real (non-mock) model call, not just the prompt's stated intent.

## 4. What passed live (reconfirming L1 strengths)

- Bus-factor / concentration table: real numbers, reconciles with the summary tile instantly, framed as risk-to-explore, keyed by repo not person. (`uat/runs/2026-07-16-full-sweep/shots/contributors_1.png`)
- Individual involvement stayed collapsed by default (opt-in `<details>`), consistent with L1.
- Adoption tab's "Team adoption" panel surfaced one real, cited team-level move (`workflow` 35% vs several teams flat at 23%). (`uat/runs/2026-07-16-full-sweep/shots/adoption_1.png`)
- Org AI-adoption numbers (19% AI-active, 18% commit share) are identical on both Contributors and Adoption tabs — no reconciliation gap between the two surfaces that show the same underlying number.
- Live LLM roadmap output is grounded and invitational (see F5).

## 5. Adversarial re-check summary

| finding | L1 verdict | L2 verdict | changed? |
|---|---|---|---|
| F1 (rank badge) | confirmed, major | confirmed, major (stronger — visual is worse than code text alone implied) | reinforced |
| F2 (tab inconsistency) | confirmed, minor | confirmed, minor | unchanged |
| F3 (simulated spend skim risk) | confirmed, minor | **refuted** | downgraded |
| F5 (invitational roadmap) | strength (code only) | strength (live-verified) | reinforced |
| new: fixture headcount mismatch | not flagged | new minor/testability finding | new |

---

## 6. Character voice — live verdict

Okay. I went in ready to be annoyed about one thing and mildly annoyed about a second, and I came out annoyed about the first, unbothered about the second, and pleasantly surprised about a third.

The `#1 ★` thing is real, and seeing it rendered made it worse, not better. It's not a subtle numeral in a footnote — it's a bold blue rank sitting on top of a bordered card, three to a row, with a progress bar under it, right next to a person's actual name and GitHub handle. I don't need to read the sentence above the grid to know what that is. I've seen this shape before — it's the shape of every gamified leaderboard I've ever had to explain away in a 1:1. And I already know, because I clicked over to Adoption, that this product's own team figured out how to show the exact same information without the rank number. That's the part that actually bugs me — not that the leaderboard exists, but that its unranked twin sits one tab over. If I show Dana this dashboard, I will open Adoption first and steer around Contributors until this gets fixed, or I'll screenshot the meter list and never let her near the champions grid.

The spend badge, though — I take that one back. I went looking for a fake number to catch someone forwarding without reading, and there isn't one. It's dashes. Actual dashes, with "connect a provider" written right there. I'd trust this team more, not less, for that — it's the opposite of the last vendor who quoted us a "productivity score" with no denominator.

And the roadmap read — I ran a real scan on an unrelated repo just to see what the model actually says when it isn't the canned demo, and it held up. "What would you want a new AI contributor to know before it touches this file" is a question I would ask in a design review. That's not a checklist generator, that's a colleague.

Net, same as L1 but sharper: I'd use the bus-factor read and the single-repo report today, without hesitation — that part earned its two minutes and then some. I'd hold off putting the Contributors tab in front of Dana specifically, not the whole product, until that rank badge is gone — and now that I've seen it live, that's not a maybe, that's a blocker for that one screen.
