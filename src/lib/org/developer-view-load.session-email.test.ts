// The Developer home's private session shape, matched by the viewer's CONFIRMED email as well as the
// login (operator decision 2026-09-24, the row 27 follow-up). Claude Code sends `user.email` as the
// session's key, so a GitHub-login viewer's own sessions arrive under their address, not their login.
//
// The rule: a session counts when its key equals the viewer's login OR an email the auth provider has
// confirmed for the viewer (case-insensitive), and never anyone else's. The loader takes the email as
// an argument the ROUTE resolved (`resolveViewerIdentity`); an unconfirmed address never reaches it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContributorInsights, getOrgBacklog, getRepoStates, getOwnAgentSessions } = vi.hoisted(() => ({
  getContributorInsights: vi.fn(),
  getOrgBacklog: vi.fn(),
  getRepoStates: vi.fn(),
  getOwnAgentSessions: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getContributorInsights, getOrgBacklog, getRepoStates }));
vi.mock("@/lib/db/agent-sessions-viewer", () => ({ getOwnAgentSessions }));

import { getDeveloperView } from "./developer-view-load";
import { CARE_NEVER_SENT_FIELDS, emptyDeveloperView } from "./developer-view";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const stored = (userKey: string | null, n: number) =>
  Array.from({ length: n }, (_, i) => ({ userKey, startedAt: day(i + 1), sessionId: `sess-${userKey}-${i}` }));

let table: ReturnType<typeof stored> = [];

beforeEach(() => {
  vi.clearAllMocks();
  getContributorInsights.mockResolvedValue({ totalContributors: 8, contributors: [], champions: [], namingAllowed: true });
  getOrgBacklog.mockResolvedValue({ byOwner: [] });
  getRepoStates.mockResolvedValue({});
  // Returns EVERY row in the window, so the loader's own fold is what decides whose rows count.
  getOwnAgentSessions.mockImplementation(async (_org: string, _viewer: unknown, since: Date) =>
    table.filter((r) => r.startedAt >= since),
  );
  table = [...stored("ada@acme.io", 10), ...stored("grace@acme.io", 25), ...stored("grace", 6), ...stored(null, 4)];
});

describe("getDeveloperView: sessions matched by the confirmed email", () => {
  it("counts the rows sent under the viewer's confirmed email", async () => {
    const view = await getDeveloperView("ada", "acme", NOW, "ada@acme.io");
    expect(view.ownTelemetry).toEqual({ source: "claude-code", sessions: 10, fields: ["sessionsPerWeek"] });
    expect(view.shape.sessionsPerWeek).toBe(2.3); // 10 / (30 / 7)
  });

  it("hands the reader the login and the confirmed email, resolved by the route, nothing else", async () => {
    await getDeveloperView("ada", "acme", NOW, "ada@acme.io");
    expect(getOwnAgentSessions).toHaveBeenCalledWith("acme", { login: "ada", confirmedEmail: "ada@acme.io" }, day(30));
  });

  it("login match still counts, alongside the email's rows", async () => {
    table.push(...stored("ada", 3));
    expect((await getDeveloperView("ada", "acme", NOW, "ada@acme.io")).ownTelemetry?.sessions).toBe(13);
    expect((await getDeveloperView("ada", "acme", NOW)).ownTelemetry?.sessions).toBe(3);
  });

  it("an unconfirmed email (the route passes none) counts nothing", async () => {
    const view = await getDeveloperView("ada", "acme", NOW, null);
    expect(view).toEqual(emptyDeveloperView("ada"));
  });

  it("matches the email case-insensitively", async () => {
    table = stored("Ada@ACME.io", 6);
    expect((await getDeveloperView("ada", "acme", NOW, "ada@acme.io")).ownTelemetry?.sessions).toBe(6);
  });

  it("never counts another user's login or email", async () => {
    // Grace's 25 email rows and 6 login rows are in the table the reader returned; none may count for Ada.
    table = [...stored("grace@acme.io", 25), ...stored("grace", 6)];
    const view = await getDeveloperView("ada", "acme", NOW, "ada@acme.io");
    expect(view).toEqual(emptyDeveloperView("ada"));
  });

  it("guard: an anonymous viewer gets nothing, whatever email it is handed", async () => {
    const view = await getDeveloperView(null, "acme", NOW, "ada@acme.io");
    expect(getOwnAgentSessions).not.toHaveBeenCalled();
    expect(view).toEqual(emptyDeveloperView(null));
  });

  it("guard: the privacy ledger's never-sent fields still never appear", async () => {
    const view = await getDeveloperView("ada", "acme", NOW, "ada@acme.io");
    const json = JSON.stringify(view);
    for (const leak of ["sess-", "grace", "ada@acme.io"]) expect(json).not.toContain(leak);
    for (const row of view.setup.sharing.filter((r) => CARE_NEVER_SENT_FIELDS.has(r.field))) expect(row.shared).toBe(false);
  });
});
