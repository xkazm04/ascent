"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { reportPermalink, scoreHex } from "@/lib/ui";
import { Pill } from "./FleetMapChrome";
import {
  ACCENT,
  appendedStarPosition,
  CENTER,
  type Constellation,
  FAINT,
  FALLER,
  MAX_STARS,
  type RepoStar,
  RISER,
  SKELETON_STARS,
  starLook,
  starPosition,
} from "./fleetMapStars";

export function ConstellationField({
  c,
  onScan,
  scanning = false,
  scanDisabled = false,
  scanError,
  matcher,
  animateStars = true,
}: {
  c: Constellation;
  /** Scan this org's watched repos from the map (MAP-2); omitted = no scan affordance. */
  onScan?: () => void;
  scanning?: boolean;
  scanDisabled?: boolean;
  /** A manual-scan failure (quota/permission/server/network) for this org — shown inline so a blocked
   *  scan reports a reason instead of silently reverting, while keeping the stars + Scan button. */
  scanError?: string;
  /** When set, stars that fail the predicate are dimmed (not removed) — the fleet filter (MAP-4). */
  matcher?: (r: RepoStar) => boolean;
  /** Twinkle the hydrated stars. FleetMap turns this OFF once the fleet is large (launch-fleet-map #7):
   *  N×MAX_STARS forever-animating nodes is a steady-state repaint. Reduced-motion is honored via CSS
   *  regardless of this flag. */
  animateStars?: boolean;
}) {
  // Base stars fill the phyllotaxis; stars APPENDED mid-scan (applyScanEvent) render on the outer
  // "incoming" ring instead. Keeping them out of the layout `total` means landing a scan result never
  // recomputes — and visibly shifts — every existing star's position mid-animation, and an appended
  // star always renders even when the org sits at the MAX_STARS cap (a successful scan of an unknown
  // repo used to be silently invisible there). (ambiguity-ui launch-fleet-map #4)
  const baseRepos = c.status === "done" ? c.repos.filter((r) => !r.appended) : [];
  const appendedRepos = c.status === "done" ? c.repos.filter((r) => r.appended) : [];
  const repos = [...baseRepos.slice(0, MAX_STARS), ...appendedRepos];
  const layoutTotal = Math.min(baseRepos.length, MAX_STARS);
  const posFor = (r: RepoStar, i: number) =>
    r.appended ? appendedStarPosition(r.fullName) : starPosition(i, layoutTotal, r.fullName);
  const scanned = c.status === "done" ? c.repos.filter((r) => r.overall != null).length : 0;
  const total = c.status === "done" ? c.repos.length : 0;
  const overflow = Math.max(0, baseRepos.length - MAX_STARS);
  const avg =
    scanned > 0
      ? Math.round(
          (c.status === "done" ? c.repos : []).reduce((s, r) => s + (r.overall ?? 0), 0) / scanned,
        )
      : null;

  return (
    <div className="launch-constellation rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/org/${encodeURIComponent(c.login)}`}
            className="block truncate font-mono text-base text-white hover:text-accent"
            title={c.login}
          >
            {c.login}
          </Link>
          <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
            {c.status === "loading" && "charting…"}
            {c.status === "error" && "unreachable"}
            {c.status === "done" && `${scanned}/${total} scanned`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {avg != null && (
            <Pill
              size="sm"
              className="font-mono text-sm font-bold tabular-nums"
              style={{ color: scoreHex(avg) }}
              title="Average maturity of scanned repos"
            >
              {avg}
            </Pill>
          )}
          {c.status === "done" && onScan && (
            <button
              type="button"
              onClick={onScan}
              disabled={scanning || scanDisabled}
              title="Scan this org's watched repos and brighten the map"
              className="rounded-md border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
            >
              {scanning ? "Scanning…" : "Scan"}
            </button>
          )}
        </div>
      </div>

      <div className="relative mt-3 aspect-square">
        {/* role="group" (not "img"): the map contains interactive per-star <a> report links — role="img"
            collapses the whole SVG to one image and makes every star link (+ its aria-label) unreachable
            to screen readers. A group keeps the label AND exposes the links. */}
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" role="group" aria-label={`${c.login} constellation — ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`}>
          {/* constellation lines from the org core to each scanned repo star */}
          {c.status === "done" &&
            repos.map((r, i) => {
              if (r.overall == null) return null;
              const { cx, cy } = posFor(r, i);
              const look = starLook(r.overall);
              const dim = matcher ? !matcher(r) : false;
              return (
                <line
                  key={`l-${r.fullName}`}
                  x1={CENTER}
                  y1={CENTER}
                  x2={cx}
                  y2={cy}
                  stroke={look.color}
                  strokeWidth={0.4}
                  opacity={dim ? 0.03 : 0.12 + (r.overall / 100) * 0.28}
                />
              );
            })}

          {/* skeleton stars while the org's data loads */}
          {c.status !== "done" &&
            Array.from({ length: SKELETON_STARS }).map((_, i) => {
              const { cx, cy } = starPosition(i, SKELETON_STARS, `${c.login}-skeleton`);
              const style: CSSProperties = {
                ["--star-opacity" as string]: 0.3,
                animationDelay: `${(i % 5) * 0.3}s`,
              };
              return <circle key={`s-${i}`} className="launch-star" cx={cx} cy={cy} r={1.2} fill={FAINT} style={style} />;
            })}

          {/* hydrated repo stars — brightness scales with maturity; each links to its report */}
          {c.status === "done" &&
            repos.map((r, i) => {
              const { cx, cy } = posFor(r, i);
              const look = starLook(r.overall);
              // MAP-4: a star outside the active filter is dimmed (not removed) so the constellation
              // shape is preserved and the matches "pop" against the faded field.
              const dim = matcher ? !matcher(r) : false;
              const style: CSSProperties = {
                ["--star-opacity" as string]: dim ? 0.1 : look.opacity,
                animationDelay: `${(i % 7) * 0.28}s`,
              };
              // A repo that moved ≥1 point in the window (MAP-3): a thin directional ring — emerald
              // up, orange down — and the delta appended to the hover tooltip. Suppressed when dimmed.
              const moved = !dim && r.dOverall != null && Math.abs(r.dOverall) >= 1 ? r.dOverall : null;
              const moveDetail = moved != null ? ` · ${moved > 0 ? "+" : ""}${moved} 30d` : "";
              const detail = (r.overall != null ? ` · ${r.level ?? ""} ${r.overall}` : " · not scanned") + moveDetail;
              // SVG <a>: clicking a star opens that repo's report (the map's core "a star is a repo"
              // metaphor). A transparent halo widens the hit/focus target for the tiny stars.
              return (
                <a
                  key={`d-${r.fullName}`}
                  href={reportPermalink(r.fullName)}
                  className="launch-star-link"
                  aria-label={`Open report for ${r.fullName}${detail}`}
                >
                  {/* Invisible touch target — grows the HIT area, never the visible star (that stays
                      `look.r`). The map's 120-unit viewBox renders ~250–350px wide on a phone (~2.1–2.9
                      px/unit), so a ≥6-unit radius = ≥12px = a ≥24px-diameter tap target down to a 320px
                      screen, clearing the WCAG 2.2 target-size minimum the old r≈3 (~15px) fell short of. */}
                  <circle cx={cx} cy={cy} r={Math.max(look.r + 3, 6)} fill="transparent" />
                  {moved != null && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={look.r + 1}
                      fill="none"
                      stroke={moved > 0 ? RISER : FALLER}
                      strokeWidth={0.5}
                      opacity={0.85}
                      // WCAG 1.4.1: direction must not ride on hue alone — the emerald/orange pair
                      // converges under deuteranopia/protanopia. A faller's ring is DASHED, a riser's
                      // solid, so the glanceable mark carries a shape channel like the header's ▲/▼.
                      strokeDasharray={moved > 0 ? undefined : "1 0.8"}
                    />
                  )}
                  <circle
                    className={animateStars ? "launch-star" : "launch-star launch-star-static"}
                    cx={cx}
                    cy={cy}
                    r={look.r}
                    fill={look.color}
                    style={style}
                  >
                    {/* Single text child: React 19 drops all but the first child of an SVG <title> on
                        hydration, so a mixed {name}{detail} pair mismatches — concatenate to one string. */}
                    <title>{`${r.fullName}${detail}`}</title>
                  </circle>
                </a>
              );
            })}

          {/* the org core: a pulsing beacon at the heart of the constellation */}
          <circle className="launch-glow" cx={CENTER} cy={CENTER} r={7} fill={ACCENT} opacity={0.4} />
          <circle cx={CENTER} cy={CENTER} r={2.6} fill="#e2e8f0" />
        </svg>

        {c.status === "done" && total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1 font-mono text-sm text-slate-500">
              no repositories
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        {c.status === "error" ? (
          <span className="text-amber-400/80">{c.message}</span>
        ) : scanError ? (
          <span role="alert" className="text-amber-400/80">{scanError}</span>
        ) : (
          <span className="text-slate-500">{overflow > 0 ? `+${overflow} more stars` : " "}</span>
        )}
        <Link
          href={`/org/${encodeURIComponent(c.login)}`}
          className="font-mono uppercase tracking-widest text-accent hover:text-accent-soft"
        >
          open →
        </Link>
      </div>
    </div>
  );
}
