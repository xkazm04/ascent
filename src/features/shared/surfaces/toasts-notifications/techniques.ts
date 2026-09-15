// The drawer entries for the toasts-notifications scene: one per technique of the registry's
// `toasts-notifications` subject (authored against sha256:4c6dc8858a53f603, 2026-09-06). `mechanism`
// explains what the region does in React/Tailwind; `source` is the scene's own code; `inAscent` cites
// a real Ascent file read during the run; `deviation` names where Ascent falls short.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "severity-taxonomy",
    title: "Severity taxonomy",
    mechanism:
      "severity.ts holds the five-level closed set and ONE row per level — tone, consequence, dwell, dismissibility, ledger rule, OS eligibility, announcement grade, cooldown — and the panel renders that table from the module, so what is on screen is the authority, not a copy. " +
      "Visual encoding is a semantic tone resolved to brand tokens by a second table; no severity row names a colour and no region picks one by level. " +
      "The classifier assigns a level by the consequence question (what if the user never sees this?), shows actionability as the orthogonal bit that decides transience, and demotes a recovery to info. " +
      "Every other region reads this table: `dwellFor`, `politenessFor`, the ledger's admission and the OS decision are all table reads.",
    source: S.SRC_SEVERITY,
    inAscent: {
      file: "src/lib/alerts.ts",
      note: "`AlertSeverity = critical | warning | celebration` is one closed union that `SEV_EMOJI: Record<AlertSeverity, …>` derives from, with the reason `celebration` is a level rather than a separate axis written beside it.",
    },
    deviation:
      "The vocabulary is forked at the boundary: `prisma/schema.prisma` stores `AlertEvent.severity` as `String` with `info | warning | critical | celebration` in a comment, `AlertsHistory.tsx` keys emoji on `kind` instead of severity, and no dwell / dismiss / announcement columns exist because Ascent has no transient tier at all.",
  },
  {
    slug: "queue-discipline",
    title: "Queue discipline",
    mechanism:
      "queue.ts is a pure queue with policy: identity is minted by the desk once and keys rendering, exit and dismissal; the semantic key (kind:subject) drives coalescing while a toast is live and a severity-dependent cooldown after dismissal, and a suppressed repeat is counted, never silent. " +
      "MAX_VISIBLE bounds the screen; a higher severity preempts the lowest visible slot so a critical never waits behind stale successes; waiting toasts do not age. " +
      "Overflow degrades in order — same-kind waiters coalesce into one counted toast, the tail past the tolerance becomes one synthetic 'N more notifications' toast that opens the center, and every shed is counted because the ledger already recorded it. " +
      "Dwell is a number on the entry advanced by the scene's single clock; removing the entry removes its only timer, so nothing can fire into a reused slot. " +
      "Attention — pointer or focus within — holds the clock, and leaving grants a fresh allowance. The clock has a visible pause control and starts paused under `reduced`.",
    source: S.SRC_QUEUE,
    inAscent: {
      file: "src/lib/alerts.ts",
      note: "`claimRegressionAlert` is a per-repo cooldown keyed on the semantic subject (`repoFullName`), check-and-stamp in one step, pinned on `globalThis` so it survives HMR — and the suppressed alert is still audited (`suppressedReason: cooldown` in `alert-events.ts`).",
    },
    deviation:
      "No transient tier exists to queue: the four nearest notices (`OnboardingErrorBanner`, `BillingReturnNotice`, `SnapshotScopeNotice`, `TokenNotice`) are page-mounted banners with no dwell, no max-visible, no coalescing; `useRegistryMutation.ts` states the policy ('never a toast that scrolls away from the control') as a refusal, not a queue.",
  },
  {
    slug: "actionable-toasts",
    title: "Actionable toasts",
    mechanism:
      "Every toast offers at most one verb ('Retry', 'Review', 'Undo', 'Top up'), rendered as a separate target from the dismiss; the ledger entry carries the same verb and both dispatch into one handler in desk.ts. " +
      "Unwatch acts immediately and raises an undo toast with its own generous window (`UNDO_WINDOW_MS`, not the success dwell); the removal is deferred behind it and the window's expiry commits, which is reliable because expiry is a state transition on the scene clock, not a stray timeout. " +
      "The Retry handler carries the repository's full address and re-checks the world before acting: after a background recovery the retry is stale and degrades to a quiet acknowledgment, never a second failure toast. " +
      "Attention pauses the window for keyboard and screen-reader users exactly as for a hovering pointer, because focus within the card sets the same `attended` bit. " +
      "Explicit dismissal of an obligation is deferral: the toast leaves, the ledger row stays unread and unresolved.",
    source: S.SRC_ACTION,
    inAscent: {
      file: "src/components/org/shared/BillingReturnNotice.tsx",
      note: "The post-checkout notice names its remedy in the copy and its dismiss strips the URL param through `router.replace` so a reload cannot resurrect it — a visible end to the notice's availability.",
    },
    deviation:
      "No notice in Ascent carries an action button: `BillingReturnNotice` says 'try again from the credits menu' in prose instead of offering the verb, and no undo window exists anywhere — destructive org actions (`unwatchRepo`, member removal) confirm first or act without recovery.",
  },
  {
    slug: "durable-notification-ledger",
    title: "Durable notification ledger",
    mechanism:
      "ledger.ts decides admission from the event's classification at the source — obligations always, warning and above always, success and info only when the work was awaited — before the queue decides whether pixels show, so a shed or coalesced message still reaches the record. " +
      "Toast, entry and OS note share the identity minted in `emit`; acting on any of them runs `resolveEverywhere`, and reading an entry withdraws its OS note. " +
      "Read means seen, not resolved: opening the center marks nothing, viewing an entry marks it read, and 'mark all read' zeroes the badge while obligations stay pinned in their own section. " +
      "The badge is `badge(entries)` — one named predicate (unread) recomputed from the rows on every render, never a counter incremented at a call site. " +
      "`RETENTION` names the reaper per class (read news, unread news, obligations never, a cap that evicts oldest-read-first) and the panel prints what it has reaped.",
    source: S.SRC_LEDGER,
    inAscent: {
      file: "src/lib/db/alert-events.ts",
      note: "`recordAlertEvent` writes one row per alert the product DECIDED to raise, whether or not a sink delivered it — admission independent of display — and `AlertsHistory.tsx` lists it with the delivery outcome.",
    },
    deviation:
      "`AlertEvent` has no read state, no resolution state, no badge, no per-class retention (it is exempt from the audit purge and otherwise unbounded), and no identity shared with any in-app surface — it is a delivery log the member reads, not a center that claims attention.",
  },
  {
    slug: "os-escalation",
    title: "OS escalation",
    mechanism:
      "escalation.ts decides at send time, per message, in stated order: the user's cell for this kind in the event × channel matrix, the level's eligibility from the severity table, the permission the app models (unasked, granted, denied), then focus-awareness — never about the surface the user is looking at, compared by surface and not merely by window focus. " +
      "Permission is requested in context ('notify me when a scan finishes'); denial is a state the panel states beside the kinds the user asked for, so a blocked channel is never a silent fall-through. " +
      "The send is fallible with a result: a refusing platform marks the note failed and counts it, and the toast and the ledger row stand — reach degrades, the record does not. " +
      "A live note for the same key is updated in place; reading in-app withdraws it; click-through brings the app forward and lands on the note's own surface.",
    source: S.SRC_OS,
    inAscent: {
      file: "src/lib/alerts.ts",
      note: "`dispatchAlert` is the one delivery door to the out-of-app tier (Slack webhook or `mailto:` sink): deadline-bounded, returns false on every failure path so the digest releases its claim, and `digestHasSignal` is the admission gate that keeps a flat week silent.",
    },
    deviation:
      "Escalation is org-wide and per-sink, not per-user and per-kind: there is no event × channel matrix (one webhook URL per org), no focus-awareness (the sink is a channel, not a desktop), and a cooldown-suppressed regression is written to the record without being routed to any in-app tier.",
  },
  {
    slug: "announcement-accessibility",
    title: "Announcement accessibility",
    mechanism:
      "AnnouncerPanel mounts one polite and one assertive live region with the desk, empty, and nothing else in the scene writes to them: the store's drain is the single writer. " +
      "Politeness was decided by `politenessFor` from the severity table when the event was emitted — error is assertive only when it blocks — so the announcer holds no grade of its own. " +
      "The announcement queue is separate from the visual one: it coalesces on the same semantic keys (a repeat announces 'still, N times', not the original), assertive jumps to the front without erasing what waits, and a storm sheds oldest polite awareness first, counted. " +
      "Each drain is one region mutation spaced by a gap on the scene clock, with a nonce so two identical utterances still mutate; the manual step drains without a clock. " +
      "The caret proves arrival never moves focus; Alt+T reaches the stack on demand; Escape on a toast dismisses it and hands focus back to where the user was.",
    source: S.SRC_ANNOUNCE,
    inAscent: {
      file: "src/components/CopyForLlm.tsx",
      note: "A dedicated `role=\"status\" aria-live=\"polite\"` region mounted beside the button, written into on the Copied / failed transition, because a live attribute on the button itself was found unreliable — the region-before-the-news rule, applied once.",
    },
    deviation:
      "Every announcing surface owns its own region (`OnboardingFlow.Shell.tsx`, `FleetMap.TriageControls.tsx`, `buttonChrome.tsx`, `CopyForLlm.tsx` — 20+ ad-hoc `role=\"status\"`/`role=\"alert\"` sites), so simultaneous updates can mask each other; no drain queue and no severity-derived politeness exist.",
  },
];
