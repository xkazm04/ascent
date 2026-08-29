"use client";

// THE onboarding channel for an org dashboard: a right-edge DRAWER that slides out from behind the
// screen border and pushes back to hide, leaving only a pull tab. The app stays fully usable
// underneath while a pulsing ring tracks whatever the member asked to be shown.
//
// W6c made it the ONLY guidance channel. Its content is no longer a fixed teach arc — it is the
// server-derived getting-started checklist (`useGettingStarted`), polled so a scan finishing in
// another tab ticks a row live. Doneness is DERIVED: no click in here records progress, and no door
// elsewhere in the product is second-class.
//
// THREE POSTURES, ONE CHANNEL (the whole entry-intensity rule):
//  - `companion` — a member whose onboarding is unstamped and unfinished. The drawer opens itself,
//    promotes ONE next task with its primary CTA + "Show me", keeps the rest as a thin rail, and
//    offers "Skip setup" (which STAMPS — collapsing does not).
//  - `teaching`  — stamped, complete, the demo org, or anyone with no membership row. Exactly the old
//    behaviour: collapsed pull tab, discoverable, with the teach steps no task claimed.
//  - `athena`    — the member switched the drawer to the resident companion. NOT derived; an explicit
//    choice. She ABSORBED into this drawer rather than arriving as a second floating thing: one
//    right-edge channel was the rule before her and still is.
//
// THE CHANNEL CHOICE IS NOT PERSISTED, deliberately. `TourStorageState` looks like the obvious home
// for it, but `useTourEngine.dom.test.tsx:184` and `:202` assert the stored record deep-equals
// `{ open, index }` — a third field fails them, and a test is not something to edit to make a feature
// fit. Nothing is lost that the acceptance criterion asked for: the drawer lives in the org LAYOUT, so
// the channel (and the conversation in it) already survives every `?tab=` switch. Only a HARD RELOAD
// returns to the checklist, and a reload re-boots the transcript from the server anyway.
//
// WHY SHE MOUNTS LAZILY AND THEN NEVER UNMOUNTS. `athenaMounted` latches on the first switch, and
// afterwards the conversation is hidden with a `hidden` class rather than removed from the tree. Lazy,
// because a dashboard nobody asks her about should not pay for her boot request; latched, because
// unmounting a conversation to glance at the checklist would throw the conversation away. The drawer
// itself lives in the org LAYOUT, so the same tree survives a `?tab=` switch — `OrgTabChunks` keys on
// the tab and unmounts everything inside `{children}`, which is exactly why she is not in there.
//
// The engine is unchanged in kind: it still owns the cursor, the deep link, the rAF anchor poll and
// the skip-when-absent rule. It is `enabled` only while a spotlight is running, so an auto-opened
// drawer never teleports the member to a tab they didn't ask for.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orgTabHref } from "@/lib/org/orgTabs";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { AthenaPanel } from "@/features/shared/athena/AthenaPanel";
import { useTourEngine } from "./useTourEngine";
import { patchTourState, readTourState, type TourStorageState } from "./tourStorage";
import { HighlightRing } from "./HighlightLayer";
import {
  buildDrawerItems,
  decidePosture,
  nextTask,
  resolveDrawerPosture,
  shouldStampCompleted,
  taskProgress,
  type DrawerItem,
} from "./tasks";
import { GETTING_STARTED_POLL_MS, stampOnboarding, useGettingStarted } from "./useGettingStarted";
import { TourChecklistBody } from "./TourChecklistBody";
import { TourDrawerHeader } from "./TourDrawerHeader";
import { TourStepFooter } from "./TourStepFooter";

export { GETTING_STARTED_POLL_MS };

export function TourChecklist({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  // A spotlight is a discrete request ("show me this"), separate from the drawer being open.
  const [spotlight, setSpotlight] = useState(false);
  // Optimistic skip: the stamp POST is fire-and-forget, so the posture must fall to `teaching` on the
  // click rather than waiting for the next poll to observe the write.
  const [skipped, setSkipped] = useState(false);
  const [athenaOn, setAthenaOn] = useState(false);
  const [athenaMounted, setAthenaMounted] = useState(false);

  const { payload, loaded } = useGettingStarted(slug);

  // Snapshot the stored drawer state on mount. This effect is declared ABOVE useTourEngine on purpose:
  // effects run in declaration order, and the engine's persist effect writes the same record — read
  // after it and every mount would look like "the user already chose collapsed", so the companion could
  // never open itself. Not a lazy initializer (the drawer renders inside a server-rendered layout).
  // The "taken" flag is a REF, not state: it only sequences this effect ahead of the restore effect
  // below, and declaration order already guarantees that within every commit — nothing needs to
  // re-render when it flips (state here would be a synchronous setState in an effect).
  const savedRef = useRef<TourStorageState | null>(null);
  const snapshotTakenRef = useRef(false);
  useEffect(() => {
    savedRef.current = readTourState(slug);
    snapshotTakenRef.current = true;
  }, [slug]);

  const isDemoOrg = slug.trim().toLowerCase() === PUBLIC_ORG;
  const derived = skipped ? "teaching" : decidePosture(payload, { isDemoOrg });
  const posture = resolveDrawerPosture(derived, athenaOn);
  const items = useMemo(
    () => buildDrawerItems(payload, { includeTeach: derived === "teaching" }),
    [payload, derived],
  );
  // The engine keys its anchor poll on step IDENTITY, so the array must be stable across renders.
  const tourSteps = useMemo(() => items.map((i) => i.tour), [items]);

  const exit = useCallback(() => {
    setSpotlight(false);
    setOpen(false);
  }, []);
  const t = useTourEngine(slug, tourSteps, { enabled: open && spotlight, onExit: exit, autoAdvanceOverSkipped: false });

  // Restore (or decide) the drawer's open state ONCE, after the first payload settles. A stored decision
  // always wins: a member who shut the companion this session must not have it pushed back open on every
  // navigation. With nothing stored, the posture decides — that IS the entry-intensity rule.
  useEffect(() => {
    if (!loaded || !snapshotTakenRef.current || restored) return;
    const saved = savedRef.current;
    setOpen(saved ? saved.open : derived === "companion");
    setRestored(true);
  }, [loaded, restored, derived]);

  useEffect(() => {
    if (restored) patchTourState(slug, { open });
  }, [restored, slug, open]);

  // Completion stamps itself, once, the moment every AVAILABLE step is done — reaching the end of the
  // flow IS the completion signal, and asking the member to also press a button would make the stamp a
  // second, weaker source of truth. Guarded by a ref so a poll landing mid-write can't double-post.
  const stampedRef = useRef(false);
  useEffect(() => {
    if (stampedRef.current || !shouldStampCompleted(payload)) return;
    stampedRef.current = true;
    stampOnboarding(slug, "completed");
  }, [payload, slug]);

  const skipSetup = useCallback(() => {
    stampedRef.current = true;
    setSkipped(true);
    setSpotlight(false);
    setOpen(false);
    stampOnboarding(slug, "skipped");
  }, [slug]);

  const show = useCallback(
    (item: DrawerItem) => {
      t.goTo(items.indexOf(item));
      setSpotlight(true);
    },
    [t, items],
  );

  // A running spotlight belongs to the setup channel; switching to her must not leave a ring pointing
  // at a control the drawer is no longer talking about.
  const setMode = useCallback((athena: boolean) => {
    setAthenaOn(athena);
    if (athena) {
      setAthenaMounted(true);
      setSpotlight(false);
    }
  }, []);

  const progress = taskProgress(items);
  const next = derived === "companion" ? nextTask(items) : null;
  const active = spotlight ? (items[t.index] ?? null) : null;
  const athena = posture === "athena";
  // Read, never re-derived: whatever the checklist promoted is what she names. `nextTask` is called
  // directly rather than reusing `next` so she still has a step to name in the teaching posture, where
  // the setup channel deliberately promotes nothing.
  const herNext = useMemo(() => {
    const step = nextTask(items);
    return step
      ? { title: step.title, phaseLabel: step.phaseLabel, href: orgTabHref(slug, step.tour.tab), cta: step.cta }
      : null;
  }, [items, slug]);

  return (
    <>
      {open && spotlight && <HighlightRing rect={t.rect} />}

      {/* `pointer-events-none` on the fixed wrapper, re-enabled on the tab and the panel below. The
          wrapper is a transparent box as wide as the panel, pinned to the right edge and vertically
          centred — and a transparent element still captures clicks. With the panel collapsed it sat,
          invisibly, over whatever the dashboard put in that band: on the Overview that was the Fleet
          card's Type/Stack/Level group buttons, which read as dead. The panel is only translated
          off-screen, so `inert` already handles focus; this handles the mouse. */}
      {/* z-[46]: just above the spotlight ring (z-[45]) and the header popovers (z-40), and BELOW the
          modal band (z-50 — ui/Modal, ScanModal). It sat at z-[55], so the coaching drawer and its pull
          tab painted on top of every dialog's backdrop: a panel floating over a modal the user opened,
          still clickable, while the dialog dimmed everything else. Coaching is the most interruptible
          content in the product — a dialog outranks it, always. (overlayBands.test.ts gates the order.) */}
      <div className="pointer-events-none fixed right-0 top-1/2 z-[46] -translate-y-1/2">
        <div
          className={`relative transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Pull tab — always on screen (sits at the panel's outer/left edge, translating with it). */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide guided setup" : "Open guided setup"}
            className="focus-ring pointer-events-auto absolute right-full top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-divider bg-surface-strong px-2.5 py-4 text-accent shadow-2xl transition hover:bg-accent/10"
            style={{ writingMode: "vertical-rl" }}
          >
            <span aria-hidden className="text-sm">{open ? "▸" : "◂"}</span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Guided setup</span>
          </button>

          {/* Panel — flush to the right edge (left-rounded, no right border). A COMPLEMENTARY region,
              never a dialog: it traps no focus and blocks nothing behind it. `inert` while collapsed:
              the panel is only translated off-screen, so without it every control inside stays in the
              tab order and a keyboard/SR user walks through an invisible drawer. The pull tab sits
              outside it. A conversation needs more width than a checklist, so the panel widens in her
              posture; a table inside still scrolls in its own container rather than the page. */}
          <aside
            inert={!open}
            aria-label="Guided setup"
            className={`pointer-events-auto flex flex-col rounded-l-2xl border border-r-0 border-divider bg-surface-strong shadow-2xl ring-1 ring-white/5 backdrop-blur-md transition-[width] duration-300 motion-reduce:transition-none ${
              athena ? "h-[80vh] w-[28rem] max-w-[92vw]" : "max-h-[80vh] w-80 max-w-[85vw]"
            }`}
          >
            <TourDrawerHeader
              posture={posture}
              progress={progress}
              athenaAvailable={!isDemoOrg}
              onMode={setMode}
              onCollapse={() => setOpen(false)}
            />

            {/* Latched, not conditional — see the header note on why she never unmounts. */}
            {athenaMounted && (
              <div className={athena ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <AthenaPanel slug={slug} next={herNext} degradedHref={orgTabHref(slug, "settings")} />
              </div>
            )}

            {!athena && (
              <>
                <TourChecklistBody
                  slug={slug}
                  items={items}
                  next={next}
                  active={active}
                  progress={progress}
                  loaded={loaded}
                  onShow={show}
                />
                <TourStepFooter
                  active={active}
                  companion={derived === "companion"}
                  anchorMissing={Boolean(active && t.isSkipped(active.tour.id))}
                  onSkip={skipSetup}
                  onGotIt={() => setSpotlight(false)}
                />
              </>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
