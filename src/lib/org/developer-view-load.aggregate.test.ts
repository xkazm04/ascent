// The org care aggregate as the loaders serve it (C4, challenge 2026-10-22d developer-0): ONE producer
// feeds the Contributors Care section and, only for a viewer whose own share consents, their bands.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContributorInsights, getOrgBacklog, getRepoStates, getOwnAgentSessions, getMentorShare, getOrgCareCohort } = vi.hoisted(() => ({
  getContributorInsights: vi.fn(),
  getOrgBacklog: vi.fn(),
  getRepoStates: vi.fn(),
  getOwnAgentSessions: vi.fn(),
  getMentorShare: vi.fn(),
  getOrgCareCohort: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getContributorInsights, getOrgBacklog, getRepoStates }));
vi.mock("@/lib/db/agent-sessions-viewer", () => ({ getOwnAgentSessions }));
vi.mock("@/lib/db/mentor-share", () => ({ getMentorShare }));
vi.mock("@/lib/db/mentor-share-cohort", () => ({ getOrgCareCohort }));

import { getCareOrgAggregate, getDeveloperView } from "./developer-view-load";
import { applyMentorShare } from "./care-share-view";
import { careNeverSent, emptyDeveloperView, emptyOrgView } from "./developer-view";
import type { CareSharePayload } from "./care-share-contract";
import { PUBLIC_ORG } from "@/lib/org-constants";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const shareOf = (planModePct: number, consent?: boolean): CareSharePayload => ({
  contract: 1,
  ...(consent === undefined ? {} : { consent: { orgAggregate: consent } }),
  shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { planModePct } },
});
const COHORT = { shares: [10, 20, 30, 40, 50].map((v) => shareOf(v, true)) };

beforeEach(() => {
  vi.clearAllMocks();
  getContributorInsights.mockResolvedValue({ totalContributors: 12, contributors: [], champions: [], namingAllowed: true });
  getOrgBacklog.mockResolvedValue({ byOwner: [] });
  getRepoStates.mockResolvedValue({});
  getOwnAgentSessions.mockResolvedValue([]);
  getMentorShare.mockResolvedValue(null);
  getOrgCareCohort.mockResolvedValue(COHORT);
});

describe("getCareOrgAggregate", () => {
  it("builds the floored aggregate from the cohort of a real workspace", async () => {
    const agg = await getCareOrgAggregate("acme");
    expect(getOrgCareCohort).toHaveBeenCalledWith("acme");
    expect(agg.population).toBe(12);
    expect(agg.shapeBands.planModePct).toEqual({ p25: 20, p50: 30, p75: 40 });
  });

  it("the public org is the empty aggregate and never reads a cohort", async () => {
    expect(await getCareOrgAggregate(PUBLIC_ORG)).toEqual(emptyOrgView(12));
    expect(getOrgCareCohort).not.toHaveBeenCalled();
  });

  it("under the population floor no cohort is read at all", async () => {
    getContributorInsights.mockResolvedValue({ totalContributors: 2, contributors: [], champions: [], namingAllowed: false });
    expect(await getCareOrgAggregate("acme")).toEqual(emptyOrgView(2));
    expect(getOrgCareCohort).not.toHaveBeenCalled();
  });

  it("a cohort read failure is the honest empty aggregate, not an error", async () => {
    getOrgCareCohort.mockRejectedValue(new Error("db down"));
    expect(await getCareOrgAggregate("acme")).toEqual(emptyOrgView(12));
  });
});

describe("getDeveloperView: orgBands only for a viewer who consented", () => {
  it("own consent true -> orgBands is the org aggregate's shapeBands", async () => {
    getMentorShare.mockResolvedValue({ share: shareOf(35, true), sharedAt: "2026-10-21T00:00:00.000Z" });
    const view = await getDeveloperView("ada", "acme", NOW);
    const agg = await getCareOrgAggregate("acme");
    expect(view.orgBands).toEqual(agg.shapeBands);
    expect(view.orgBands?.planModePct).toEqual({ p25: 20, p50: 30, p75: 40 });
  });

  it.each([[false], [undefined]])("own consent %s -> orgBands stays null and no cohort is read", async (consent) => {
    getMentorShare.mockResolvedValue({ share: shareOf(35, consent), sharedAt: "2026-10-21T00:00:00.000Z" });
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.orgBands).toBeNull();
    expect(getOrgCareCohort).not.toHaveBeenCalled();
  });
});

describe("the privacy ledger's 'Anonymous org bands' row is a switch, not a lock", () => {
  const row = (share: CareSharePayload) => {
    const view = emptyDeveloperView("ada");
    applyMentorShare(view, share, "2026-10-21T00:00:00.000Z");
    return view.setup.sharing.find((r) => r.field === "Anonymous org bands");
  };

  it("shared:true with consent, shared:false without, and never classed as never-sent", () => {
    expect(row(shareOf(35, true))).toMatchObject({ shared: true });
    const off = row(shareOf(35));
    expect(off).toMatchObject({ shared: false });
    expect(careNeverSent(off!)).toBe(false);
    expect(JSON.stringify(off)).not.toContain(String.fromCharCode(0x2014));
  });
});
