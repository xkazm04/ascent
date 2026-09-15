// Contributors' half of "Teams and Contributors get Delivery's honesty".
//
// The panel is an async server component over three db reads, so — as with champion-overflow.test.ts
// — the fix is pinned at the source level: what must not regress is the SHAPE (allSettled + the
// shared settle classifier) and the COPY that distinguishes "couldn't load" from "nothing here".
// Sending someone off to scan repositories they have already scanned is the wrong instruction for a
// query that simply threw.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PANEL = fs.readFileSync(path.resolve(__dirname, "ContributorsInsightsPanel.tsx"), "utf8");

describe("ContributorsInsightsPanel degrades per section", () => {
  it("settles each read instead of rejecting the whole tab on one blip", () => {
    expect(PANEL).toMatch(/Promise\.allSettled/);
    expect(PANEL).not.toMatch(/await Promise\.all\(/);
  });

  it("reuses Delivery's settle classifier rather than re-implementing it", () => {
    expect(PANEL).toMatch(/import \{ settle \} from "@\/features\/bought\/delivery\/deliveryLoad"/);
  });

  it("distinguishes a failed insights query from an org with no contributor data", () => {
    expect(PANEL).toMatch(/Contributor data couldn&apos;t load right now/);
    expect(PANEL).toMatch(/No contributor data \{segmentId \|\| activeStack/);
  });

  it("says the decisions annotations are missing rather than showing none silently", () => {
    expect(PANEL).toMatch(/Recorded decisions couldn&apos;t load right now/);
  });

  it("logs every rejection server-side, so a degraded section is never a silent one", () => {
    expect(PANEL).toMatch(/console\.error\(`\[contributors\/\$\{slug\}\]/);
  });

  it("withholds the period notice entirely if the window itself failed to resolve", () => {
    expect(PANEL).toMatch(/\{period && \(/);
  });
});
