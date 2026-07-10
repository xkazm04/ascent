# Fix Wave 9 — the Medium/Low tail: test infrastructure, the last lockouts, the blank front door

> 5 commits · **~25 findings closed** · 0 regressions.
> tsc **0 → 0** · vitest **3184 → 3200 passing** (208 files) · `next build` clean.
> Branch `vibeman/bug-ui-scan-2026-07-09`. Uncommitted WIP never staged.

Wave 9 was 265 Medium/Low findings — far more than one session. It was worked as themed sub-waves,
highest-value first. Two of them turned out not to be "polish" at all.

---

## 9-0 (`6459b2d`) — the prerequisite: a DOM test environment

This repo had **no jsdom and no testing-library**. JSX, CSS and accessibility changes could not be
regression-pinned *at all*, which is why 93 of the scan's 302 findings had no test coverage available to
them, and why wave 8's agents extracted pure helpers instead of claiming component tests they couldn't
write.

Deliberately minimal and opt-in:

- The suite's **default environment stays `node`.** All 3184 existing tests are pure logic and keep running
  there, unchanged and just as fast.
- A component test opts in per file with a line-1 docblock: `// @vitest-environment jsdom`.
- `vitest.setup.dom.js` loads for every file but guards on `typeof document`, so it is inert under node.
  Under jsdom it wires jest-dom's matchers and automatic unmount between cases — without which React state
  leaks across tests and a passing test can be an accident of ordering.
- The coverage ratchet's floors are untouched.

The first DOM test proved its own worth immediately. It asserted `ConfirmAction`'s initial focus lands on
**Cancel**, never on the destructive Confirm — the one property the pure copy tests couldn't reach. The
first draft asserted an `autofocus` **attribute** and passed for the wrong reason: React doesn't emit that
attribute, it calls `.focus()` on mount. The test now asserts `document.activeElement`.

---

## 9a (`5479b17`) — the dormant-auth cluster's last hiding place

Wave 2 re-keyed the API routes. The **pages** were never touched, and they were sitting in the Medium tail.

Every auth-gated page open-coded `isAuthConfigured() && !session` — the dormant predicate, false in
production. So the gate never fired: a signed-out visitor to `/usage`, `/trends`, `/report/compare` or
`/connect` fell through to a page that showed nothing (`canReadOrg` correctly refuses their data) **with no
prompt to sign in.** And `SignInNotice` defaulted to `provider="github"` — the dormant button, which hits
`isAuthConfigured() === false` and bounces to `/connect?error=not_configured`. So on the one page that *did*
prompt, the prompt was broken.

**`/launch` was strictly unreachable.** It read `session.installations`, guarded by
`if (!session) { if (!isAuthConfigured()) redirect("/connect"); … }`. Under Supabase both conditions are
always true, so **every visitor, signed in or not, was redirected away. Nobody has seen the Fleet Map in
production.**

`org/[slug]/layout.tsx` already had this right — check the ACTIVE wall first, offer the supabase button,
then fall back. `resolveSignInState()` lifts that shape out of it. `SignInNotice`'s default provider now
follows whichever stack is live, so no caller can render the dead button.

`/launch` also needed a **data path**: the dormant session carries installations inline, the Supabase viewer
does not. `viewerInstallations()` derives them from the viewer's org memberships
(`listOrgsForLogin` → `getInstallationIdForOwner`), dropping orgs whose installation is gone rather than
charting a dead star. The redirect now depends on the fleet actually being empty.

`/api/history`'s 401 was equally dead, so the anonymous slug-enumeration block its own comment promises did
not exist.

> **Caught and fixed forward:** `route.test.ts` mocked `@/lib/auth` but not `@/lib/access`, so the real
> `resolveViewerLogin` ran and 10 tests 401'd. Same shape as the wholesale-route-mock regressions earlier in
> this scan. Its auth-gate tests now pin the **production** shape, not the dev one.

---

## 9b (`e81ddd5`) — the public front door rendered blank

`Reveal.tsx` passed framer-motion `initial={{opacity: 0}}`, which framer **bakes into the SSR HTML** as an
inline `opacity:0`. Every Reveal-wrapped block shipped invisible and was only unhidden by a client observer.
So `/about` and the index landing rendered **completely blank** without JS, on a hydration failure, or to a
crawler that doesn't execute scripts.

The hidden start state now lives only in a `.js-reveal` class added **after client mount**, so the server
HTML is visible and the animation is pure progressive enhancement. Armed in a layout effect (before paint)
so there is no show-then-hide flash; `prefers-reduced-motion` keeps it visible.

`report/[owner]/[repo]/loading.tsx` re-exported a full-page skeleton, reintroducing exactly the blink
`page.tsx`'s own comment says it engineered around: *"There is no loading.tsx for this segment: the Suspense
fallback IS the instant masthead."* Deleted, per that comment.

Trend skeletons rendered 6 cards while 9 dimensions load — a guaranteed layout shift on the most-shared URL.
Both now derive from `DIMENSIONS.length`.

---

## 9c (`e81ddd5`) — dead code, verified before deletion

Five components (`OrgStanding`, `OrgGapsSection`, `PeriodSummary`, `CollapsibleSection`, `PlaybooksPanel`)
verified unreferenced — no imports, no JSX, **no dynamic/registry lookups**, and nothing in the uncommitted
WIP touches them. Deleted; recoverable from git.

`PeriodSummary.test.ts` survives because it never imported the component: it pins the lib derivations
(`computeWindowDeltas`, `isWithinNoise`) that are still live. Its header now says so.

`removeNewestHit` was dead in `public-scan-quota.ts` — **not** `rate-limit.ts`, as the finding claimed. Its
own docstring already said "drop-newest fallback removed". `format.ts`'s direction-color triad was duplicated
*inside `format.ts` itself*, breaking the file's own "one place" promise.

---

## 9d (`e81ddd5`) — accessibility

The global skip-to-content link targets `#main`, but many pages rendered no `#main`, so the keyboard bypass
silently focused nothing. Every `<main>` in the tree was audited; the real pages now carry the id.
`global-error` (own `<html>`) and the `aria-hidden` trends skeleton are correctly excluded.

**The section switcher was deliberately NOT converted to a tablist.** It writes `?tab=` to the URL, so it
*navigates*. A `<nav>` with `aria-current` is the correct pattern; bolting `role="tab"` onto links would be
a downgrade dressed as a fix.

Live regions were flooding. `RoadmapSandbox` announced on every slider tick (the range already speaks
per-step via `aria-valuetext`) — now debounced to ~450ms after the last change. The war-room header dropped
`aria-live` from its per-repo caption, leaving one coalesced atomic region. **A region that never finishes
announcing is worse than none.**

---

## Verification

| Gate | Before wave 9 | After |
|---|---|---|
| `tsc --noEmit` | 0 | **0** |
| `vitest` | 3184 (202 files) | **3200 (208 files)** |
| `next build` | clean | **clean** |
| Regressions | — | 10, all **caught by existing tests** and fixed forward |

One flake was seen in a single full-suite run and did not reproduce across 2 further full runs and 3
DOM-only re-runs. Recorded, not chased.

---

## What remains of Wave 9

| Bucket | Count | Note |
|---|---:|---|
| "other" bug-hunter Mediums, per-context | ~180 | real correctness bugs, mostly testable |
| Design-system drift (hardcoded hex → tokens) | ~38 | now pinnable — the DOM env exists |
| Accessibility (remaining) | ~20 | ditto |

Two `#main`-adjacent items and the `Export CSV` stack-filter drop are noted in `harness-learnings.md`.

---

## Patterns established (catalogue items 16–20)

16. **Infrastructure absence is a finding.** "No jsdom" is not a constraint to work around — it is the
    reason 93 findings had no coverage. Fix the prerequisite first; it changes what every later wave can
    honestly claim.
17. **A test that passes for the wrong reason is worse than no test.** The first `ConfirmAction` DOM test
    asserted an `autofocus` attribute React never emits. Assert the *property* (`document.activeElement`),
    not the markup you assume produces it.
18. **Polish buckets hide lockouts.** `/launch` unreachable and the sign-in prompt never firing were both
    filed as Medium. Severity assigned per-context underestimates anything whose blast radius is global.
19. **The correct accessibility fix often removes ARIA.** The section switcher navigates; it wanted
    `<nav>` + `aria-current`, not `role="tab"`. A live region that re-announces continuously is worse than
    silence. Ask what the control *is* before deciding what to announce.
20. **Prove dead code dead in four ways** — grep, dynamic imports, barrel re-exports, and the user's
    uncommitted work — before deleting. One of the five candidates had a test file that never imported it;
    deleting the test too would have destroyed live coverage of the lib maths underneath.
