# Code Refactor — Fix Wave 2: Security/safety primitives (COMPLETE)

> 6 commits, 7 findings closed. Baseline: tsc 0→0 · tests 2585→2606 (+22 new
> regression/lock tests; 0 regressions).
> The 3 behavior-affecting hardenings were applied per explicit user sign-off.

This wave consolidated security/safety primitives that were copied across files and
drifting. Two were behavior-preserving; three changed an actual security decision
(approved hardenings, each locked with a test).

## Hardenings applied (commits 3–6)

| # | Commit | Finding | Behavior change |
|---|---|---|---|
| 3 | `refactor(export): extract shared filename sanitizers …` (`5026008`) | pdf-llm #2 | None — both flavors (`safeFilenameSegment`, `safeFilenameSlug`) preserved per route; added a `maxLen` param so the usage route keeps its 64-char cap. |
| 4 | `refactor(db): route members + invites through shared getOrgId …` (`b478352`) | members-access #1 | **Canonical = lowercase** (org rows are persisted lowercased by `upsertInstallation`). Folded trim+lowercase into `getOrgId`; deleted both private `orgIdForSlug` copies; fixed `orgHasOwner` to stop running the slug through `normalizeLogin`. Mixed-case slugs now resolve consistently. |
| 5 | `refactor(net): extract shared SSRF guard …` (`ffc4254`) | org-branding #1 | The alert-webhook validator now ALSO rejects CGNAT 100.64/10, IPv6 ULA/link-local, multicast, and `*.local`/`*.internal`/metadata hosts (it previously missed these; branding already blocked them). Shared `src/lib/net/ssrf.ts`. |
| 6 | `refactor(usage): route tenant-read gate through canReadOrg …` (`97dc103`) | usage-metering #1 | The usage page + API now honor the Supabase login-wall + `ASCENT_OPEN_ORG_DASHBOARDS` opt-in the hand-rolled copies missed (cross-tenant read IDOR hardening). |

---

(original mid-wave notes below, retained for provenance)

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
