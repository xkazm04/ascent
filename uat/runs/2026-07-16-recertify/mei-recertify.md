# Recertify — Mei (OSS Maintainer) × "Badge my OSS repo"

date: 2026-07-16 · mode: recertify (targeted, post-fix) · base: http://localhost:3000 (running dev server reused, per instructions — not restarted)
prior run: uat/runs/2026-07-16-full-sweep/mei-oss-maintainer--badge-my-oss-repo.md
Decision on record: the production sign-in wall STAYS (cost control). Recertifying the honesty + discoverability fixes, not the wall.

## Journal

*(Mei, back for round two. Last time I closed the tab at the sign-in wall. This time I'm told two things changed: the wall now tells the truth, and the CI gate finally lives where I'd actually see it.)*

**1. The badge page.** I load `/badge` cold, no account, and below the generator there's a new section I couldn't have missed: **"Guard it in CI — no account needed."** That headline alone answers my #1 suspicion — no account needed, stated up front, on the one page a solo maintainer actually visits. It shows both halves of what I need: the raw gate API line (200 pass / 422 fail, curl --fail semantics — exactly how Scorecard-style gates should behave) and the ready-to-paste GitHub Action YAML. Last run I said "put that action.yml snippet on the badge page next to the Markdown I'm already copying and I'd wire it up tonight." It's there now.

**2. The locked dialog copy.** I can't see the locked dialog live here — this dev environment runs with the auth bypass, so the wall is off (`gated: false` in the page payload) and the modal always shows the open scan form. Reading the shipped code instead: the locked panel now says *why* (each scan spends real AI analysis), that public-repo scans stay free once signed in, and — the line that matters to me — that "No account is needed to view already-scanned reports, badges, or the CI maturity gate." That no longer contradicts the unlocked branch's "Public scans never need an account," because that sentence only renders when the wall is off, where it's literally true. The copy is honest now. I still don't *like* the wall, but I'm no longer being lied to about it.

**3. The wall itself.** Team decision: it stays, for cost control. Fine — that's a policy, not a bug. My hard no-signup bar for a first fresh scan remains unmet, and everyone now agrees on that out loud instead of hiding it behind contradictory copy.

## Evidence

### FINDING 2 — L1-MEI-BADGE-03 (CI gate undiscoverable) — LIVE

HTTP fetch of `http://localhost:3000/badge` (server-rendered, anonymous, no auth): the RSC payload contains the new section verbatim:

- Heading: `"Guard it in CI — no account needed"` (h2)
- Intro copy: *"The same maturity read behind the badge is available as a free, unauthenticated gate your pipeline can call on every PR: 200 = pass, 422 = fail, so `curl --fail` exits non-zero and blocks the merge."*
- **Gate API** snippet (quoted from the live payload):
  ```
  GET <ASCENT_URL>/api/gate/<owner>/<repo>?min_level=L3
  # 200 = pass · 422 = fail (curl --fail exits non-zero)
  ```
- **GitHub Action** snippet (quoted from the live payload, single-sourced via `ciActionYaml`):
  ```yaml
  - uses: <owner>/ascent@v1
    with:
      ascent-url: ${{ vars.ASCENT_URL }}
      min-level: L3
  ```

Code anchors: `src/app/badge/page.tsx:11` (`ciActionYaml(["min-level: L3"])`), `:33-53` (the section), `src/lib/org/governance.ts:189-191` (single-sourced YAML shared with the org governance page).

Ceiling checks (live): `curl http://localhost:3000/pricing | grep -ci "api/gate|GitHub Action|Guard it in CI"` → **0**; same on `/report` → **0**. The section exists only on `/badge` (and the authed org governance tab).

Environment note (out of finding scope, worth a follow-up): `GET /api/gate/vercel/swr?min_level=L1&mock=1` currently returns **500 text/html** on this dev server — body shows `Error: Jest worker encountered 2 child process exceptions, exceeding retry limit` (a Turbopack dev compile-worker crash, persistent across 4 tries). Pages including `/badge` serve fine, so the server isn't wedged overall; per the run brief the dev server was not restarted (env.md's wedged-server recovery — kill port, delete `.next/`, restart — would be the fix). This is a dev-infra failure, not a regression of the discoverability finding under test (the endpoint's function was never live-certified in the prior L1-only run; its free/unauth design is code-confirmed at `src/app/api/gate/[owner]/[repo]/route.ts:48-54,156-157` — 200/422 JSON contract intact in code).

### FINDING 1 — L1-MEI-BADGE-02 (locked copy self-contradicts) — CODE-LEVEL (L1)

The locked branch cannot render in this environment: live `GET /` RSC payload carries `gated\":false` (auth bypass on → `authGateEnabled()` false → `locked = gated && signedIn !== true` is always false, `src/components/landing/prototypes/index/ScanModal.tsx:136`). So verification is by code-read of the shipped branch:

- `ScanModal.tsx:206-211` (locked branch): *"Running a new scan needs a (free) GitHub sign-in on this deployment — each scan spends real AI analysis, and the sign-in is how we keep that free for everyone. Public-repo scans stay free once you're in; signing in also unlocks private repos and saved history."*
- `ScanModal.tsx:212-214`: *"No account is needed to view already-scanned reports, badges, or the CI maturity gate."*
- `ScanModal.tsx:239-242` (unlocked branch, unchanged): *"…Public scans never need an account."* — renders only when `locked` is false, i.e. when the wall is off or the viewer is signed in, where the sentence is accurate.

The two branches no longer contradict: the locked copy explains WHY (real AI spend), carves out public repos (free once signed in), and names what needs no account at all. The old undifferentiated "Scanning is for signed-in members on this deployment" is gone.

### FINDING 3 — L1-MEI-BADGE-01 (the wall) — BY-DESIGN per recorded decision

Gate code unchanged and intentional: `src/app/api/scan/route.ts:128-133` and `src/app/api/scan/stream/route.ts:71-82` still require a signed-in viewer for every fresh scan when `authGateEnabled()`. Decision on record: wall stays for LLM-cost control; the shipped fixes address honesty (02) and discoverability (03) around it.

## Verdicts (diff vs prior run)

| id | prior | now | evidence class |
|---|---|---|---|
| L1-MEI-BADGE-02 | open | **resolved-verified** | code-read (locked branch unrenderable under dev bypass — stated in ceiling) + live `gated:false` proof |
| L1-MEI-BADGE-03 | open | **resolved-verified** | live HTTP quote of /badge heading + both snippets |
| L1-MEI-BADGE-01 | open | **by-design** | recorded decision; gate code unchanged |
| L1-MEI-BADGE-04 (clickable evidence) | open | *(out of this recertify's scope — still open)* | — |

## Metric deltas

- **Time-saved:** unchanged for the anonymous first-timer (the wall still stops the fresh-scan path — by design). But JTBD #3 (wire the CI gate) moves from "impossible to discover" to "copy-paste from /badge in ~2 min" — the prior run's "I'd wire it up tonight" condition is met.
- **Grounding score:** unchanged (3/5) — the evidence-linking finding (BADGE-04) was not in this recertify's scope.

## Character voice

"Two of my three complaints are honestly fixed. The badge page now hands me the gate API and the Action YAML under a heading that literally says 'no account needed' — that's the honest piece surfaced where I live, and I'd wire it into CI tonight. The sign-in wall copy no longer gaslights me: it says scans burn real AI money, that's why the login, and tells me what stays free. I still won't sign in for a first scan of my own public repo — that's your policy and my line, and at least we both know it now. Put the same CI section on the report page and make the evidence clickable, and I'm most of the way to pasting your badge next to my Scorecard one."
