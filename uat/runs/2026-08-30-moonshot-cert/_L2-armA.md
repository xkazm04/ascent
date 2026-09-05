# L2 — Arm A (ANONYMOUS), run 2026-08-30-moonshot-cert

Driver: `uat/driver/drive.mjs` + three bespoke drivers written for this arm
(`drive-armA-report.mjs`, `drive-armA-dims.mjs`, `drive-armA-dimloop.mjs`).
Base `http://localhost:3100`. Shots in `uat/runs/2026-08-30-moonshot-cert/shots/`.
Arm construction, flags and the identity/anonymity assertions: `_L2-PREFLIGHT.md` § Arm A.

## Journal

- **11 min in.** Read the preflight and both characters' `l2_priority` blocks. The `.env.local` on this
  host sets all three invalidating flags, exactly as Tomáš's L1 warned. Picked 3100 (netstat clean).
- **Isolation decision.** Two `next dev` processes in one checkout fight over `.next`; wedging the
  shared `:3000` instance would be a worse outcome than any finding. Found the repo already solved
  this (`next.config.ts:47`, `scripts/dev-empty.mjs`) and reused it: `ASCENT_EMPTY=1` for `distDir`,
  plus a throwaway `PGLITE_DATA_DIR`. Verified first that `emptyTenantEnabled()` has no non-test
  caller, so the flag adds no behaviour to the arm.
- **Health then anonymity.** `/api/health` answered Ascent's shape. Rendered `/` shows a bare
  `Sign in` button and the public nav — no identity chrome. Only then did I start judging.
- **Check 1 (2 min).** Clicked the hero CTA. No repo input at all; a *Sign in to scan* panel. Then
  `curl -X POST /api/scan` with no cookie → **HTTP 200 in 3.3 s** with a full report body. The two
  halves disagree in the same session, on the same host, thirty seconds apart.
- **Check 2.** `/report?repo=sindresorhus/p-limit` (uncached — the arm's DB was virgin). It did not
  show a "needs no account" card and did not ask me to click anything: **the scan started on page
  load**, streamed its SSE progress, and landed a full report in **155.4 s** on claude-cli. No early
  client timeout. Stronger than the L1 prediction — there is no gate on this door at all.
- **Checks 3–5.** `/pricing` with `ASCENT_SELF_HOSTED=0` rendered the four cards. The Free card's
  "Unlimited free public scans" bullet and the report page's "4 free public scans left this month"
  meter were on screen inside the same anonymous session. Swept the raw HTML of `/` and `/pricing`
  for github.com URLs — exactly one, and it is not the source link.
- **Checks 6–8 (~25 min).** Drove the Dimensions tab D1→D9, expanding every collapsed row and reading
  the provenance SVG's `aria-label`, its four `<title>` children and the guardband `<rect>` geometry
  out of the DOM per dimension (`shots/armA-dimloop.json`). This is where L1 was most wrong on a
  number and most right on a mechanism.
- **Honest limits.** `NODE_ENV=development`, so the *production* leg of TOMAS-L1-01 (bypass hard-off
  by `env.ts:113`) is inferred, not executed — but the predicate the finding turns on
  (`authGateEnabled()`) was genuinely true here, which is what matters. One dimension (D9) could not
  be *discriminated* live because the model happened to agree with the signal exactly.

---

## Per-check verdicts

### 1. TOMAS-L1-01 — blocker — **confirmed**

Anonymous, `authGateEnabled()` true. Hero CTA → dialog with **no repo input**:

```
- dialog "Scan a repository":
  - paragraph: "Paste any GitHub repo and a live model reads it — under 2 minutes on hosted
    inference, about 6 minutes when it runs against a local CLI. Here's what comes back:"
  - text: Sign in to scan
  - paragraph: Scanning is for signed-in members on this deployment. Sign in with GitHub to run
    your scan. Public repositories are free, and you'll also unlock private repos and saved history.
  - button "Sign in with GitHub to scan"
```
`shots/armA-tomas01-scan-dialog.aria.yaml:39-54` · `shots/armA-tomas01-scan-dialog.png`

The same server, cookie-less, thirty seconds later:

```
$ curl -X POST :3100/api/scan -d '{"url":"https://github.com/sindresorhus/yocto-queue","mock":true}'
HTTP 200 in 3.323121s
{"repo":{"owner":"sindresorhus","name":"yocto-queue",...,"isPrivate":false,...
```

The dialog's own copy is self-refuting: it promises "paste any GitHub repo … under 2 minutes"
in the paragraph directly above the panel that says you may not.

### 2. TOMAS-L1-08 — major — **confirmed, and worse than described**

L1 predicted a "needs no account" cold-scan card with a *Scan now* button. There is no card and no
button: `/report?repo=sindresorhus%2Fp-limit` on a virgin DB **starts the live scan on page load**,
anonymously, under the same header that carries the `Sign in` button.

Mid-flight (`shots/armA-tomas08-coldgate.text.txt`, ~9 s in):

```
sindresorhus/p-limit
Asking Claude…          0:09 · 72%
Reading repository metadata / Reading file tree & history / Reading key files /
Analyzing 9 dimensions / Asking Claude… / Composing your report
A live AI scan reads the repo and scores 9 dimensions. This usually takes a few minutes.
```

Landed at **155.4 s**, `engine: claude-cli · opus`, score 27/100 with full radar, waterfall, roadmap
and per-dimension evidence (`shots/armA-report-plimit.png`). **No early client timeout** — the SSE
wait held for the full 2.5 minutes, so the two-clause duration copy ("under 2 minutes hosted, about
6 minutes local CLI") is honest for this repo. The contradiction stands cleanly: door A says
*sign in*, door B runs the identical scan for free with no account.

### 3. TOMAS-L1-02 — major — **confirmed**

One anonymous session, DB on, quota enforced.

- `/pricing` Free card: `✓ Unlimited free public scans` (`shots/armA-pricing.text.txt`, `.png`).
- `/report` header, same session: `◷ 4 free public scans left this month. Sign in for more`
  (`shots/armA-report-plimit.text.txt:10-11`, `.png`).
- `GET /api/quota` → `{"enforced":true,"remaining":4,"limit":5,"resetAt":…,"scope":"anon"}`.

"Unlimited" and "4 left of 5" are the same product, on screen, minutes apart.

*Detail L1 did not have:* the meter could **not** be captured in the hero dialog as the finding
scripts it, because TOMAS-L1-01's sign-in panel *replaces* `ScanForm` **and** its `QuotaMeter`. On a
deployment with the wall on, the honest number is only visible after the visitor has already gone
through the un-walled `/report` door. The two findings compound.

*Also worth noting:* three report renders and two scans consumed **one** slot (5 → 4), so the cached
re-scan exemption the copy claims does hold.

### 4. TOMAS-L1-10 — major — **confirmed**

`NEXT_PUBLIC_SOURCE_REPO_URL` unset (absent from `.env.example` except as a comment, and from
`.env.local` / `.env.production` / `.env.vercel`).

- Landing CTA: `link "Open source · run it yourself" → /pricing#self-host` — a pricing anchor, not a
  repository (`shots/armA-landing.aria.yaml:41-42`).
- Landing and `/pricing` both render `text: "Self-hosting guide: docs/SELF-HOSTING.md"` — an ARIA
  **`text`** node, not a `link` (`armA-pricing.aria.yaml:41`, `armA-landing.aria.yaml:106`). A repo
  path with no repo to resolve it against.
- Raw-HTML sweep of both pages for `https://github.com/…`: **exactly one hit on each**, and it is
  `https://github.com/xkazm04/ascent/issues` — the `FEEDBACK_URL` upstream fallback (`site.ts:137`).

**Sharpened by the live sweep:** the page is not merely missing a source link — it *ships* the
upstream repository URL, in the footer, labelled **Feedback**. A buyer told three times on one page
that the product is AGPL and self-hostable can only reach the code by noticing that the issues link
has a parent directory. Still a one-env-var fix.

### 5. TOMAS-L1-S2 — strength — **confirmed**

`/pricing` with `ASCENT_SELF_HOSTED=0`: `SelfHostBand` renders **above** the grid ("Run Ascent
yourself … every tier below is switched on"), then four cards — **FREE $0 free forever** ·
**STARTER $5 / month** · **TEAM $10 / month** · **CUSTOM Flexible / scoped with you** — each with a
per-tier scan line, followed by the full operation × credit × plan ledger. Free/Starter/Team CTAs are
real `link`s (`Scan a repo free`, `Get started`); only Custom is a `button "Tell us what you need"`
(`armA-pricing.aria.yaml:24,69,87,101`), i.e. the deliberate enquiry dialog of TOMAS-L1-R2, not a
lead wall in front of a price. Screenshot `shots/armA-pricing.png`.

### 6a. SAM-L1-11 — **confirmed in mechanism, REFUTED on the number**

Live `<title>` text, read from the DOM on all nine dimensions (`shots/armA-dimloop.json`):

> `"Guardband: the LLM can move the score at most ±6 from the signal"`

**±6, not ±25.** `model.ts:74,170` — "r8 (2026-08-20): LLM_GUARDBAND narrowed 25 → 6". The finding's
headline number is stale by one rubric revision; the *shape* of the defect is exactly as described.

The structural claim holds, and the live run discriminates it:

| Dim | aria-label | blended | LLM moved it? |
|---|---|---|---|
| **D1** | `signal 0, LLM 3, blended 0` | 0 | **no** |
| **D4** | `signal 25, LLM 24, blended 25` | 25 | **no** (a 0.57-weight blend would give 24) |
| **D8** | `signal 0, LLM 4, blended 2` | 2 | **yes** |
| D2 | `signal 46, LLM 52, blended 49` | 49 | yes |
| D6 | `signal 26, LLM 35, blended 31` | 31 | yes |
| **D9** | `signal 24, LLM 24, blended 24` | 24 | indistinguishable |

**D1 vs D8 is the clean live proof**: identical signal (0), comparable LLM judgment (3 vs 4), and
only D8's moves. D1 and D4 are `CLAIM_SCORED_DIMENSIONS` (`claims.ts:212`) — the model's number is
recorded and ignored — yet both draw a ±6 band and plot an `LLM judgment` tick inside it. D9 is
"the ONE fully-deterministic dimension … D9 never enters the guardband-widening blend"
(`engine.ts:76,146`) and draws the same band; this run cannot *discriminate* it because the model
returned exactly the signal value (24/24/24), so D9 rests on code, corroborated but not proven, live.

### 6b. SAM-L1-02 — **confirmed, with the numbers corrected**

Report header chip, this scan:

> `integrity · widened D2, D6 · blend 95%` … *"The model flagged the detector as suspect on D2, D6,
> so its guardband there was **DOUBLED**. Those dimensions could move up to twice as far from their
> deterministic signal…"* (`shots/armA-report-plimit.text.txt:24-25`)

The D2 and D6 provenance tracks, same page:

- `<title>` = `"Guardband: the LLM can move the score at most ±6 from the signal"` — **the
  undoubled number, asserted verbatim on the two dimensions the header just said were doubled.**
- guardband `<rect>` width **28.32** on D2 and D6 — **byte-identical** to D3 (28.32), D4 (28.32),
  D5 (28.32), D7 (28.32) and D9 (28.32). The band is not merely mis-labelled; it is *not drawn wider*.

So the contradiction is real and is now on-page in three places at once (chip says doubled, title
says ±6, rectangle measures ±6). Corrected magnitudes: **±6 vs ±12**, not ±25 vs ±50.

### 7. SAM-L1-04 — **confirmed, third run unchanged**

After the scan landed the address bar still read
`http://localhost:3100/report?repo=sindresorhus%2Fp-limit`. Full-DOM sweep of every `<a href>` and
`<button>` for `/report/{owner}/{repo}` or the words permalink/copy link/share
(`shots/armA-report-plimit.permalink.json`) returned **one** hit, and it is not a permalink:

```json
[{"tag":"A","href":"/api/report/share-card?repo=sindresorhus%2Fp-limit%40df476048…","text":"↓ Share card"}]
```

— a PNG download. Zero controls anywhere in the report (header, all five section buttons, footer
CTA) hand over `/report/sindresorhus/p-limit`. Arm (b) of the finding (DB off) was not run: this
instance boots PGlite in-process and a restart would have cost the arm; that half stays
**uncertain — not reproducible in this arm**.

**What L1 missed, and it is the sharpest thing in this run:** the `/pricing` **Free** card sells
`✓ Public report permalink` as a bullet (`armA-pricing.text.txt`). The product charges nothing for
a feature it never exposes, and advertises it one click from the page where it is absent.

### 8. SAM-L1-01 — **confirmed for D3, D5 and D8**

Rendered EVIDENCE lists, read from the expanded DOM (`shots/armA-dimloop.json` `panelText`):

- **D3 CI/CD** — `GitHub Actions CI present` · `CI runs tests` ·
  `Default-branch CI mostly green (76% of last 21 runs green · median 0.7 min · 1 workflows)`.
  **No path on any line.** Every collapsed row was expanded first; nothing reveals one.
- **D5 Docs** — a single line, `Substantial README (4970 chars, 16 sections)`. The actual file is
  `readme.md` (lower-case) and is never named in the evidence.
- **D8 AI Process** — `No dedicated AI process/harness detected (e.g. evals, prompt library, agent runbooks)`.
- Contrast intended by the finding, **partially**: D1's line is
  `No machine-readable AI/agent guidance detected (e.g. CLAUDE.md, AGENTS.md, .cursorrules)` — those
  are *illustrative* names, not files this repo has. On an absence-shaped repo D1 cites no
  repo-specific path either, so the D1-vs-D3 contrast L1 drew is weaker than stated here.

**Surface-model gap L1 missed:** the *LLM narrative* above each evidence list **does** cite real
paths — D3's prose names `.github/workflows/main.yml`, `npm test`, `fail-fast: false`; D5's names
`readme.md` and `index.d.ts`; D8's names `evals/`, `prompts/`, `.claude/agents/`. Sam is therefore
not actually left without a filename on D3 — he is left with a filename in the paragraph and none in
the list labelled EVIDENCE. That is a smaller trust gap than "D3 cites no file at all", and it
relocates the fix: the deterministic detector labels are the thing lagging the prose, not the page.

---

## Residue created (residue rule)

Everything below is inside the throwaway arm; the shared `:3000` instance and `.pglite/ascent` were
never opened.

- **`.pglite/uat-armA/`** — new PGlite data dir, created by this arm. Holds: one **mock** scan row for
  `sindresorhus/yocto-queue` (the anonymous `POST /api/scan` proof), one **live claude-cli** scan row
  for `sindresorhus/p-limit` (155 s, opus, score 27), and the anonymous public-scan quota counter
  (1 of 5 consumed). Safe to delete.
- **`.next-empty/`** — build cache for this instance (the dir `scripts/dev-empty.mjs` already uses).
- **New driver files, left in the tree** — `uat/driver/drive-armA-report.mjs`,
  `uat/driver/drive-armA-dims.mjs`, `uat/driver/drive-armA-dimloop.mjs`.
- **Shots** — `armA-landing`, `armA-tomas01-scan-dialog`, `armA-tomas08-coldgate`,
  `armA-report-plimit` (+`.permalink.json`), `armA-pricing`, `armA-dims`, `armA-dim-D1…D9`,
  `armA-dimloop.json` under `uat/runs/2026-08-30-moonshot-cert/shots/`.
- **Dev instance on :3100 killed at the end of the arm.** No GitHub writes, no enquiry form
  submitted, no credentials entered, no rows written to any shared database.
