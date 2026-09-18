// PROTOTYPE ROUND (spark theater-upgrade, WP8) — the Observatory hero. A stub until its builder lands it;
// it renders the placeholder so `?hero=observatory` is reachable from the start.

import { TheaterHero } from "../TheaterHero";
import type { TheaterHeroProps } from "../theaterHeroSlot";

export function ObservatoryHero(props: TheaterHeroProps) {
  return <TheaterHero {...props} />;
}
