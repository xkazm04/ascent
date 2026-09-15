// The drawer entries for the accessibility scene: one per technique of the registry's `accessibility`
// subject (authored against sha256:e7079c6845ba0270, 2026-09-06), in the golden path's order.
// `mechanism` explains what the region does; `source` is the scene's own code; `inAscent` cites a
// real Ascent file that was read; `deviation` names where Ascent falls short, or null.

import type { SurfaceTechnique } from "../surfaceBody";
import * as S from "./sources";
import * as T from "./sources2";

export const techniques: readonly SurfaceTechnique[] = [
  {
    slug: "primitive-level-a11y",
    title: "Primitive-level accessibility",
    mechanism:
      "The worklist is built from the scene's own catalog: `IconButton` is a native `<button>` whose `label` prop is required by the type, so an icon-only control without a name does not compile; `Switch` is a native button with `role=\"switch\"` and `aria-checked`; watch is a native checkbox wrapped by its label. " +
      "Every control inherits Enter/Space from its element and the visible focus from the shared `.focus-ring`. " +
      "The row is not a click target — the actions are siblings, so no gesture has two interactive ancestors — and status carries a glyph and a word beside its color, so no meaning lives outside the control's own state. " +
      "Deleting the focused row hands focus to the nearest surviving row (or to the empty notice), never to the page body. " +
      "The audit table beneath is the inventory the technique asks for: carrier, name source and announced state per primitive — one row fixed repairs every consumer.",
    source: S.SRC_PRIMITIVE,
    inAscent: {
      file: "src/components/ui/Field.tsx",
      note: "One control skin for the whole form kit: labels associate implicitly by wrapping the control, `as=\"fieldset\"` names a group through a real `<legend>`, and every control carries `.focus-ring` — the catalog is where the contract lives.",
    },
    deviation:
      "There is no icon-button primitive: `aria-label=\"Close\"` is hand-written per site (ui/Modal.tsx, landing ScanModal.tsx), so a nameless icon button compiles; and `AltimeterGauge.tsx` hand-rolls Enter/Space on an SVG `<g role=\"button\">` rather than wrapping a native carrier.",
  },
  {
    slug: "keyboard-navigation-models",
    title: "Keyboard navigation models",
    mechanism:
      "The segment strip is one composite widget: exactly one chip has `tabIndex={0}`, the others `-1`, so Tab enters and leaves the strip in a single stop while ArrowLeft/ArrowRight roam with wrap and Home/End jump to the edges. " +
      "Arrow movement calls `onSelect` and focuses the target through its ref in the same handler, so focus and selection move together — a half of each is the pattern the technique bans. " +
      "The roving position is the member's id, not its index: `resort` reverses the order and the active member stays the same member; `remove active member` falls to the nearest surviving neighbour. " +
      "The readout counts the strip's tab stops (always one) against its member count, which is the whole point of the split.",
    source: S.SRC_KEYBOARD,
    inAscent: {
      file: "src/components/header/IdentityMenu.tsx",
      note: "A `role=\"menu\"` whose rows carry `tabIndex={-1}`, ArrowUp/ArrowDown roam with wrap, Home/End jump, and Tab hands focus back to the trigger before the menu unmounts so the browser continues from a mounted node — and the shell's first stop is the skip link in app/layout.tsx.",
    },
    deviation:
      "The model is hand-rolled per widget, not shipped once: IdentityMenu, OrgSwitcher, overview/FilterMenu, report/AltimeterGauge and observatory/ObservatoryList each carry their own arrow-key handler, and AltimeterGauge moves by index (`children[j]`), which is the teleporting-focus defect the identity rule exists to prevent.",
  },
  {
    slug: "hidden-but-mounted-inertness",
    title: "Hidden-but-mounted inertness",
    mechanism:
      "The detail drawer stays mounted so its draft survives, and the region lets the viewer choose the hide: `opacity` (a fade plus a translate) closes the visual channel only; `hidden` closes both channels by itself; `inert` at the panel's root closes focus, activation and the tree — all three derived from the single `open` condition, so the fade and the boundary cannot drift apart. " +
      "The probe under the panel walks the tab-order candidates after every commit and prints how many stops remain inside: 0 for inert and hidden, 2 for opacity-only while the panel is invisible — the invisible detour, made visible. " +
      "The attribute flips with the state, not at the end of the transition, and on the way in an effect focuses the textarea only after the commit that made the subtree operable. " +
      "Under `reduced` the transition is `none`; the channels close exactly the same way.",
    source: S.SRC_INERT,
    inAscent: {
      file: "src/components/onboarding/tour/TourChecklist.tsx",
      note: "The coaching drawer is translated off-screen for its slide and carries `inert={!open}` on the `<aside>` root, with the pull tab placed outside the inert subtree and the pointer channel closed separately by `pointer-events-none` — three channels, each named.",
    },
    deviation:
      "`about/FleetGrid.tsx` closes the channels of a dimmed cell with three attributes on one condition (`disabled`, `tabIndex`, `aria-hidden`) rather than one boundary, and no test walks the tab order of either hidden subtree (`inert` has 0 hits in TourChecklist.dom.test.tsx) — the fixes are held by review, not by a gate.",
  },
  {
    slug: "live-region-architecture",
    title: "Live region architecture",
    mechanism:
      "`useAnnouncer` is the desk's one provider: the Scene owns it and every region announces through `announce(text, politeness)`; none mounts a region of its own. " +
      "Two visually-hidden homes — `role=\"status\"` polite and `role=\"alert\"` assertive — render from the first commit, empty, so the region exists before the news. " +
      "A drain effect moves one utterance per 150ms tick from the queue into its home, so `burst x3` is voiced as three writes rather than one surviving last write; assertive is inserted ahead of queued polite messages without erasing them; the queue is bounded and sheds the oldest polite message under a storm; every drain timer is cleared by the effect that created it. " +
      "Each write renders a `<span key={id}>`, a fresh node per utterance, so `repeat last` is a genuine mutation even with identical text. " +
      "Announcements are made from event handlers only, never from render paths, and the transcript is the same sequence the regions received.",
    source: S.SRC_LIVE,
    inAscent: {
      file: "src/components/CopyForLlm.tsx",
      note: "The outcome of a copy is voiced through a dedicated `role=\"status\" aria-live=\"polite\"` sr-only region beside the button, because the button's fixed `aria-label` hid its visible Copied/Copy-failed swap — and CopyForLlm.test.tsx asserts the region's text on both paths.",
    },
    deviation:
      "No provider exists: 81 non-test component files mount their own `role=\"status\"`/`role=\"alert\"`/`aria-live` regions, several rendered together with their text (invite/[token]/AcceptInviteForm.tsx mounts `<p role=\"alert\">` with the message already inside — the edge where pairings diverge most), with no queue, no bound and no keyed remount.",
  },
  {
    slug: "name-and-description-wiring",
    title: "Name and description wiring",
    mechanism:
      "`computeName()` in a11yProbe.ts walks the precedence chain — `aria-labelledby`, `aria-label`, associated `<label>`, content, placeholder, title — and returns which source won; the inspector reads the live DOM after every commit and prints the computed name and description for the title field, the Save button and the Delete icon button. " +
      "Switch the title's naming to `placeholder` and the visible identity disappears the moment you type, while the inspector still shows the last-resort source naming it. " +
      "Submit empty: the field gains `aria-invalid`, its `aria-describedby` chain grows from the hint to hint-plus-error, the inspector shows the description, and the announcer voices the error assertively — attached and delivered. " +
      "Save is named `Save, follow-up fu-1`: the accessible name begins with the visible label, so a voice user can say what they see; Delete is the required-label `IconButton`.",
    source: T.SRC_NAME,
    inAscent: {
      file: "src/components/onboarding/OnboardingInvitePanel.tsx",
      note: "The invite handle input wires its failure with `aria-invalid` + `aria-describedby=\"invite-error\"` and returns focus to the input, so a reader hears why it failed; OnboardingScanStep.dom.test.tsx pins the ids, the attributes and the focus destination.",
    },
    deviation:
      "The shared `Field` renders its error as an unlabelled `<p>` (Field.tsx:70) with no id, `aria-describedby` or `aria-invalid` on the control — every call site wires the chain by hand or not at all — and its hint sits inside the wrapping `<label>`, so it joins the NAME rather than the description (the file's own comment admits it).",
  },
  {
    slug: "preference-respect",
    title: "Preference respect",
    mechanism:
      "`PrefSignal` in signal.ts is the one signal: `reduced` arrives from the frame (OS query OR the simulate toggle — the scene never runs a media query), text scale and forced colors are set in the preference region and read at the Scene, and every other region derives from the object it is handed. " +
      "The Scene honors the signal at the root: `zoom` reflows the whole desk at 150% and 200% (the tables wrap; nothing truncates), and forced colors flattens the palette so the viewer can see that status still reads from its glyph and word. " +
      "The drawer's transition and the row exits derive `reduced` from the same signal — feedback replaced, never removed. " +
      "Beside each preference the region prints what honoring it must preserve, and the contrast row says `untested` because this scene has no gate for it — a preference with no gate is not rendered green.",
    source: T.SRC_PREFS,
    inAscent: {
      file: "src/components/ui/useReducedMotion.ts",
      note: "A framer-free live subscriber to `prefers-reduced-motion`, and globals.css states the rule beside its CSS fallbacks: \"never add a prefers-reduced-motion check at a call site — it lives here and inside <Defer>\".",
    },
    deviation:
      "Reduced motion has eight `matchMedia` readers, not one (ui/useReducedMotion.ts, report/chartMotion.ts, about-org/aboutOrgLoopMotion.ts, observatory/observatoryMotion.ts, liveWarRoomCelebrate.ts, useLiveWarRoomStat.ts, practices/usePracticeHash.ts); no in-app override feeds them; and `forced-colors` / `prefers-contrast` have 0 hits in src — two of the four preferences are undetected, not merely unhonored.",
  },
  {
    slug: "a11y-verification",
    title: "Accessibility verification",
    mechanism:
      "`run gates` audits the scene's own DOM through `runGates()`: layer 1 computes the accessible name of every control and lists the nameless ones; layer 3 walks the tab order and counts stops inside visually-hidden subtrees (the drawer's `opacity` leak turns this red); layer 2 counts the live regions that were mounted before any news. " +
      "Every figure is printed with its predicate — which elements, computed how, excluding what — so a count cannot travel without its denominator. " +
      "Point the audit at `an empty selector` and the verdict is `failed run`: zero controls examined is spelled differently from a pass, because the instrument saw nothing. " +
      "The contrast floor and the human pass with a real reader are listed as untested and not run — the layers this scene cannot execute are never rendered green.",
    source: T.SRC_VERIFY,
    inAscent: {
      file: "src/components/onboarding/OnboardingScanStep.dom.test.tsx",
      note: "Asserts the screen-reader-visible output rather than pixels: the error's id, `aria-invalid` and `aria-describedby` on the input, `document.activeElement` returning to the field, and a `getByRole(\"button\", { name })` query — 100 test files in src query by role or label.",
    },
    deviation:
      "No layer runs as a gate: no audit engine is wired (`axe` has 0 hits in package.json and e2e/), the e2e suite has no keyboard walk (`keyboard.press` / `toBeFocused` 0 hits in e2e/), and no contrast check sits at the token definition site — accessibility is held by per-component tests and review, not by a regression floor.",
  },
  {
    slug: "assistive-tech-divergence",
    title: "Assistive-technology divergence",
    mechanism:
      "The held pairings are a written list — reader, browser, the two behaviours this subject cares about (does a pre-populated region voice, does an identical repeat voice), and the date each was measured; a result older than the scene's fixed clock by more than 45 days is flagged stale. " +
      "Two pairings outside the list are printed as `untested — not held, not passing`, so an unexercised cell never renders as a pass. " +
      "The announcer's keyed remount is presented as what it is, a pairing workaround: the card names what it serves, what was observed without it and when that was last checked; `propose deleting it` returns the failure ranking (silence, then a stale announcement, then verbosity) and the re-measure condition instead of a merge. " +
      "The scene chose mechanisms no reader has to interpret — a region mounted early and empty, a fresh node per utterance, native controls — which removes whole columns from the matrix.",
    source: T.SRC_DIVERGENCE,
    inAscent: {
      file: "src/features/inflight/live/LiveWarRoomPanels.dom.test.tsx",
      note: "A test whose header reasons from a named pairing behaviour — \"NVDA/JAWS keep reading\" a polite backlog — to justify removing a live region from the movers ticker rather than throttling it: the decision is tied to how real readers behave.",
    },
    deviation:
      "No held-pairing list exists anywhere in the repo: the one reader mention above is undated and names no browser, so \"tested with a screen reader\" has no predicate, and every pairing workaround that may exist is indistinguishable from redundant code.",
  },
];
