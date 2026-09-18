// The map in words — the hero's text alternative. A screen reader (and a test) gets what the picture
// shows: per panel, the repo, the phase, what the map holds and where the heat is; then the fleet.

import { baseName, moduleLabel } from "./heatModules";
import type { FleetStar } from "./heatFleet";
import type { PanelModel } from "./heatPanelModel";
import { fileTone } from "./heatStyle";
import type { RepoHeat } from "./heatTypes";

/** The hottest few files, hottest first, in words ("editing claims.ts in src/scoring/"). */
export function hotFiles(repo: RepoHeat | null, now: number, max = 3): string[] {
  return (repo?.files ?? [])
    .map((f) => ({ f, t: fileTone(f, now) }))
    .filter((x) => x.t.h > 0.25)
    .sort((a, b) => b.t.h - a.t.h)
    .slice(0, max)
    .map(({ f, t }) => {
      const m = moduleLabel(f.module);
      return `${t.kind === "edit" ? "edited" : "read"} ${baseName(f.path)} in ${m.dim}${m.name}`;
    });
}

export function panelSentence(m: PanelModel, repo: RepoHeat | null, now: number): string {
  const head = `${m.repo}: ${m.phase}${m.inPhase ? ` ${m.inPhase}` : ""}.`;
  const map = m.extent ? ` Map: ${m.extent}, ${m.sinceWords}.` : " No file opened yet.";
  const hot = hotFiles(repo, now);
  const heat = hot.length ? ` Hot: ${hot.join("; ")}.` : m.extent ? " Every tile is cool." : "";
  const stamps = repo?.stamps.length ? ` Landed here: ${repo.stamps.map((s) => s.module || "repo root").join(", ")}.` : "";
  return head + map + heat + stamps;
}

export function fleetSentence(stars: readonly FleetStar[]): string | null {
  if (!stars.length) return null;
  return `Fleet: ${stars.map((s) => `${s.name} ${s.words}`).join("; ")}.`;
}
