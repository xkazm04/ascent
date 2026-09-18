// PROTOTYPE ROUND (spark theater-upgrade, WP8) — the Mission hero. A stub until its builder lands it;
// it renders the placeholder so `?hero=mission` is reachable from the start.

import { TheaterHero } from "../TheaterHero";
import type { TheaterHeroProps } from "../theaterHeroSlot";

export function MissionHero(props: TheaterHeroProps) {
  return <TheaterHero {...props} />;
}
