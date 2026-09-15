# Accessibility - showcase brief

subject: accessibility
subcategory: feedback-and-style
digest: sha256:e7079c6845ba0270
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/feedback-and-style/accessibility/accessibility.md

Read: the golden path, all eight techniques, all five applications (`react--hidden-but-mounted-inertness`,
`react--keyboard-navigation-models`, `react--live-region-architecture`, `react--preference-respect`,
`rust--name-and-description-wiring`), the nine cited law anchors in `_laws.md`, the reference scene
`motion/` and `BRAND.md`.

## Scene concept

A fleet follow-ups desk — a roving segment strip over a worklist of fictional follow-ups, a
mounted-but-hidden detail drawer, an edit form, one announcer and one preference signal — that stays
operable with the screen off and the pointer unplugged. It is the right host because the subject's two
removals (no screen, no pointer) touch every part of an ordinary product surface, so each technique is
a natural region rather than a demo: the strip is the keyboard model, the drawer is the two channels,
the form is the name chain, the announcer serves every other region. A viewer works the desk — filters,
resolves, deletes, drafts, submits — and the rail reveals the techniques; the gates region audits the
desk itself and the pairings region says which readers it was held to.

`reduced` and `volume` come from props; nothing runs a media query. No framer-motion (the one motion is
the drawer's CSS transition, keyed off the prop). Fixtures are seeded (mulberry32) fiction and the
first line of the scene says so; `volume` sizes the identity set, the desk shows a window of 6.

## Techniques

### primitive-level-a11y
- use_when matched: "choosing native element versus custom widget"
- mechanism to show: `IconButton` (native button, `label` required by the type), `Switch` (native button, `role="switch"`, `aria-checked`), native checkbox in its label, `.focus-ring` on every control; rows are not click targets; delete hands focus to the survivor; a catalog audit table
- region: `WorklistRegion.tsx` + `sceneParts.tsx`
- Ascent evidence: `src/components/ui/Field.tsx` — implicit label association, `as="fieldset"` legend, one control skin on `focus-ring` (grep: `rg "aria-label=\"Close\"" src` -> 2 hand-written sites: ui/Modal.tsx:140, landing ScanModal.tsx:199; `rg "role=\"button\"" src/components/report/AltimeterGauge.tsx` -> SVG `<g>` with hand-rolled Enter/Space)
- deviation: no icon-button primitive; AltimeterGauge reimplements a button on an SVG group
- applications read: none for this technique; the rust application's "placeholder is a data-model invariant" informed the catalog framing; nothing cited as Ascent's

### keyboard-navigation-models
- use_when matched: "focus teleports to the wrong item after a resort"
- mechanism to show: roving tabindex (one `tabIndex=0`), ArrowLeft/Right wrap, Home/End, focus + selection together, position keyed by id (resort keeps it, removal falls to the neighbour), a tab-stop readout
- region: `StripRegion.tsx`
- Ascent evidence: `src/components/header/IdentityMenu.tsx` — `role="menu"`, rows `tabIndex={-1}`, ArrowUp/Down with wrap, Home/End, Tab returns focus to the trigger; `src/app/layout.tsx:79-84` skip link (grep: `rg "ArrowRight|ArrowDown" src` -> IdentityMenu, OrgSwitcher, AltimeterGauge, ObservatoryList, ColumnResizer, useTvRotation, FilterMenu; `rg "roving" src` -> IdentityMenu:141, OrgSwitcher:158)
- deviation: five hand-rolled arrow handlers, no shared mechanism; AltimeterGauge moves by index
- applications read: `react--keyboard-navigation-models.md` — mechanisms taken: arrows move real focus and selection together; the index-keyed hook is a consumer obligation the signature cannot enforce; nothing cited as Ascent's

### hidden-but-mounted-inertness
- use_when matched: "keyboard focus lands on controls that are not on screen"
- mechanism to show: three hide mechanisms on one `open` condition (`inert` at the root, `hidden`, opacity-only), a probe that walks the panel's tab-order candidates after each commit, focus into the panel only after it is operable, transition `none` under `reduced`
- region: `DrawerRegion.tsx` + `a11yProbe.ts` (`tabStops`)
- Ascent evidence: `src/components/onboarding/tour/TourChecklist.tsx:211` `inert={!open}` at the `<aside>` root, pull tab outside it, `pointer-events-none` for the mouse; `src/components/about/FleetGrid.tsx:82-84` three attributes on `dim` (grep: `rg "\binert\b" src` -> TourChecklist.tsx:211 only as an attribute; `rg "inert" src/components/onboarding/tour/TourChecklist.dom.test.tsx` -> 0 hits)
- deviation: FleetGrid pays the rule with three attributes; no test walks either hidden subtree
- applications read: `react--hidden-but-mounted-inertness.md` — mechanisms taken: the rung ladder; the pull tab outside the inert subtree; the open finding that no gate sees the target (re-verified by my own grep above); nothing cited as Ascent's beyond files I read

### live-region-architecture
- use_when matched: "burst of updates loses all but the last"
- mechanism to show: `useAnnouncer` — one provider owned by the Scene, polite/assertive homes rendered from the first commit, a 150ms serial drain, assertive preempting without erasing, a bound of 6 with oldest-polite shedding, a keyed remount per utterance, timers reaped by the effect cleanup, a visible transcript
- region: `AnnouncerRegion.tsx` + `a11yHooks.ts`
- Ascent evidence: `src/components/CopyForLlm.tsx:102` dedicated `role="status" aria-live="polite"` sr-only region, asserted by `CopyForLlm.test.tsx` (grep: `rg -l 'role="status"|role="alert"|aria-live' src --glob '!*test*'` -> 81 files; `src/app/invite/[token]/AcceptInviteForm.tsx:88` mounts `<p role="alert">` with its text)
- deviation: no provider, 81 scattered regions, some mounted with their text, no queue or remount
- applications read: `react--live-region-architecture.md` — numbers taken: 150ms drain spacing; mechanisms: keyed remount per drain, severity-to-politeness mapping owned by the caller, the module handle that no-ops before mount (not needed here); nothing cited as Ascent's

### name-and-description-wiring
- use_when matched: "an error shows red but is never voiced"
- mechanism to show: `computeName()` over the precedence chain, an inspector that reads the live DOM per commit, label vs placeholder naming, `aria-invalid` + `aria-describedby` (hint then error) on submit, the error announced assertively, label-in-name on Save, required-label Delete
- region: `FormRegion.tsx` + `a11yProbe.ts` (`computeName`, `computeDescription`)
- Ascent evidence: `src/components/onboarding/OnboardingInvitePanel.tsx:65-66` `aria-invalid` + `aria-describedby="invite-error"`, focus returned; pinned by `OnboardingScanStep.dom.test.tsx:82-91` (grep: `rg "aria-describedby|aria-invalid" src` -> OnboardingInvitePanel, OnboardingPickStep and their tests; `rg "error &&" src/components/ui/Field.tsx` -> line 70, an unlabelled `<p>`)
- deviation: `Field` does not wire the chain; its hint joins the name, not the description
- applications read: `rust--name-and-description-wiring.md` — mechanisms taken: "know which source is naming each control" is the durable rule (the ordering is platform-specific); placeholder-as-name is enforceable structurally; nothing cited as Ascent's

### preference-respect
- use_when matched: "deciding what an honored preference must preserve"
- mechanism to show: `PrefSignal` read once at the Scene, `reduced` from the frame, text scale (`zoom` at the root, tables reflow) and forced colors (palette flattened, status keeps glyph + word) set in the region and derived below, `PRESERVES` printed beside each, contrast shown as untested
- region: `PreferenceRegion.tsx` + `signal.ts` + the root `style` in `Scene.tsx`
- Ascent evidence: `src/components/ui/useReducedMotion.ts`; `src/app/globals.css:829-849` the CSS fallbacks and the "never add a prefers-reduced-motion check at a call site" rule (grep: `rg "matchMedia" src --glob '!*test*'` -> 8 reduced-motion readers across ui, report, about-org, observatory, live war room, practices; `rg "forced-colors|prefers-contrast" src` -> 0 hits)
- deviation: eight readers, no in-app override, forced colors and contrast undetected
- applications read: `react--preference-respect.md` — mechanisms taken: an in-app setting projected so every consumer derives from one composite signal; the lint that targets the residue; nothing cited as Ascent's

### a11y-verification
- use_when matched: "deciding whether a green audit means accessible"
- mechanism to show: `runGates()` over the scene's own DOM — names computed (L1), tab walk with stops-in-hidden-subtrees (L3), live regions mounted before the news (L2), predicates printed with every count, `an empty selector` producing a `failed run` verdict, contrast and the human pass listed as untested
- region: `GatesRegion.tsx` + `a11yProbe.ts` (`runGates`)
- Ascent evidence: `src/components/onboarding/OnboardingScanStep.dom.test.tsx:82-91` asserts ids, ARIA attributes, `document.activeElement` and a role+name query (grep: `rg -l "getByRole|getByLabelText" src --glob '*.test.tsx'` -> 100 files; `rg "axe" package.json e2e` -> 0 hits; `rg "keyboard.press|toBeFocused" e2e` -> 0 hits)
- deviation: no audit engine, no keyboard walk, no contrast gate
- applications read: none for this technique; nothing cited as Ascent's

### assistive-tech-divergence
- use_when matched: "deciding which reader and browser pairs a release is held to"
- mechanism to show: a dated held-pairings table (fiction) with two divergence behaviours, unheld pairings printed as untested, a stale flag against the scene's fixed clock, the keyed remount presented as a pairing workaround with its pairing / observation / date, deletion refused with the failure ranking
- region: `PairingsRegion.tsx` + `fixtures.ts` (`PAIRINGS`, `UNHELD`)
- Ascent evidence: `src/features/inflight/live/LiveWarRoomPanels.dom.test.tsx:1-11` reasons from "NVDA/JAWS keep reading" a polite backlog to remove a live region (grep: `rg -i "NVDA|VoiceOver|JAWS|TalkBack|Narrator" src e2e docs` -> that one file)
- deviation: no held-pairing list; the one mention is undated and names no browser
- applications read: none for this technique; nothing cited as Ascent's

## Out of the read

- Overlay focus containment (trap, restore, scroll lock) is the modal-stack subject's; the desk has no dialog. Ascent's `ui/Modal.tsx` holds it and is not showcased here.
- Field-level id plumbing as a primitive is the form subject's (out of scope for this repo); the form region wires one field by hand to show the contract, not the primitive.
- Announcement delivery policy (which severities announce at which grade) is the toasts subject's; the form applies one mapping (blocking error -> assertive) as a consumer.
- The contrast floor's ground truth is the design-tokens subject's; the scene reports it untested rather than computing pairs.
- Layer 5 (a human with a real reader) cannot run in a scene; it is listed as not run.
