// The Developer home's private session shape, filled from the viewer's OWN AgentSession rows
// (backlog develop-2026-09-17 row 27). The session reader is mocked with a fake table that filters
// on the key it is handed, so these pin what the loader asks for as well as what it does with it.
//
// The privacy rules, one test each: own login only; another login's rows leave the SAME view an
// unknown user gets (no present-but-empty trace); anonymous issues no read; nothing of a session but
// a count reaches the payload; the org aggregate never reads a person's sessions.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContributorInsights, getOrgBacklog, getRepoStates, getOwnAgentSessions } = vi.hoisted(() => ({
  getContributorInsights: vi.fn(),
  getOrgBacklog: vi.fn(),
  getRepoStates: vi.fn(),
  getOwnAgentSessions: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getContributorInsights, getOrgBacklog, getRepoStates }));
vi.mock("@/lib/db/agent-sessions-viewer", () => ({ getOwnAgentSessions }));

import { getCareOrgAggregate, getDeveloperView } from "./developer-view-load";
import { CARE_NEVER_SENT_FIELDS } from "./developer-view";
import { careShapeEmptyReason } from "./care-shape-contract";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** A stored row as the database would hold it, carrying fields the loader must never pass on. */
const stored = (userKey: string | null, daysAgo: number, i: number) => ({
  userKey,
  startedAt: day(daysAgo),
  sessionId: `sess-${userKey}-${i}`,
  repoFullName: "acme/secret-repo",
  transcript: "SECRET-TRANSCRIPT-TEXT",
  prompt: "SECRET-PROMPT-TEXT",
});

let table: ReturnType<typeof stored>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  getContributorInsights.mockResolvedValue({ totalContributors: 8, contributors: [], champions: [], namingAllowed: true });
  getOrgBacklog.mockResolvedValue({ byOwner: [] });
  getRepoStates.mockResolvedValue({});
  // The fake reader filters exactly like the real one (exact key), so a loader that passed the wrong
  // identity would get the wrong rows back.
  getOwnAgentSessions.mockImplementation(async (_org: string, login: string, since: Date) =>
    table.filter((r) => r.userKey === login && r.startedAt >= since),
  );
  table = [
    ...Array.from({ length: 12 }, (_, i) => stored("ada", i + 1, i)),
    ...Array.from({ length: 30 }, (_, i) => stored("grace", i % 20, i)),
    stored(null, 2, 99),
  ];
});

describe("getDeveloperView: the private session shape", () => {
  it("fills sessions per week from the viewer's own rows in the last 30 days", async () => {
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.shape.sessionsPerWeek).toBe(2.8); // 12 sessions / (30 / 7) weeks
    expect(view.ownTelemetry).toEqual({ source: "claude-code", sessions: 12, fields: ["sessionsPerWeek"] });
    expect(careShapeEmptyReason(view, "sessionsPerWeek")).toBeNull();
    // The six fields telemetry cannot measure keep their honest empty reason.
    expect(careShapeEmptyReason(view, "planModePct")).toBe("no-share-received");
  });

  it("asks the reader for the viewer's own login and the 30-day window, nothing else", async () => {
    await getDeveloperView("ada", "acme", NOW);
    expect(getOwnAgentSessions).toHaveBeenCalledTimes(1);
    expect(getOwnAgentSessions).toHaveBeenCalledWith("acme", "ada", day(30));
  });

  it("guard: gives a login with no rows of its own exactly the view an unknown user gets", async () => {
    // Grace has 30 sessions in this org; Linus has none. Linus's view must carry no trace of hers.
    const linus = await getDeveloperView("linus", "acme", NOW);
    table = [];
    const nobody = await getDeveloperView("linus", "acme", NOW);
    expect(linus).toEqual(nobody);
    expect(linus.ownTelemetry).toBeNull();
    expect(linus.shape.sessionsPerWeek).toBeNull();
  });

  it("drops a row under another key even if the reader returned it (the fold re-checks)", async () => {
    getOwnAgentSessions.mockResolvedValue(table);
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.ownTelemetry?.sessions).toBe(12);
  });

  it("guard: issues no session read for an anonymous viewer", async () => {
    const view = await getDeveloperView(null, "acme", NOW);
    expect(getOwnAgentSessions).not.toHaveBeenCalled();
    expect(view.ownTelemetry).toBeNull();
  });

  it("says too few sessions, with no number, below the sample floor", async () => {
    table = Array.from({ length: 3 }, (_, i) => stored("ada", i + 1, i));
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.shape.sessionsPerWeek).toBeNull();
    expect(careShapeEmptyReason(view, "sessionsPerWeek")).toBe("few-own-sessions");
  });

  it("guard: is best-effort: a failing session read leaves the honest empty shape", async () => {
    getOwnAgentSessions.mockRejectedValue(new Error("db down"));
    const view = await getDeveloperView("ada", "acme", NOW);
    expect(view.ownTelemetry).toBeNull();
    expect(view.activityState).toBe("absent");
  });

  it("guard: puts nothing of a session but a count into the payload", async () => {
    const view = await getDeveloperView("ada", "acme", NOW);
    const json = JSON.stringify(view);
    for (const leak of ["SECRET-TRANSCRIPT-TEXT", "SECRET-PROMPT-TEXT", "sess-ada", "acme/secret-repo", "grace"]) {
      expect(json).not.toContain(leak);
    }
    // No key anywhere in the payload names a session's identity or content.
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
    };
    walk(view);
    for (const k of ["userKey", "sessionId", "transcript", "prompt", "repoFullName", "startedAt"]) expect(keys.has(k)).toBe(false);
    // And the ledger still says the never-sent rows were never sent.
    for (const row of view.setup.sharing.filter((r) => CARE_NEVER_SENT_FIELDS.has(r.field))) expect(row.shared).toBe(false);
  });

  it("guard: the org aggregate never reads a person's sessions", async () => {
    const org = await getCareOrgAggregate("acme");
    expect(getOwnAgentSessions).not.toHaveBeenCalled();
    expect(JSON.stringify(org)).not.toMatch(/ada|grace|sessionsPerWeek/);
  });
});
