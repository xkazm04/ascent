// Delivery's period disclosure. DeliveryTab's header has documented since G7-09 that the trend is
// the tab's ONE windowed read while PR signals, governance and activity come off each repo's latest
// scan, and nothing on screen said so, under a period control sitting right above them. The panel is
// an async server component over four db reads, so the mount is pinned at the source level.
//
// The entry now picks a composition. Altimeter still mounts SnapshotScopeNotice (scope="partial")
// above the PR section. Prism states the same split in DeliveryNotice.v2. Both keep the period the
// tab already resolved.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (name: string) => fs.readFileSync(path.resolve(__dirname, name), "utf8");
const PANEL = read("DeliveryCorePanel.tsx");
const V1 = read("DeliveryCore.v1.tsx");
const V2 = read("DeliveryCore.v2.tsx");
const NOTICE = read("DeliveryNotice.v2.tsx");
const TAB = read("DeliveryTab.tsx");
const TAB_V1 = read("DeliveryTab.v1.tsx");

describe("Delivery core panel scope notice", () => {
  it("mounts the notice above the snapshot sections", () => {
    expect(V1).toMatch(/<SnapshotScopeNotice/);
    expect(V1.indexOf("<SnapshotScopeNotice")).toBeLessThan(V1.indexOf("<DeliveryPrSection"));
    expect(V2.indexOf("<DeliveryNoticeV2")).toBeLessThan(V2.indexOf("<DeliveryPrV2"));
  });

  it("claims PARTIAL scope — the trend above it really is period-scoped", () => {
    expect(V1).toMatch(/scope="partial"/);
  });

  // The /org redesign demoted the notice's second half into a WhyChip on the notice itself (§2.1 D):
  // the reader still sees "the trend is period-scoped, everything below is a scan-time snapshot" at
  // first sight, and the list of which sections those are — plus the `Scan.prStats` reason — is one
  // keystroke away instead of four lines of standing prose. Case-insensitive because the sentence now
  // opens the disclosure rather than continuing the notice, so it starts with a capital.
  it("names which sections are period-scoped and which are a scan-time snapshot", () => {
    for (const src of [V1, NOTICE]) {
      expect(src).toMatch(/period-scoped/);
      expect(src).toMatch(/pull request signals, branch governance and commit\s+activity/i);
      expect(src).toMatch(/scan-time snapshot/);
    }
  });

  it("keeps the reason the snapshot half cannot be re-scoped, in the disclosure", () => {
    for (const src of [V1, NOTICE]) {
      expect(src).toMatch(/<WhyChip/);
      expect(src).toMatch(/Scan\.prStats/);
    }
  });

  it("takes the period from the tab rather than re-resolving it without the search params", () => {
    // A local resolveOrgWindow({}) here would silently drop an explicit ?range= and name the cookie's
    // period on a shared link. Meaning preserved: v1 still receives that period object, and the entry
    // only adds the theme pick.
    expect(PANEL).not.toMatch(/resolveOrgWindow/);
    expect(TAB_V1).toMatch(/<DeliveryCorePanel slug=\{slug\} scope=\{scope\} period=\{period\} \/>/);
    expect(TAB).toMatch(/getTheme\(\)/);
    expect(TAB).toMatch(/resolveOrgWindow\(sp\)/);
  });
});
