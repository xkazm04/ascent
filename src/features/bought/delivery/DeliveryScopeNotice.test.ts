// Delivery's period disclosure. DeliveryTab's header has documented since G7-09 that the trend is
// the tab's ONE windowed read while PR signals, governance and activity come off each repo's latest
// scan — and nothing on screen said so, under a period control sitting right above them. The panel is
// an async server component over four db reads, so the mount is pinned at the source level.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PANEL = fs.readFileSync(path.resolve(__dirname, "DeliveryCorePanel.tsx"), "utf8");
const TAB = fs.readFileSync(path.resolve(__dirname, "DeliveryTab.tsx"), "utf8");

describe("Delivery core panel scope notice", () => {
  it("mounts the notice above the snapshot sections", () => {
    expect(PANEL).toMatch(/<SnapshotScopeNotice/);
    expect(PANEL.indexOf("<SnapshotScopeNotice")).toBeLessThan(PANEL.indexOf("<DeliveryPrSection"));
  });

  it("claims PARTIAL scope — the trend above it really is period-scoped", () => {
    expect(PANEL).toMatch(/scope="partial"/);
  });

  // The /org redesign demoted the notice's second half into a WhyChip on the notice itself (§2.1 D):
  // the reader still sees "the trend is period-scoped, everything below is a scan-time snapshot" at
  // first sight, and the list of which sections those are — plus the `Scan.prStats` reason — is one
  // keystroke away instead of four lines of standing prose. Case-insensitive because the sentence now
  // opens the disclosure rather than continuing the notice, so it starts with a capital.
  it("names which sections are period-scoped and which are a scan-time snapshot", () => {
    expect(PANEL).toMatch(/period-scoped/);
    expect(PANEL).toMatch(/pull request signals, branch governance and commit\s+activity/i);
    expect(PANEL).toMatch(/scan-time snapshot/);
  });

  it("keeps the reason the snapshot half cannot be re-scoped, in the disclosure", () => {
    expect(PANEL).toMatch(/<WhyChip/);
    expect(PANEL).toMatch(/Scan\.prStats/);
  });

  it("takes the period from the tab rather than re-resolving it without the search params", () => {
    // A local resolveOrgWindow({}) here would silently drop an explicit ?range= and name the cookie's
    // period on a shared link.
    expect(PANEL).not.toMatch(/resolveOrgWindow/);
    expect(TAB).toMatch(/<DeliveryCorePanel slug=\{slug\} scope=\{scope\} period=\{period\} \/>/);
  });
});
