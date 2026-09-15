# Toasts and notifications - showcase brief

subject: toasts-notifications
subcategory: feedback-and-style
digest: sha256:4c6dc8858a53f603
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/feedback-and-style/toasts-notifications/toasts-notifications.md

- **Read:** the golden path, all six techniques (`severity-taxonomy`, `queue-discipline`,
  `actionable-toasts`, `durable-notification-ledger`, `os-escalation`,
  `announcement-accessibility`), both applications (`react--durable-notification-ledger`,
  `react--queue-discipline`), and the seven laws they cite in `_laws.md`
  (one-authority-per-vocabulary, count-carries-predicate, creation-names-reaper,
  identity-survives-reuse, derivation-names-recomputation, deletion-is-not-repair,
  failure-not-empty-success).
- **Rail order:** the golden path's order, above.

## Scene concept

A fictional **fleet desk**: the org's watched repositories with the out-of-band news they raise
(scans finishing, regressions, a failed rescan, an expired credential, low credits, an approval
request, an engine outage), every event flowing through ONE store (`desk.ts`) that projects it into
four tiers with one identity — a toast in the stack, a row in the notification center, a note on a
simulated desktop, and one utterance for assistive technology. It is the right host because the
subject is a *system* whose techniques are tiers of the same message, so a single desk lets every
region be the same event seen from another tier; a viewer raises events with the desk's buttons,
watches the queue, the badge, the desktop and the transcript answer, and acts on any tier to clear
the others. The rail reveals which policy each region is.

`reduced` and `volume` come from props: reduced starts the scene's one clock paused (its pause
control is in the queue region) and strips travel from the stack's entrance/exit; volume sizes the
fleet the desk stands for (a window of six is shown; the fiction line states the total). framer-motion
enters through `ToastStack.tsx` / `ToastCard.tsx` only.

## Techniques

### severity-taxonomy
- use_when matched: "designing the closed set of severity levels"
- mechanism to show: `severity.ts` holds the five-level closed set and one row per level
  (tone, consequence, dwell, dismissibility, ledger rule, OS eligibility, announcement grade,
  cooldown); the panel renders that table from the module; a classifier assigns a level by the
  consequence question, shows actionability as the orthogonal bit, demotes a recovery to info;
  tone → brand slots is a second table, no hex in the severity row.
- region: `SeverityPanel.tsx` → `SeverityRegion`
- Ascent evidence: `src/lib/alerts.ts` — `AlertSeverity = "critical" | "warning" | "celebration"` with
  `SEV_EMOJI: Record<AlertSeverity, …>` deriving from it (grep: `rg "severity" src/lib --type ts`)
- deviation: the vocabulary forks at the boundary — `prisma/schema.prisma` stores
  `AlertEvent.severity String` with the members in a comment, `AlertsHistory.tsx` keys emoji on
  `kind`, and no dwell/dismiss/announcement columns exist because there is no transient tier.
- applications read: none for this technique; nothing cited as Ascent's.

### queue-discipline
- use_when matched: "toasts arrive faster than the screen can absorb"
- mechanism to show: `queue.ts` — identity keys everything; semantic key (kind:subject) drives
  coalescing while live and a severity-dependent cooldown after dismissal (suppressed repeats counted);
  MAX_VISIBLE 3, severity preempts the lowest slot, waiting toasts do not age; overflow = coalesce
  same-kind waiters → summarize the tail into one "N more notifications" toast → count every shed;
  dwell is state advanced by the scene's single clock (visible pause control, paused under reduced);
  attention (pointer or focus) holds the clock and leaving grants a fresh allowance; the log is the
  queue's observability.
- region: `ToastStack.tsx` → `StackRegion` (+ `ToastCard.tsx`)
- Ascent evidence: `src/lib/alerts.ts` — `claimRegressionAlert` check-and-stamp cooldown keyed on
  `repoFullName`, pinned on `globalThis`; suppressed alerts audited with `suppressedReason: cooldown`
  in `src/lib/db/alert-events.ts` (grep: `rg "claimRegressionAlert|suppressedReason" src`)
- deviation: no transient tier exists to queue — `OnboardingErrorBanner`, `BillingReturnNotice`,
  `SnapshotScopeNotice`, `TokenNotice` are page-mounted banners with no dwell, no max-visible, no
  coalescing (grep: `rg -i "\btoast" src` → only refusals: `useRegistryMutation.ts:9`,
  `RegistryActions.tsx:52`, `AthenaPanel.tsx:5`).
- applications read: `react--queue-discipline.md` — mechanisms taken: two numbers (state cap vs
  render budget → MAX_VISIBLE + WAIT_TOLERANCE), eviction by importance not recency (severity
  preemption), dwell per severity (3000/4000/5000 → the table's 3s/6s ladder), a hidden window is a
  pause (the scene's clock control), and the named gaps (no focus pause, no coalescing for standard
  toasts, un-aged overflow) became the scene's must-shows; nothing cited as Ascent's.

### actionable-toasts
- use_when matched: "toast vanishes under the cursor mid-reach"
- mechanism to show: one verb per toast, dismiss a separate target; unwatch acts immediately and
  raises an undo toast with its own generous window (`UNDO_WINDOW_MS` 8s) whose expiry commits the
  deferred removal; a Retry that re-checks the world (a background recovery makes it stale → quiet
  acknowledgment, never a second failure); focus within the card pauses the window exactly as hover;
  the ledger entry carries the same verb into the same handler.
- region: `ActionPanel.tsx` → `ActionRegion` (the toasts themselves render in the stack)
- Ascent evidence: `src/components/org/shared/BillingReturnNotice.tsx` — remedy named in copy,
  dismiss strips the URL param via `router.replace` so a reload cannot resurrect it
  (grep: `rg "Dismiss|dismissHref" src/components/org/shared`)
- deviation: no notice carries an action button and no undo window exists; destructive org actions
  confirm first or act without recovery.
- applications read: none for this technique; nothing cited as Ascent's.

### durable-notification-ledger
- use_when matched: "badge count refuses to reach zero"
- mechanism to show: `ledger.ts` — admission from the classification at the source (obligations
  always, warning+ always, success/info only when awaited), decided before the queue; one identity
  across toast/entry/OS note, `resolveEverywhere`; read ≠ resolved (opening the center marks nothing,
  viewing marks read, mark-all-read keeps obligations pinned); `badge()` derived under one named
  predicate; `RETENTION` names the reaper per class and the panel prints what it reaped.
- region: `LedgerPanel.tsx` → `LedgerRegion`
- Ascent evidence: `src/lib/db/alert-events.ts` — `recordAlertEvent` writes one row per alert the
  product DECIDED to raise, delivered or not; `src/components/org/shared/AlertsHistory.tsx` lists it
  with the outcome (grep: `rg "recordAlertEvent|AlertsHistory" src`)
- deviation: `AlertEvent` has no read state, no resolution state, no badge, no per-class retention
  and no identity shared with any in-app surface (grep: `rg "unread|acknowledg" src/lib src/components/org/shared`
  → 0 relevant hits).
- applications read: `react--durable-notification-ledger.md` — mechanisms taken: one commit door
  so the count cannot drift (the scene derives `badge()` from the rows instead of storing it),
  admission event-shaped for awaited work, escalation writing the ledger unconditionally; its gaps
  (opening the drawer marks all read; no obligation class; cap-only retention; no coalescing) became
  the scene's must-shows; nothing cited as Ascent's.

### os-escalation
- use_when matched: "users revoked notification permission"
- mechanism to show: `escalation.ts` — send-time decision in stated order (user's cell in the
  event × channel matrix, level eligibility, modelled permission, focus-awareness by SURFACE);
  permission requested in context; denial stated beside the kinds the user asked for; the send is
  fallible with a result (platform refusing → note failed, counted; toast and ledger row stand); live
  note updated in place; reading in-app withdraws; click-through lands on the note's surface.
- region: `EscalationPanel.tsx` → `EscalationRegion`
- Ascent evidence: `src/lib/alerts.ts` — `dispatchAlert` is the one delivery door (webhook or
  `mailto:` sink), deadline-bounded, false on every failure path; `digestHasSignal` is the admission
  gate (grep: `rg "dispatchAlert|digestHasSignal" src/lib/alerts.ts src/app/api/cron`)
- deviation: escalation is org-wide and per-sink — no event × channel matrix, no focus-awareness, no
  per-user consent; `rg "Notification.permission|requestPermission" src` → 0 hits.
- applications read: none for this technique; nothing cited as Ascent's.

### announcement-accessibility
- use_when matched: "three toasts arrive and only one is voiced"
- mechanism to show: `AnnouncerPanel.tsx` mounts one polite and one assertive live region empty at
  scene mount; `announcer.ts` is the single writer with its own serial queue — coalesced by key (a
  repeat announces the update), assertive jumps the queue without erasing it, bounded and shedding
  oldest polite awareness first; one region mutation per drain, spaced on the scene clock, with a
  nonce so repeats still mutate, and a manual step; the caret proves arrival never moves focus; Alt+T
  reaches the stack; Escape dismisses and returns focus.
- region: `AnnouncerPanel.tsx` → `AnnouncerRegion`
- Ascent evidence: `src/components/CopyForLlm.tsx` — a dedicated `role="status" aria-live="polite"`
  region mounted beside the button and written into on the transition (grep:
  `rg 'aria-live|role="status"|role="alert"' src --type tsx`)
- deviation: 20+ ad-hoc `role="status"` / `role="alert"` sites each own a region
  (`OnboardingFlow.Shell.tsx`, `FleetMap.TriageControls.tsx`, `buttonChrome.tsx`, …); no drain queue,
  no severity-derived politeness.
- applications read: none for this technique; nothing cited as Ascent's.

## Out of the read

- The golden path's in-band/out-of-band boundary rule is stated in the region notes but the in-band
  half (field errors beside fields) is `async-ui-states`' scene, not this one.
- Cross-process severity mirroring (a shared enumeration generated from one authority) is
  server-side; the scene's vocabulary lives in one module by construction.
- "Compose where the language lives" (localization of escalated messages) is not attempted: the
  scene has one locale.
- The sibling subject *proactive nudges* (when to initiate contact at all) is not forged; the desk
  raises events only by button.

## Gates run

`npx tsc --noEmit` (one pre-existing error in the gitignored `.next/dev/types/validator.ts`, not
this scene's) · `npx vitest run src/features/shared/surfaces src/lib/org` · LOC check (≤200 under
`src/features/**`) · `desk.test.ts` (node: queue policy, undo commit, stale retry, one identity, derived
badge, reaper, OS decision, serial drain) · `Scene.dom.test.tsx` (jsdom: mounts in `MotionScope`,
every slug has one region, reduced starts paused, every volume, fiction line, empty live regions and an
unmoved caret, focus pausing dwell and Escape returning focus, the badge clearing from a toast action,
the undo window committing under the clock). Observation (screenshot) is the Director's step.
