// The drawn motif for one dimension. The markup is generated from constants (prismArt.ts) and never
// from user or repository data, which is what makes injecting it safe.

import type { CSSProperties } from "react";
import { artMarkup } from "./prismArtMarkup";
import { dimAt } from "./prismModel";

export function PrismArt({ index, reduced, still = false }: { index: number; reduced: boolean; still?: boolean }) {
  return (
    <svg
      viewBox="0 0 400 400"
      aria-hidden="true"
      style={{ "--c": dimAt(index).hue } as CSSProperties}
      className={still ? "ill still" : "ill"}
      dangerouslySetInnerHTML={{ __html: artMarkup(index, reduced) }}
    />
  );
}
