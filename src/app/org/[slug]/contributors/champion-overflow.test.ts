// G6-23: the champion card header had no `min-w-0`/`truncate` on the login span or its flex parent, so
// a long GitHub login could push the rank badge off/overflow the card. `ChampionsGrid` is a private
// helper inside the (async, server) page component, not exported, so this pins the fix at the source
// level rather than trying to render the whole async page tree.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(path.resolve(__dirname, "page.tsx"), "utf8");

describe("contributors champion card truncation (G6-23)", () => {
  it("wraps the login in a min-w-0 flex-1 truncate cell", () => {
    expect(SOURCE).toMatch(/className="min-w-0 flex-1 truncate font-mono text-base text-white"/);
  });

  it("keeps the rank badge from shrinking so it never gets squeezed off", () => {
    expect(SOURCE).toMatch(/className="shrink-0 font-mono text-sm uppercase tracking-widest text-accent"/);
  });
});
