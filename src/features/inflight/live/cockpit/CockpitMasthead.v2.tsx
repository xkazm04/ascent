"use client";

// The cockpit masthead, Prism composition (v2). The page's one statement in display type ("The fleet, in adoption ×
// rigor"), the loop's state as two figures (the same `headerStatus` v1 prints as a caption line, so the two themes
// cannot phrase a fact differently), and the controls as the aside. Props are v1's, unchanged: same handlers, same
// gating (the gear only where a run could start, Stop only while something is live, the wind-down narrated).
import { Caption, GhostAction, Masthead } from "@/components/kit";
import { LiveViewSwitch } from "../LiveViewSwitch";
import { GearIcon } from "./CockpitGearIcon";
import type { CockpitHeaderProps } from "./CockpitHeader";
import { headerStatus } from "./headerStatus";
import { stoppingCaption } from "./loopTypes";

const ICON_BTN = "focus-ring inline-flex items-center rounded-[3px] border border-divider p-2 text-slate-300 hover:border-slate-400 hover:text-white";

export function CockpitMastheadV2(p: CockpitHeaderProps) {
  const liveParts = headerStatus(p).filter((x) => x.live);
  const stopped = p.stopping || p.stopRequested;
  return (
    <div data-role="cockpit-masthead">
      <Masthead
        eyebrow="Observatory"
        statement="The fleet,"
        named="in adoption × rigor"
        figures={[
          { label: "In scope", value: p.fleetCount, detail: p.fleetCount === 1 ? "repo" : "repos" },
          {
            label: "Loop",
            value: liveParts.length > 0 ? "Running" : "At rest",
            detail: liveParts.map((x) => x.text).join(" · ") || "nothing armed or in flight",
          },
        ]}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LiveViewSwitch slug={p.slug} current="cockpit" ledgerHref={p.ledgerHref} cockpitHref={p.cockpitHref} />
            {p.onOpenSetup && (
              <button
                type="button"
                onClick={p.onOpenSetup}
                data-testid="cockpit-setup-gear"
                aria-label="Run setup"
                title={p.setupSummary ? `Run setup — ${p.setupSummary}` : "Run setup"}
                className={ICON_BTN}
              >
                <GearIcon />
              </button>
            )}
            <GhostAction href={p.wallHref}>Wall</GhostAction>
            {p.live && p.onStop && (
              <button
                type="button"
                onClick={p.onStop}
                disabled={stopped}
                title={p.stopCaption ?? undefined}
                className="focus-ring rounded-[3px] border border-danger/60 px-3 py-2 type-body-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {stopped ? "Stopping…" : (p.stopLabel ?? "Stop")}
              </button>
            )}
          </div>
        }
      />
      {/* THE WIND-DOWN, NARRATED (PRIYA-L2-C6): in warn, not danger, exactly as v1. */}
      {p.live && p.stopRequested && <Caption className="mt-2 !text-warn">{p.stopCaption ?? stoppingCaption(p.stopHorizonMs ?? null)}</Caption>}
    </div>
  );
}
