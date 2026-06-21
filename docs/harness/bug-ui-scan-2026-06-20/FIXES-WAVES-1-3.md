# Fix Waves 1–3 — bug-ui-scan-2026-06-20 (ascent)

> 16 findings closed in 14 atomic commits across 3 themed waves.
> **All 4 criticals closed.** Baseline preserved: tsc 0 → 0; tests 2394 → 2395 (+1 regression test);
> `next build` green throughout. 0 regressions.
> Branch: `vibeman/bug-ui-scan-2026-06-20-fixes` (off `master`).

---

## Wave 1 — Multi-tenant authz & capability leaks (7 findings, 6 commits)

| Commit | Finding | Sev | What changed |
|---|---|---|---|
| `7a7a128` | org-import #1 | **Crit** | `/api/org/import` now calls `requireOrgAccess(org)` — parity with /scan,/watch,/schedule. Closes cross-tenant credit drain + watchlist pollution; PUBLIC_ORG/auth-off stay open. |
| `193eb63` | usage #1 | **Crit** | `/usage` page membership-checks the `?org=` slug (mirrors `/api/usage`). Closes cross-tenant read of volume/repo-names/spend/credits. |
| `18f4003` | members #1, #3 | **Crit**+High | Invite acceptance moved from a GET render side-effect to an explicit same-origin POST (`/api/org/invites/accept`); page only `peekInvite`s read-only. Tokens no longer returned by `listPendingInvites`/page bundle (shown once at create). Audit on accept. |
| `3e5ca72` | members #2 | High | `/api/org/invites` refuses `owner`-role invites (no shareable owner escalation). |
| `6ec1ec4` | branding #1 | High | `logoUrl` SSRF guard — reject private/loopback/link-local/metadata hosts (the PDF renders `<Image src>` server-side). |
| `002b578` | playbooks #2 | High | "mark applied" validates `parsed.owner === org` (mirrors PR-apply); no foreign/typo repo into adoption + Initiative scope. |
| `2ac8253` | (test) | — | Import route test: mock `requireOrgAccess` + new regression test asserting a non-member is refused before any scan. |

## Wave 2 — Billing / credits / metering integrity (5 findings, 3 commits)

| Commit | Finding | Sev | What changed |
|---|---|---|---|
| `c258013` | credits #2, #1 | High×2 | `grantCredits` synthesizes a per-invocation `auto:<uuid>` idempotency key so a `withRetry`/commit-ambiguity retry can't double-apply (refund double-credit leak). `getCreditReconciliation` aggregates the FULL window instead of the newest-200 cap (no understated debits/grants/net). |
| `7572988` | checkout #1 | High | Polar webhook THROWS on an unfulfillable-yet-real paid order (org missing) so Polar redelivers (grant idempotent on `polar:<order.id>`) — was a silent 200 = permanent credit loss. |
| `d7378c4` | checkout #3 | Med | Checkout 404s a nonexistent org before creating the Polar session (no pay-into-a-void). |

## Wave 3 — Data integrity & persistence (5 findings, 4 commits)

| Commit | Finding | Sev | What changed |
|---|---|---|---|
| `63ffc1b` | scan-persist #1 | **Crit** | Both scan routes skip `persistScanReport` for degraded-to-mock / low-coverage runs (mirrors the cacheSet guard) — stops the DB tier re-serving the deterministic floor cross-instance for ~7 days under `::llm`. |
| `db82d3c` | scan-persist #2 | High | `fetchSnapshot` stamps the COMMIT sha (`commitsRes[0].sha`), not the tree object sha — fixes permalinks/commit-links + restores `getScanByCommit` dedup and the `@@unique([repoId,headSha])` backstop on PR-gate/sha-less scans. |
| `5691d19` | scan-persist #3 | High | `getScanReportByCommit` blanks contributors/aiUsage for an older pinned commit (they're a latest-scan snapshot) — no time-shifted people on a permalink. |
| `da6f551` | retention #1, #2 | Med×2 | `pruneRepoScans` pages the stale-scan SELECT (no unbounded findMany → no DSQL timeout aborting the prune); purge surfaces a failed self-audit write in `errors` (compliance trace can't be silently lost). |

---

## Verification (after Wave 3)

| Gate | Before (baseline) | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 2394 passed | **2395 passed** (+1 regression test) |
| `next build` | green | green |
| Regressions | — | none |

Per-wave the suite was re-run; Wave 1 surfaced one self-inflicted test break (import route test didn't
mock the new `requireOrgAccess`), fixed-forward in `2ac8253` before proceeding.

---

## Patterns established (catalogue)

1. **Gate the mutation at parity with its siblings.** A tenant-scoped write (credit spend, watchlist
   write) needs `requireOrgAccess`; the ONE route in a family that skips it is the hole. (org-import #1)
2. **A page that "computes the same thing" as an API must replicate the API's authz, not just its query.**
   The `/usage` IDOR existed only because the page omitted the route's membership check. (usage #1)
3. **A capability-granting action must require a POST gesture, never a GET render side-effect.**
   Prefetchers/unfurlers/scanners fire GETs; that burned single-use invites and captured unpinned ones.
   Pair with a read-only `peek` for the preview. (members #1)
4. **A capability token is shown once, never re-broadcast.** Listing endpoints/page bundles must omit
   the secret; only the create response returns it. (members #3)
5. **Validate a URL's DESTINATION, not just its scheme, before a server-side fetch.** https-shape ≠ safe
   egress; block private/loopback/link-local/metadata hosts. (branding #1)
6. **Idempotency must cover the auto-retry path.** Any money mutation under `withRetry` needs a dedup key;
   synthesize a per-invocation one when the caller can't supply a stable id. (credits #2)
7. **Don't reuse a capped "recent" reader as a financial aggregate.** A 200-row list cap silently
   truncates a window sum; aggregate over the actual window. (credits #1)
8. **On an at-least-once webhook, THROW to retry — a normal return acks "delivered".** Returning after a
   failed fulfilment permanently drops a paid event. (checkout #1)
9. **Guard the DURABLE store the same way as the volatile cache.** A "don't pin a degraded snapshot"
   skip on the in-memory cache is defeated if the DB tier (same lookup) persists it anyway. (scan-persist #1)
10. **Stamp the identity the consumers key on.** The tree-object sha ≠ the commit sha; permalinks, dedup,
    and the unique backstop all key on the commit. (scan-persist #2)
11. **A "snapshot" must not mix latest-only mutable data into a pinned historical read.** Contributors are
    a latest-scan snapshot; surface them only when the loaded scan IS the latest. (scan-persist #3)
12. **Page the SELECT, not just the deletes.** Batched deletes fed by one unbounded read still hit a
    statement-timeout on the read. (retention #1)
13. **A destructive action's compliance trace is not droppable.** Check the audit write's boolean; a lost
    trace must surface as a degraded run, not a green 200. (retention #2)

---

## Deferred (with cause) — for a later wave / decision

- **checkout #2 (Med):** buying a credit pack never calls `setOrgPlan`, so paid Pro/Team feature tiers stay
  locked. Needs a product→plan map + subscription-event handling (or making /pricing honest that packs are
  credit-volume, not feature unlocks). A billing-model decision, not a code bug.
- **credits #3 (Med):** allowance-vs-credit boundary race — the allowance pre-check is non-transactional.
  A true fix needs an atomic per-month allowance counter (schema). Documented tolerance for now.
- **credits #4 (Med):** reconciliation classifies refund-vs-grant by `/refund/i` over free-text `reason`.
  Needs an enumerated ledger `kind` column (migration) to classify structurally.
- **scan-persist #4/#5 (Low):** sha-less dedup keys on exact `scannedAt`; head-pointer recency tears on
  equal timestamps. Both need a content/idempotency key or a tie-break ordering.
- **retention #3 (Low):** no internal time budget vs `maxDuration=300` — a large fleet run is killed
  mid-purge with no partial summary. Needs a deadline guard + `truncated` flag.

All Medium/Low findings from the other 39 contexts (Waves 4–8 in INDEX.md) remain open per the triage plan.
