// @vitest-environment node
//
// The card's capability table is a static mirror of the GitLab adapter's manifest — it has to be, or
// the `"use client"` card would pull the local-forge adapter's `node:fs` graph into the browser
// bundle (see the note at the top of forgeCapabilityLabels.ts). This test is what keeps the mirror
// honest, and it runs server-side where importing the registry is free.
//
// FAIL-BEFORE (verified, see the handoff): flipping `appInventory` to `true` in the static table —
// the shape of drift this guards, a card advertising a capability the adapter does not have — turns
// the first case red.

import { describe, expect, it } from "vitest";
import { CAPABILITY_LABELS } from "./forgeCapabilityLabels";
import { forgeCapabilities } from "@/lib/forge/registry";
import type { ForgeCapabilities } from "@/lib/forge/types";

describe("forge capability labels", () => {
  it("mirrors the GitLab adapter's compiled manifest exactly", () => {
    const real = forgeCapabilities("gitlab");
    for (const row of CAPABILITY_LABELS) {
      expect(row.gitlab, `${row.key} disagrees with GITLAB_CAPABILITIES`).toBe(real[row.key]);
    }
  });

  it("shows EVERY capability, so the gaps are never quietly omitted", () => {
    // A card that lists only what works teaches the reader that the missing signals are zero. The
    // whole point of the table is that the `false` rows are on it.
    const shown = new Set(CAPABILITY_LABELS.map((r) => r.key));
    const all = Object.keys(forgeCapabilities("github")) as (keyof ForgeCapabilities)[];
    expect([...shown].sort()).toEqual([...all].sort());
    expect(CAPABILITY_LABELS.some((r) => !r.gitlab)).toBe(true);
  });

  it("gives every row a human label", () => {
    for (const row of CAPABILITY_LABELS) expect(row.label.length).toBeGreaterThan(3);
  });
});
