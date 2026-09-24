// The Developer home reads back the viewer's OWN care share (backlog develop-2026-09-17 row 46).
// The share reader is a fake keyed store that answers only for the login it is handed, so these pin
// what the loader asks for as well as what it does with the answer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContributorInsights, getOrgBacklog, getRepoStates, getOwnAgentSessions, getMentorShare } = vi.hoisted(() => ({
  getContributorInsights: vi.fn(),
  getOrgBacklog: vi.fn(),
  getRepoStates: vi.fn(),
  getOwnAgentSessions: vi.fn(),
  getMentorShare: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getContributorInsights, getOrgBacklog, getRepoStates }));
vi.mock("@/lib/db/agent-sessions-viewer", () => ({ getOwnAgentSessions }));
vi.mock("@/lib/db/mentor-share", () => ({ getMentorShare }));

import { getDeveloperView } from "./developer-view-load";
import { careNeverSent } from "./developer-view";
import { validateCareShare } from "./care-share-contract";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const SHARED_AT = "2026-09-23T09:00:00.000Z";

const body = {
  contract: 1,
  profile: { role: "backend engineer", archetypeHint: "verifier", goals: ["fewer re-corrections"] },
  moves: [{ id: "plan-mode", title: "Plan mode first", state: "kept", category: "session", why: "re-corrections", expectedSaving: 95, tryFor: null, at: "2026-09-20T10:00:00Z" }],
  journal: [
    { at: "2026-09-10T08:00:00Z", line: "older" },
    { at: "2026-09-21T08:00:00Z", line: "newer", kind: "retro" },
  ],
  shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { sessionsPerWeek: 3, planModePct: { reason: "below-sample" } } },
  setup: { hookInstalled: true },
};
const valid = validateCareShare(body);
if (!valid.ok) throw new Error(valid.errors.join("; "));
let store: Map<string, { share: typeof valid.share; sharedAt: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  store = new Map([["ada", { share: valid.share, sharedAt: SHARED_AT }]]);
  getContributorInsights.mockResolvedValue({ totalContributors: 8, contributors: [], champions: [], namingAllowed: true });
  getOrgBacklog.mockResolvedValue({ byOwner: [] });
  getRepoStates.mockResolvedValue({});
  getOwnAgentSessions.mockResolvedValue([]);
  getMentorShare.mockImplementation(async (login: string | null) => (login ? store.get(login.toLowerCase()) ?? null : null));
});

describe("getDeveloperView reads the viewer's own share", () => {
  it("a stored share returns on the next load: profile, moves, journal, shape and setup", async () => {
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(getMentorShare).toHaveBeenCalledWith("ada");
    expect(view.profile).toEqual({ role: "backend engineer", archetypeHint: "verifier", goals: ["fewer re-corrections"], sharedAt: SHARED_AT });
    expect(view.moves).toEqual([expect.objectContaining({ id: "plan-mode", state: "kept", evidence: null, at: "2026-09-20T10:00:00.000Z" })]);
    expect(view.journal.map((e) => e.line)).toEqual(["newer", "older"]);
    expect(view.shape.sessionsPerWeek).toBe(3);
    expect(view.sharedFields).toEqual(["sessionsPerWeek", "planModePct"]);
    expect(view.shapeReasons).toEqual({ planModePct: "below-sample" });
    expect(view.setup).toMatchObject({ mentorInstalled: true, hookInstalled: true, lastShareAt: SHARED_AT });
  });

  it("every date on the view is an ISO string", async () => {
    const view = await getDeveloperView("ada", "acme", NOW);
    for (const iso of [view.profile.sharedAt, view.setup.lastShareAt, ...view.moves.map((m) => m.at), ...view.journal.map((e) => e.at)]) {
      expect(typeof iso).toBe("string");
      expect(new Date(iso!).toISOString()).toBe(iso);
    }
  });

  it("lights the ledger rows the share carried, and never a never-sent row", async () => {
    const view = await getDeveloperView("ada", "acme", NOW);
    const shared = Object.fromEntries(view.setup.sharing.map((r) => [r.field, r.shared]));
    expect(shared["Session counts (30d)"]).toBe(true);
    expect(shared["Plan-mode ratio"]).toBe(true);
    expect(shared["Moves kept / dropped"]).toBe(true);
    expect(shared["Skill invokes"]).toBe(false);
    for (const row of view.setup.sharing.filter(careNeverSent)) expect(row.shared).toBe(false);
  });

  it("another login's share never reaches the view: bob gets exactly the view of someone who never shared", async () => {
    const bob = await getDeveloperView("bob", "acme", NOW);
    store.clear();
    const nobody = await getDeveloperView("bob", "acme", NOW);
    expect(bob).toEqual(nobody);
    expect(getMentorShare).not.toHaveBeenCalledWith("ada");
  });

  it("signed out issues no share read", async () => {
    await getDeveloperView(null, "acme", NOW);
    expect(getMentorShare).not.toHaveBeenCalled();
  });

  it("after a delete the care loop is the honest empty state again", async () => {
    const before = await getDeveloperView("carol", "acme", NOW);
    store.delete("ada");
    const after = await getDeveloperView("ada", "acme", NOW);
    expect({ ...after, login: "carol" }).toEqual(before);
  });

  it("a failed share read degrades to nothing shared, never an error", async () => {
    getMentorShare.mockRejectedValue(new Error("db down"));
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.setup.lastShareAt).toBeNull();
  });

  it("guard: a field the developer shared wins over their own telemetry", async () => {
    const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
    getOwnAgentSessions.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ userKey: "ada", startedAt: day(i + 1) })));
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.shape.sessionsPerWeek).toBe(3);
    expect(view.ownTelemetry).toBeNull();
  });
});
