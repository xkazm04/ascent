// G6-23: the champion card header had no `min-w-0`/`truncate` on the login span or its flex parent, so
// a long GitHub login could push the rank badge off/overflow the card. Migrated with the tab into the
// ?tab= shell (docs/ORG-TABS-REFACTOR.md): `ChampionsGrid` used to be a private helper inside the
// (async, server) page component; it is now the named ContributorsChampionsGrid component, so this
// still pins the fix at the source level rather than rendering the whole async tree.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(path.resolve(__dirname, "ContributorsChampionsGrid.tsx"), "utf8");

describe("contributors champion card truncation (G6-23)", () => {
  it("wraps the login in a min-w-0 flex-1 truncate cell", () => {
    expect(SOURCE).toMatch(/className="min-w-0 flex-1 truncate font-mono text-base text-white"/);
  });

  it("keeps the rank badge from shrinking so it never gets squeezed off", () => {
    expect(SOURCE).toMatch(/className="shrink-0 font-mono text-sm uppercase tracking-widest text-accent"/);
  });
});
