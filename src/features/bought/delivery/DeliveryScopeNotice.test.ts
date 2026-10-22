// Delivery's period disclosure. DeliveryTab's header has documented since G7-09 that the trend is
// the tab's ONE windowed read while PR signals, governance and activity come off each repo's latest
// scan, and nothing on screen said so, under a period control sitting right above them. The panel is
// an async server component over four db reads, so the mount is pinned at the source level.
//
// DeliveryNotice states the split above the PR section, and the tab hands down the period it
// already resolved.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (name: string) => fs.readFileSync(path.resolve(__dirname, name), "utf8");
const PANEL = read("DeliveryCorePanel.tsx");
const V2 = read("DeliveryCore.tsx");
const NOTICE = read("DeliveryNotice.tsx");
const TAB = read("DeliveryTab.tsx");

describe("Delivery core panel scope notice", () => {
  it("mounts the notice above the snapshot sections", () => {
    expect(V2.indexOf("<DeliveryNotice")).toBeLessThan(V2.indexOf("<DeliveryPr"));
  });

  // The /org redesign demoted the notice's second half into a WhyChip on the notice itself (§2.1 D):
  // the reader still sees "the trend is period-scoped, everything below is a scan-time snapshot" at
  // first sight, and the list of which sections those are — plus the `Scan.prStats` reason — is one
  // keystroke away instead of four lines of standing prose. Case-insensitive because the sentence now
  // opens the disclosure rather than continuing the notice, so it starts with a capital.
  it("names which sections are period-scoped and which are a scan-time snapshot", () => {
    for (const src of [NOTICE]) {
      expect(src).toMatch(/period-scoped/);
      expect(src).toMatch(/pull request signals, branch governance and commit\s+activity/i);
      expect(src).toMatch(/scan-time snapshot/);
    }
  });

  it("keeps the reason the snapshot half cannot be re-scoped, in the disclosure", () => {
    for (const src of [NOTICE]) {
      expect(src).toMatch(/<WhyChip/);
      expect(src).toMatch(/Scan\.prStats/);
    }
  });

  it("takes the period from the tab rather than re-resolving it without the search params", () => {
    // A local resolveOrgWindow({}) here would silently drop an explicit ?range= and name the cookie's
    // period on a shared link. Meaning preserved: the composition still receives that period object.
    expect(PANEL).not.toMatch(/resolveOrgWindow/);
    expect(TAB).toContain("<DeliveryTabView {...props} />");
    expect(TAB).toMatch(/resolveOrgWindow\(sp\)/);
  });
});
