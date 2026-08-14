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
// TWO POSTURES, ONE CHANNEL (the whole entry-intensity rule):
//  - `companion` — a member whose onboarding is unstamped and unfinished. The drawer opens itself,
//    promotes ONE next task with its primary CTA + "Show me", keeps the rest as a thin rail, and
//    offers "Skip setup" (which STAMPS — collapsing does not).
//  - `teaching`  — stamped, complete, the demo org, or anyone with no membership row. Exactly the old
//    behaviour: collapsed pull tab, discoverable, with the teach steps no task claimed.
//
// The engine is unchanged in kind: it still owns the cursor, the deep link, the rAF anchor poll and
// the skip-when-absent rule. It is `enabled` only while a spotlight is running, so an auto-opened
// drawer never teleports the member to a tab they didn't ask for.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orgTabHref } from "@/lib/org/orgTabs";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { useTourEngine } from "./useTourEngine";
import { patchTourState, readTourState, type TourStorageState } from "./tourStorage";
import { HighlightRing } from "./HighlightLayer";
import { buildDrawerItems, decidePosture, nextTask, shouldStampCompleted, taskProgress } from "./tasks";
import { GETTING_STARTED_POLL_MS, stampOnboarding, useGettingStarted } from "./useGettingStarted";
import { TourNextTask } from "./TourNextTask";
import { TourProgress, TourTaskRow, rowState } from "./TourTaskRow";
import { Kicker } from "@/components/ui";

export { GETTING_STARTED_POLL_MS };

export function TourChecklist({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  // A spotlight is a discrete request ("show me this"), separate from the drawer being open.
  const [spotlight, setSpotlight] = useState(false);
  // Optimistic skip: the stamp POST is fire-and-forget, so the posture must fall to `teaching` on the
  // click rather than waiting for the next poll to observe the write.
  const [skipped, setSkipped] = useState(false);

  const { payload, loaded } = useGettingStarted(slug);

  // Snapshot the stored drawer state on mount. This effect is declared ABOVE useTourEngine on purpose:
  // effects run in declaration order, and the engine's persist effect writes the same record — read
  // after it and every mount would look like "the user already chose collapsed", so the companion could
  // never open itself. Not a lazy initializer (the drawer renders inside a server-rendered layout).
  const savedRef = useRef<TourStorageState | null>(null);
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  useEffect(() => {
    savedRef.current = readTourState(slug);
    setSnapshotTaken(true);
  }, [slug]);

  const isDemoOrg = slug.trim().toLowerCase() === PUBLIC_ORG;
  const posture = skipped ? "teaching" : decidePosture(payload, { isDemoOrg });
  const items = useMemo(
    () => buildDrawerItems(payload, { includeTeach: posture === "teaching" }),
    [payload, posture],
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
    if (!loaded || !snapshotTaken || restored) return;
    const saved = savedRef.current;
    setOpen(saved ? saved.open : posture === "companion");
    setRestored(true);
  }, [loaded, snapshotTaken, restored, posture]);

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
    (i: number) => {
      t.goTo(i);
      setSpotlight(true);
    },
    [t],
  );

  const progress = taskProgress(items);
  const next = posture === "companion" ? nextTask(items) : null;
  const active = spotlight ? (items[t.index] ?? null) : null;
  const tasks = items.filter((i) => i.kind === "task");
  const teach = items.filter((i) => i.kind === "teach");
  const companion = posture === "companion";

  return (
    <>
      {open && spotlight && <HighlightRing rect={t.rect} />}

      <div className="fixed right-0 top-1/2 z-[55] -translate-y-1/2">
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
            className="focus-ring absolute right-full top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-divider bg-surface-strong px-2.5 py-4 text-accent shadow-2xl transition hover:bg-accent/10"
            style={{ writingMode: "vertical-rl" }}
          >
            <span aria-hidden className="text-sm">{open ? "▸" : "◂"}</span>
            <span className="font-mono text-xs uppercase tracking-[0.2em]">Guided setup</span>
          </button>

          {/* Panel — flush to the right edge (left-rounded, no right border). `inert` while collapsed: the
              panel is only translated off-screen, so without it every control inside stays in the tab order
              and a keyboard/SR user walks through an invisible drawer. The pull tab sits outside it. */}
          <div
            inert={!open}
            className="flex max-h-[80vh] w-80 max-w-[85vw] flex-col rounded-l-2xl border border-r-0 border-divider bg-surface-strong shadow-2xl ring-1 ring-white/5 backdrop-blur-md"
          >
            <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
              <div>
                <Kicker>{companion ? "Getting started" : "Guided setup"}</Kicker>
                <h2 className="mt-1 text-base font-semibold text-white">
                  {companion ? "Set up your dashboard" : "Learn this dashboard"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {progress.total > 0 && (
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {progress.done}/{progress.total}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Hide guided setup"
                  className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-slate-400 transition hover:border-accent hover:text-white"
                >
                  ▸
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              {progress.total > 0 && <TourProgress done={progress.done} total={progress.total} />}

              {next && (
                <TourNextTask
                  item={next}
                  href={orgTabHref(slug, next.tour.tab)}
                  onShowMe={() => show(items.indexOf(next))}
                />
              )}

              {tasks.length > 0 && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Setup</div>
                  <ul className="mt-2 space-y-1">
                    {tasks.map((item) => (
                      <TourTaskRow
                        key={item.key}
                        item={item}
                        state={rowState(item, active?.key === item.key)}
                        onSelect={() => show(items.indexOf(item))}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {teach.length > 0 && (
                <div>
                  <div className="font-mono text-xs uppercase tracking-widest text-slate-500">
                    Learn the dashboard
                  </div>
                  <ul className="mt-2 space-y-1">
                    {teach.map((item) => (
                      <TourTaskRow
                        key={item.key}
                        item={item}
                        state={rowState(item, active?.key === item.key)}
                        onSelect={() => show(items.indexOf(item))}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {loaded && items.length === 0 && (
                <p className="text-sm leading-relaxed text-slate-400">
                  Nothing to guide here yet: this workspace has no setup steps to derive.
                </p>
              )}
            </div>

            {(active || companion) && (
              <div className="border-t border-divider px-4 py-3">
                {active && (
                  <>
                    <p className="text-sm leading-relaxed text-slate-300">{active.tour.body}</p>
                    {/* An absent anchor degrades to plain navigation — the tab switch already happened,
                        only the ring is missing. Never a stuck "seeking" state. */}
                    {t.isSkipped(active.tour.id) && (
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        That control isn&apos;t on screen for this organization yet. You&apos;re on the right
                        tab; it appears once there&apos;s something for it to act on.
                      </p>
                    )}
                  </>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  {companion ? (
                    <button
                      type="button"
                      onClick={skipSetup}
                      className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                    >
                      Skip setup
                    </button>
                  ) : (
                    <span />
                  )}
                  {active && (
                    <button
                      type="button"
                      onClick={() => setSpotlight(false)}
                      className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft"
                    >
                      Got it
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
