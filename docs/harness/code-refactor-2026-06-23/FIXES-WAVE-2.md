# Code Refactor — Fix Wave 2: Security/safety primitives (in progress)

> 2 commits so far, 3 findings closed. Baseline preserved: tsc 0→0 · tests 2584
> (no new regressions). **Paused mid-wave** for a decision on 3 behavior-affecting
> items (below).

This wave consolidates security/safety primitives that were copied across files and
drifting. The two **clearly behavior-preserving** consolidations are done; the
remaining ones change an actual security decision and need explicit direction.

## Done

| # | Commit | Finding(s) closed | Sev | Effect |
|---|---|---|---|---|
| 1 | `refactor(export): one canonical CSV escaper …` | pdf-llm #1 + security-posture #1 | High×2 | Extracted `src/lib/export/csv.ts`; routed audit/history/org-export/org-repositories through it. **Closed the org/repositories formula-injection gap** (its copy lacked the `=/+/-/@` guard). Also fixed a latent `.map(csvField)` quote-by-column-index bug surfaced by the shared signature. |
| 2 | `refactor(report): one shared parseRepoParam …` | ai-native-standard #1 | High | Extracted `src/lib/report/repoParam.ts`; routed the PDF/SKILL/passport `?repo=owner/name@sha` parser through it. Left the stricter passport overrides/pr parser alone (different contract). |

## Held — needs a decision (behavior-affecting, not pure refactor)

These three findings consolidate primitives whose copies have **genuinely diverged**, so
unifying them picks a winner and *changes behavior*. Per the skill's "don't touch auth/security
unless explicitly asked + escalate behavior changes" rule, they're paused for sign-off:

1. **`orgIdForSlug` → shared `getOrgId`** (members-access #1). `members.ts` and `invites.ts` each
   re-implement the exported `getOrgId`, and the copies drift on slug normalization: `invites.ts`
   lowercases the slug, `members.ts`/`getOrgId` do not, and `orgHasOwner` runs the slug through the
   *login* normalizer. Unifying requires **deciding the canonical normalization** (lowercase vs
   verbatim) — a correctness call that affects org lookups.
2. **SSRF host guard unification** (org-branding #1). `branding.isSafeLogoUrl` is *stricter* than
   `alerts.validateAlertWebhookUrl` (it blocks CGNAT, IPv6 unique/link-local, multicast, internal
   hostnames the webhook validator misses). Unifying onto the stricter guard **changes which
   webhook URLs are accepted** — a security hardening, but a behavior change to a live outbound path.
3. **Tenant-read IDOR gate → `canReadOrg`** (usage-metering #1). The `usage` page + API hand-roll the
   access decision and are *missing* branches `canReadOrg` enforces (Supabase login-wall,
   `openOrgDashboardsEnabled`). Unifying **changes the access outcome** (correct hardening, but a
   behavior change). Flagged in the INDEX as held.

## Remaining clearly-safe Wave 2 item (not yet done)

- **Filename sanitizer** (pdf-llm #2): 8 inline copies in 2 flavors (`safe` case-preserving vs
  `safeFilenameSlug`). Consolidatable behavior-preservingly by exporting both flavors from one module
  and importing per-route. Safe; deferred only to keep the wave's commit boundary clean pending the
  decision above.

## Patterns established (catalogue items 4–5)

4. **Drifted-copy security primitive** — when N copies of a security helper exist, the danger isn't
   the duplication itself but that one copy silently *omits* a guard the others have (here:
   org/repositories' CSV escaper missing the formula-injection branch). Consolidation closes the gap;
   grep each copy for the *guard*, not just the function name.
5. **Shared-signature latent-bug reveal** — replacing a 1-arg local helper with a shared 2-arg one
   turns `arr.map(localFn)` into `arr.map(sharedFn)` that now passes the array index as the 2nd arg.
   Audit every `.map(fn)` / callback-position use when widening a helper's signature.
