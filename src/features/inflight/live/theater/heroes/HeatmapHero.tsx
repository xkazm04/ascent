// PROTOTYPE ROUND (spark theater-upgrade, WP8) — the Heatmap hero. A stub until its builder lands it;
// it renders the placeholder so `?hero=heatmap` is reachable from the start.

import { TheaterHero } from "../TheaterHero";
import type { TheaterHeroProps } from "../theaterHeroSlot";

export function HeatmapHero(props: TheaterHeroProps) {
  return <TheaterHero {...props} />;
}
