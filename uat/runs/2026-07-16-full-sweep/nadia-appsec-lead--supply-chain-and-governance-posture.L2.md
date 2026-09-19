# L2 report — Nadia (AppSec Lead) × Supply Chain & Governance Posture

cert_level: L2 · empirical, live app (`http://localhost:3000`, PGlite, `ASCENT_AUTH_BYPASS=1`, org `vercel`)

## 0. Start-state notes (env drift found before driving)

`GET /api/health` was already 200 (reused the running server; did not spawn a second). Before touching the app, I checked `.env.local` against `uat/env.md`'s claim that `SUPPLY_CHAIN_PROVIDER=mock` is "pinned" alongside the other UAT vars.

**It wasn't.** `.env.local` had `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`, `LLM_PROVIDER=claude-cli`, etc., but no `SUPPLY_CHAIN_PROVIDER` line at all — which defaults to `"off"` (`src/lib/security/supply-chain.ts:118`, `?? "off"`). I confirmed this live: fetching `/org/vercel/security` *before* any change returned zero occurrences of the string `Advisories` anywhere in the page — under `off` mode `advByRepo` is `null` and the whole column doesn't render (matches the L1 code read that the column is conditional). That is actually a *stricter* posture than "demo counts with no label" — under the environment as it actually shipped, Nadia would see no advisory data at all, not mislabeled advisory data.

To test the journey's own pinned condition (and L1's `l2_priority` #1, which explicitly needs `SUPPLY_CHAIN_PROVIDER=mock`), I added `SUPPLY_CHAIN_PROVIDER=mock` to `.env.local` (git-ignored, no repo impact — `.gitignore:42`) and restarted the dev server (killed the old process, `npm run dev` again, re-polled `/api/health` to 200 in ~4s). This is a real, if minor, finding in its own right: **the documented start-state recipe (`uat/env.md`) doesn't match what's actually in `.env.local`** — anyone following the recipe literally gets the `off` (safer but different) experience, not the `mock` one the journey and Character file assume.

## 1. Journal (in character, live)

I open `http://localhost:3000/org/vercel/security` fresh — the tiles (Avg D9, branch-protection %, repos at risk, gate) render fast, no spinner wait worth mentioning. The risk register table loads with an **Advisories** column now populated: rows like "1C 3H (11 total)" for `workflow`, "3H (8 total)" for `v0-sdk`. I read the column header itself — `Advisories<span aria-hidden="true">↕</span>` — a plain sortable label, nothing else next to it. I scan the tile row above the table and the page's top banner area: no chip, no asterisk, no tooltip icon, no "(demo)" suffix anywhere near the numbers. If I were doing this for real, I'd have no way — from this screen alone — to tell these apart from live Dependabot pulls. I only find the truth by clicking "Copy for LLM": the markdown payload that gets built (I inspected the underlying HTML/RSC output directly, same content that button copies) reads `## Supply chain (Dependabot — demo data)`. That confirms it exactly the way L1 predicted: the *only* disclosure is one heading two clicks deep in an export I wasn't going to open unless I already suspected something.

I also confirm the degraded-fetch banner logic is a separate, honest thing — good, that's a different code path (`supply.degraded`) and I'm not touching it here since mock mode never sets it.

Next, Governance. I click the nav item literally called "Governance" expecting my CC6.1/CC8.1 enforcement coverage. What renders: "Gate pass rate," "Where the fleet fails," a "Failing repos" list with reasons like "Below required level," "A dimension below floor," "Unprotected default branch" mixed in as one line among several, and a "Cheapest path to green" worklist, plus "Copy governance brief for LLM" / "Copy CI snippet" buttons. I looked for `protectedRate`, `requireReviewRate`, `requireChecksRate`, `signedRate` as visible tiles or labels — none of those strings, or their human names, appear anywhere on this page. This is a CI maturity-gate scoreboard, not a branch-governance coverage report. I do not find what I came for on this tab.

I go looking elsewhere — because I already have Ascent open and I'm mildly annoyed, not stuck — and land on Delivery. There it is: a "Branch governance" section with tiles literally named "Protect main," "Require review," "Require checks," "Signed commits," plus "Fully governed repositories" and a table with per-repo rows, "Protected"/"Reviewed"/"Checks"/"Signed" columns, and — I confirmed this directly in the markup — real `Fix on GitHub` links pointing at `.../settings/branches` for the repos that fall short. That's exactly my SOC 2 evidence artifact. It's just filed under a tab named for delivery velocity, not governance or security, which is not where my mental model would ever have taken me first.

Last: the audit trail, and specifically the actor-attribution fix. I don't have a second real teammate account to demote, so I exercised the actual code path the fix touches — I called the same API the Members UI calls (`POST /api/org/members`) to add a test member and then change their role, twice, same-origin, as the seeded "developer" owner would from the UI. Both role-change audit rows came back with `"actorId":"developer"` — not null. I pulled the same rows via the CSV export (`format=csv`) and got matching rows, a `x-ascent-content-sha256` integrity header, `x-ascent-row-count: 2`, `x-ascent-truncated: false` — no silent capping, a real actor on every row. I removed the test member afterward so the seeded org isn't left with debris.

## 2. Findings (L2)

```json
[
  {
    "id": "L2-NADIA-SCG-01",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L2",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Live-confirmed: SUPPLY_CHAIN_PROVIDER=mock advisory counts render on /org/vercel/security's Advisories column with zero on-screen demo indicator; the only disclosure is a heading buried in the 'Copy for LLM' export",
    "expected": "Per her acceptance criterion #3, any surface showing mock advisory counts is honestly labelled wherever a human reads it.",
    "got": "Live HTML for /org/vercel/security under SUPPLY_CHAIN_PROVIDER=mock: Advisories column header markup is `Advisories<span aria-hidden=\"true\">↑↓</span>` — no badge/tooltip/text nearby. The export markdown (verified via the same RSC payload the Copy-for-LLM button reads) carries `## Supply chain (Dependabot — demo data)` and is the ONLY occurrence of 'demo' on the whole page load.",
    "evidence": [
      "Live fetch of /org/vercel/security (2026-07-16, SUPPLY_CHAIN_PROVIDER=mock, restarted server) — grep for 'Advisories' shows only the plain column header, no demo marker",
      "Live fetch same page — grep for 'demo data' finds exactly one hit, inside the embedded '## Supply chain (Dependabot — demo data)' export string",
      "src/lib/security/supply-chain.ts:27 (demo field) / src/lib/org/security.ts:240 (only read site) — code-confirms this is architecturally the only consumer"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "n/a (open, not resolved)"
  },
  {
    "id": "L2-NADIA-SCG-02",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Live-confirmed: /org/vercel/governance shows only CI maturity-gate content (Gate pass rate, Failing repos, Cheapest path to green); protectedRate/requireReviewRate/requireChecksRate/signedRate tiles are absent from this page and live instead on /org/vercel/delivery under 'Branch governance'",
    "expected": "Per criterion #4, the page named 'Governance' in the nav shows branch-protection/review/checks/signed enforcement coverage with named falling-short repos.",
    "got": "Live text extracted from /org/vercel/governance: 'Gate pass rate', 'Where the fleet fails', 'Failing repos', 'Cheapest path to green', 'Unprotected default branch' (one failure-reason line among several). None of: 'Protect main', 'Require review', 'Require checks', 'Signed commits' appear. Those exact labels + a 'Fix on GitHub' → settings/branches link per named repo DO appear live on /org/vercel/delivery.",
    "evidence": [
      "Live fetch /org/vercel/governance — text-string extraction shows CI-gate vocabulary only, no enforcement-rate tiles",
      "Live fetch /org/vercel/delivery — text-string extraction shows 'Branch governance', 'Protect main', 'Require review', 'Require checks', 'Signed commits', 'Fully governed repositories'",
      "Live fetch /org/vercel/delivery — grep confirms literal strings 'Fix on GitHub' and 'settings/branches' present in the served markup"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "n/a (open, not resolved)"
  },
  {
    "id": "L2-NADIA-SCG-03",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L2",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Live-confirmed: named-repo risk evidence is still reachable fast — the Security page's risk register lists repos (next.js, v0-sdk, workflow) with Gate/Advisories per row, and Delivery's GovernanceTable independently names every ungoverned repo with a direct fix link — so the sec.unprotected gap (SCG-03 from L1) doesn't independently cost her time",
    "expected": "She can get named-gap repos without a dead end, even though sec.unprotected itself never renders (L1 finding).",
    "got": "Live /org/vercel/security shows per-repo rows (next.js, v0-sdk, workflow) with Gate + Advisories columns. Live /org/vercel/delivery's GovernanceTable independently names ungoverned repos with 'Fix on GitHub' links. Total extra time to find named-gap evidence via these two paths: under a minute once she knows to check Delivery (see SCG-02 above for that specific friction).",
    "evidence": [
      "Live fetch /org/vercel/security — repo names 'next.js', 'v0-sdk', 'workflow' present in risk-register rows alongside Gate/Advisories text",
      "Live fetch /org/vercel/delivery — 'Fix on GitHub' / 'settings/branches' links present"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "The redundant path exists and works, but only after she's already found Delivery (SCG-02's friction) — it doesn't independently close the gap of sec.unprotected being absent from the Security page itself."
  },
  {
    "id": "L2-NADIA-SCG-04",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Live-confirmed FIXED: privilege-change audit rows resolve a real actor ('developer'), not null, and the CSV export matches with integrity headers",
    "expected": "Per the journey's flagged 'recently fixed' item and L1's l2_priority, a role change must audit with a real actor.",
    "got": "Drove POST /api/org/members twice (add 'nadia-test-auditor' as viewer, then promote to admin) same-origin as the seeded owner. GET /api/audit?org=vercel&action=org.member.role returned both rows with \"actorId\":\"developer\" (not null). The format=csv export matched, with x-ascent-content-sha256 set and x-ascent-truncated: false. Test member removed afterward (DELETE /api/org/members) to leave the seeded org clean.",
    "evidence": [
      "Live POST /api/org/members responses: {\"ok\":true,\"login\":\"nadia-test-auditor\",\"role\":\"viewer\"} then {...,\"role\":\"admin\"}",
      "Live GET /api/audit?org=vercel&action=org.member.role — both entries show actorId: developer, meta.newRole/prevRole correct",
      "Live GET .../api/audit?...&format=csv — matching rows + x-ascent-content-sha256 + x-ascent-row-count: 2 + x-ascent-truncated: false",
      "src/app/api/org/members/route.ts:63-72 (resolveViewerLogin fix, code-confirmed in L1, now confirmed live)"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "resolved-verified",
    "ceiling": "Confirmed only under ASCENT_AUTH_BYPASS's synthetic 'developer' viewer, which is exactly the local dev/UAT condition — the fix's real-world case (a genuine Supabase-authenticated GitHub login resolving instead of null) is not exercisable in this environment; the code path (resolveViewerLogin -> Supabase session -> GitHub login) is unchanged from what L1 read, so this is a reasonable proxy, not a live-Supabase-session confirmation."
  },
  {
    "id": "L2-NADIA-SCG-05",
    "journey": "supply-chain-and-governance-posture",
    "character": "nadia-appsec-lead",
    "cert_level": "L2",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "NEW (L2-only): uat/env.md documents SUPPLY_CHAIN_PROVIDER=mock as 'pinned' in .env.local alongside the other UAT vars, but it was actually absent — the real start state defaults to SUPPLY_CHAIN_PROVIDER=off, which hides the Advisories column entirely rather than mislabeling it",
    "expected": "Following uat/env.md's recipe literally reproduces the pinned mock-data condition the journey and Character file assume.",
    "got": "Fetched /org/vercel/security before any change: zero occurrences of the string 'Advisories' anywhere in the served page — supply-chain.ts:118 defaults unset SUPPLY_CHAIN_PROVIDER to 'off', under which advByRepo is null and the whole column is conditionally skipped (confirmed against src/app/org/[slug]/security/page.tsx's advByRepo-gated render). Had to add the line to .env.local myself and restart the server to reach the condition the journey's seed line and L1's l2_priority actually require.",
    "evidence": [
      "Read of .env.local prior to edit: no SUPPLY_CHAIN_PROVIDER line",
      "src/lib/security/supply-chain.ts:118 — `(process.env.SUPPLY_CHAIN_PROVIDER ?? \"off\")`",
      "Live fetch /org/vercel/security pre-edit — grep -o 'Advisories' returns no matches",
      "uat/env.md:37 — 'All of the above (plus LLM_PROVIDER=claude-cli and SUPPLY_CHAIN_PROVIDER=mock) are pinned in .env.local'"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "n/a — this is a recipe/documentation drift finding, not a product defect; the product behavior in either mode (off = no column, mock = unlabelled column) is internally consistent with its own code."
  }
]
```

## 3. Adversarial verification (would a skeptic refute these?)

- **SCG-01 (demo label gap):** A skeptic might say "maybe there's a tooltip on hover that a static HTML grep can't see." I checked the full column-header markup around `Advisories` (`Advisories<span aria-hidden="true">↕</span>`) and there is no `title=`, `aria-describedby`, or adjacent icon element in the DOM at all — nothing for a hover to attach to. Holds as **confirmed**, not refuted.
- **SCG-02 (governance tab mismatch):** A skeptic might say "maybe it's below the fold and my text extraction missed it." I extracted every quoted string literal from the full RSC payload (not just visible viewport text), which captures off-screen/lazy content too — `Protect main`/`Require review`/etc. are absent from that full set, present in Delivery's full set. Holds as **confirmed**.
- **SCG-04 (actor fix):** A skeptic might say "this only proves the bypass viewer resolves, not a real Supabase user." Correct — noted explicitly as the finding's `ceiling`. The code path itself (`resolveViewerLogin()`) is unchanged between the bypass and real-session cases per `src/lib/access.ts` (read at L1), so this is a reasonable but not 100%-conclusive live confirmation. Downgraded confidence is reflected in the ceiling, not the verdict.
- **SCG-05 (env drift):** A skeptic might say "maybe I mis-typed the grep." Re-ran the check twice (once before editing `.env.local`, producing zero `Advisories` matches; once after, producing populated rows) — the before/after contrast is the evidence, not a single grep. Holds as **confirmed**.

## 4. Character voice — the live verdict

I came in half-trusting this from the L1 read, and driving it live mostly confirmed rather than changed my mind — which itself tells me something: the gaps weren't theoretical, they're really there when I click.

The advisory-labelling gap is worse live than it sounded on paper, honestly, because I could *see* exactly how invisible it is. I loaded the page, I read the numbers, I looked for a marker with my own eyes (well, the rendered markup), and there is nothing. Not a faint gray badge, not a footnote asterisk, nothing. The only way I'd ever learn these are synthetic is by clicking an export button I use maybe once a quarter. That is not a rounding error — that is the scenario where I put a fabricated number in a SOC 2 binder because the product gave me no signal to stop and ask. Fix this before I trust the Security tab unattended, full stop.

Governance still stings the same way it did on paper, but live driving softened it slightly: once I actually went and clicked around, Delivery's Branch Governance table is *good* — genuinely screenshot-worthy, named repos, direct GitHub links, real enforcement percentages. The friction is real but it's a five-tab-hop annoyance, not a dead end. I'd file a "rename or cross-link this" ticket, not a "this doesn't exist" ticket.

The audit trail held up completely under a live hands-on test, not just a code read. I did the exact thing that used to break it — changed a role, twice — and got a real actor both times, with a CSV that carries integrity headers and doesn't lie about truncation. That's the part I'd stake my name on with the CISO today.

One more thing that only showed up because I actually drove this live: the environment I was handed didn't even match its own setup instructions — the demo advisory data wasn't turned on by default, meaning the "safe" version of this bug (no column at all) is what ships unless someone remembers to flip a flag. That's a process gap worth a note to whoever owns the UAT rig, separate from the product gap itself.

**Would I adopt it?** For the audit trail: yes, today, no reservations. For Security's advisory numbers: not until they're labelled — I will not risk putting an unmarked mock number in front of an auditor. For Governance: yes, but I'd bookmark Delivery, not Governance, and I'd tell my team the same.

**Is it worth the wait?** Everything here loaded in seconds — no latency complaint at all, this journey has no AI-generation wait to budget for.

**Would I tell a peer?** About the audit trail, immediately — that's the best export I've used from an internal tool. About the other two, only with the caveat "check the export before you trust the on-screen number, and go to Delivery for the enforcement rates."

## 5. Journey-level verdict

**L2-pass with two open majors carried forward, matching L1's conditional cert.** The audit-trail path (the strongest, and the one item L1 flagged as "recently fixed") is now **resolved-verified** live. The two majors from L1 (advisory demo-labelling, governance/delivery mislabeling) are **confirmed live**, unchanged in substance — the design and data are sound, the labelling/navigation gaps are real and would cost trust or time in a real audit. Nothing blocked her from completing the job end-to-end (she *can* get every number she needs, just not without the two frictions above), so this doesn't regress to a structural fail — it's the same conditional pass, now empirically grounded instead of theoretical.
