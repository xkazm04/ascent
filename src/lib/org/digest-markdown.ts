// Weekly digest → markdown in a leadership-update voice (the "Copy as markdown" payload).
// STUB: the signature is the wire contract (see digest-types.ts); WP1 fills in the body.

import type { WeeklyDigest } from "./digest-types";

/** Serialize a digest to a self-contained markdown update a lead can paste as-is. */
export function weeklyDigestMarkdown(d: WeeklyDigest): string {
  void d;
  return "";
}
