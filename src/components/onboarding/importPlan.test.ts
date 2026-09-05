// W6b: the import request plan — the full matrix of { mock, watch, schedule, upgradeAfter } for one
// wizard run. The upgrade row's invariants are the money-sensitive ones: an upgrade run must watch
// (the header's live scan walks the watchlist) yet must NOT smuggle in the weekly recurring draw the
// user never opted into; and every non-upgrade row must be byte-identical to pre-W6b behavior.

import { describe, it, expect } from "vitest";
import { resolveImportPlan } from "./importPlan";

const APP = { sourceInstallId: "42", publicFunnel: false };

describe("resolveImportPlan — preview-then-upgrade (App path, real headroom)", () => {
  it("plans a mock preview + watch with schedule 'off' when the user did NOT opt into the autoscan", () => {
    expect(resolveImportPlan({ ...APP, canRunReal: true, previewFirst: true, watchOptIn: false })).toEqual({
      mock: true,
      watch: true,
      schedule: "off",
      upgradeAfter: true,
    });
  });

  it("keeps the weekly cadence when the user DID opt in", () => {
    expect(resolveImportPlan({ ...APP, canRunReal: true, previewFirst: true, watchOptIn: true })).toEqual({
      mock: true,
      watch: true,
      schedule: "weekly",
      upgradeAfter: true,
    });
  });

  it("preview-first OFF runs live in the wizard exactly as before (watch = opt-in, no explicit schedule)", () => {
    expect(resolveImportPlan({ ...APP, canRunReal: true, previewFirst: false, watchOptIn: false })).toEqual({
      mock: false,
      watch: false,
      schedule: undefined,
      upgradeAfter: false,
    });
  });
});

describe("resolveImportPlan — rows where no upgrade is ever owed", () => {
  it("no real headroom ⇒ plain disclosed preview, regardless of the toggle (nothing to upgrade to)", () => {
    expect(resolveImportPlan({ ...APP, canRunReal: false, previewFirst: true, watchOptIn: false })).toEqual({
      mock: true,
      watch: false,
      schedule: undefined,
      upgradeAfter: false,
    });
  });

  it("public funnel ⇒ real free scan in the wizard, never the upgrade choreography (no membership/App for /api/org/scan)", () => {
    expect(
      resolveImportPlan({ sourceInstallId: null, publicFunnel: true, canRunReal: true, previewFirst: true, watchOptIn: false }),
    ).toEqual({ mock: false, watch: false, schedule: undefined, upgradeAfter: false });
  });

  it("no installation id ⇒ never an upgrade, even if a caller mislabels the run as non-public", () => {
    expect(
      resolveImportPlan({ sourceInstallId: null, publicFunnel: false, canRunReal: true, previewFirst: true, watchOptIn: true }),
    ).toEqual({ mock: false, watch: true, schedule: undefined, upgradeAfter: false });
  });
});
