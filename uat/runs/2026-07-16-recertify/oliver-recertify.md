# Recertify — Oliver (QA lead) × "Drive testing maturity"

mode: recertify · date: 2026-07-16 · base: http://localhost:3000 (dev, PGlite, `ASCENT_AUTH_BYPASS=1`, `ASCENT_OPEN_ORG_DASHBOARDS=1`, `LLM_PROVIDER=claude-cli` + mock fallback)
prior findings: `uat/runs/2026-07-16-full-sweep/oliver-qa-lead--drive-testing-maturity.L2.md`

## 0. Environment

- Port 3000 had **no listener** at session start (the prior step's server was gone — health probe returned connection-refused twice). Started `npm run dev` in the background; `/api/health` → 200 after ~30s. Same PGlite data dir (`.pglite/ascent`), so the prior sweep's persisted scans (vercel/swr, lukeed/clsx, the seeded "vercel" org) carried over.
- Drivers: `curl` HTTP transcripts for the read surfaces + the direct PATCH; a bespoke Playwright driver (`uat/runs/2026-07-16-recertify/drive-tracker-403.mjs`, patterned on `uat/driver/drive.mjs`) for the in-browser tracker interaction. Shots in `uat/runs/2026-07-16-recertify/shots/` (gitignored).

## 1. Journal (first person, in-character)

Last time I walked out of here with the one bug I couldn't forgive: I scanned a repo, watched it finish, and five minutes later the permalink, the trend line, and the tracker all told me it never happened. Today I came back to check the fix the way I'd check any fix — from the outside, through the product, not the diff.

First, the original victim. I opened `/report/vercel/swr` cold — no re-scan, just the bookmark I'd have saved last session. The report rendered: "Overall maturity", the full scoring panel, the works. `/trends?repo=vercel/swr` now shows an actual chart — "1 scan shown", Jul 16, score 45, L3 Augmented, with a table row linking back to the scan's report. And `GET /api/recommendations?repo=vercel/swr` came back with a real `scanId` and five items (the D8 harness item I quoted last time is right there). Three surfaces, one consistent story. That's the artifact I can walk into my VP's office with.

Then I re-ran the whole funnel on `lukeed/clsx` through the app's own scan path — `POST /api/scan/stream` — and let it complete (mock engine; the bug was org scoping, not scoring, and the SHA-keyed dedup serves the persisted graph either way). Same result: `/report/lukeed/clsx` renders the report, `/trends?repo=lukeed/clsx` shows "1 scan shown" with the Jul 16 point (score 26, L2), and the recommendations API returns `scanId` + items. No "No report yet". No "we haven't stored any scans". The vanishing act is over.

Which unlocked the thing I literally could not test last time: the tracker's failure copy on a public report. I opened the clsx report's Roadmap tab in a real browser, flipped the first recommendation's status dropdown to "In progress", and watched. The PATCH went out, came back 403 — and instead of last session's lying "Couldn't save that change. Check your connection and retry", I got an amber notice: **"Tracking is available for your own organization's scans — this shared public report is read-only."** A Dismiss button. No Retry button anywhere. And the dropdown rolled itself back to "Open" instead of pretending the change stuck. That's exactly the taxonomy I asked for: a policy block that says it's a policy block.

Would I still gripe about anything? The dropdown is still live and clickable on a report I can never write to — I only find out it's read-only *after* I try. A senior UI reviewer would disable it or badge the section read-only up front. But that's a papercut on top of honest behavior, not dishonest behavior. Last time I said I'd trust the read but not the system. Today the system remembers what it did and tells the truth when it refuses. That's the bar.

## 2. Evidence

### Finding 1 — L2-oliver-drive-testing-maturity-004 (public-funnel scans vanish)

Fix under test: the four readers in `src/lib/db/scans-read.ts` retry once under the shared public org when the member-scoped lookup is empty — confirmed present at `src/lib/db/scans-read.ts:837-848` (getScanReportByCommit), `:244-254` + `:275-278` (getRepositoryHistory), `:423-433` + `:451-455` (getScanComparison), `:702-712` + `:741` (getLatestRecommendations).

Live transcript (fresh, this session):

1. Fresh funnel scan through the app's own path:
   `POST /api/scan/stream {"url":"https://github.com/lukeed/clsx","mock":true}` → SSE stream completed with a full report payload (`links.report: "/report?repo=lukeed%2Fclsx"`).
2. `GET /report/lukeed/clsx` → renders the report (`data-testid="report"`, "Overall maturity" heading present; **no** "No report yet" / "hasn't been scanned on Ascent" anywhere in the HTML). Screenshot: `shots/clsx-roadmap-before.png`.
3. `GET /trends?repo=lukeed/clsx` → visible page text: *"Maturity trends lukeed/clsx ◔ L2 — Assisted … 1 scan shown … Jul 16 26 L2 Assisted Open this scan's report · GitHub commit"* — a real chart + table row, **not** "We haven't stored any scans".
4. `GET /api/recommendations?repo=lukeed/clsx` → `{"scanId":"a7d5b131-a5d3-47d9-ba81-dbce5043abdd","items":[…5 items…]}`.
5. Original victim re-verified without re-scanning: `GET /report/vercel/swr` → report renders ("Overall maturity", `data-testid="report"`); `GET /trends?repo=vercel/swr` → *"vercel/swr ◑ L3 — Augmented … 1 scan shown … Jul 16 45 L3 Augmented"*; `GET /api/recommendations?repo=vercel/swr` → `{"scanId":"88077c70-259b-4f81-af78-5f46e9e34aaa","items":[…5 items…]}`.

All four surfaces agree, for both the fresh scan and the prior session's victim. **resolved-verified.**

### Finding 2 — L2-oliver-drive-testing-maturity-005 (tracker 403 worded as retryable)

Fix under test: `src/components/report/RecommendationTracker.tsx:105-121` maps 403 → `kind: "policy"` with honest copy; `:158` + `:191-221` render policy errors amber with Dismiss-only (Retry is `kind === "transient"` only).

Live browser interaction (now REACHABLE thanks to Finding 1 — the clsx public report has loaded recommendations): bespoke Playwright driver opened `/report/lukeed/clsx` → Roadmap tab → changed the first recommendation's "Recommendation status" select to "In progress". Captured result:

```json
{
  "alertText": "ⓘ\nTracking is available for your own organization’s scans — this shared public report is read-only.\nDismiss",
  "alertClass": "… border-amber-500/30 bg-amber-500/5 text-amber-200/90",
  "hasRetry": 0,
  "hasDismiss": 1,
  "selectValue": "open",          // optimistic change rolled back
  "patches": [{ "url": ".../api/recommendations/7aea5b56-…", "status": 403 }]
}
```

Screenshot: `shots/clsx-tracker-403-policy.png`; ARIA: `shots/clsx-tracker-403.aria.yaml`.
Server side independently confirmed: direct `PATCH /api/recommendations/7aea5b56-8e7b-41b6-b081-82d59e22f22c {"status":"in_progress"}` → `HTTP/1.1 403 Forbidden`, body `{"error":"Recommendation tracking is available for your own organization's scans."}`.

Exact copy, amber styling, Dismiss present, Retry absent, row rolled back. **resolved-verified.**

(Driver note for future runs: `getByRole("alert").first()` matches Next.js's empty route-announcer — filter `hasText: /./` to reach the tracker's real alert.)

## 3. Verdict diff

| finding | was | now | ceiling |
|---|---|---|---|
| L2-oliver-…-004 (scans vanish from permalink/trends/tracker) | open (blocker-grade major) | **resolved-verified** | Read-side retry, not a reconciliation: public-funnel scans still persist under the shared "public" org while member reads resolve the owner org (the L2 report's suggested option (b) — one shared org-resolution function — wasn't taken), so the persist/read duality survives behind the fallback; public scans stay read-only for tracking (403) and don't roll into a member org's own dashboards/rollups; each repo here still has only one baseline scan, so multi-point trend movement remains unverified. |
| L2-oliver-…-005 (403 worded as retryable) | open (minor, unreachable to click last session) | **resolved-verified** | The status dropdown is still rendered live and clickable on a report the viewer can never write to — the read-only nature is only disclosed after a failed attempt (the L2 report's "hide/disable the control for public-org recommendations" half of the suggestion wasn't implemented). |

## 4. Metric deltas (run-over-run)

- **Time-saved:** last session Oliver's job (a testing-maturity read he can *present and track*) was effectively blocked — the read saved ~a day of manual audit but the proof-of-work evaporated, so net adoptable value was ~0 for the enforcement/tracking half. This session the full loop (scan → revisit permalink → trend line → recommendations with a scanId) holds, so the journey's designed time-saved (~1 day manual repo audit → ~4 min live scan + persistent artifacts) is now actually live. Delta: the persistence half went from 0% live to live-with-ceilings (single-scan trends, public-scope read-only tracking).
- **Grounding:** unchanged from the prior L2 (this pass exercised the persistence/read scoping and error taxonomy, not the LLM read; the mock engine was used by design — the bug under test was org scoping, not scoring).

## 5. Regressions checked

- Report page, trends, recommendations API for the org-scoped `vercel/next.js` path were not re-driven this session, but `/trends?repo=vercel/swr` + `/report/vercel/swr` (member-org-resolving reads under the bypass) now pass **through the new fallback** — no previously-passing surface was observed broken. No regressions found.
