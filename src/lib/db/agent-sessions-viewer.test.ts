// The one per-person read of AgentSession, against a Prisma double that records the query it got.
// What is pinned is the SHAPE of the query: an exact key match on the viewer's own login, a narrow
// select, and no read at all for a blank key.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, getOrgBySlug } = vi.hoisted(() => ({ findMany: vi.fn(), getOrgBySlug: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({ agentSession: { findMany } }) }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug }));

import { getOwnAgentSessions } from "./agent-sessions-viewer";

const SINCE = new Date("2026-08-25T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  getOrgBySlug.mockResolvedValue({ id: "org-1" });
  findMany.mockResolvedValue([]);
});

describe("getOwnAgentSessions", () => {
  it("matches the viewer's login exactly (and its lower-cased form), inside the org and the window", async () => {
    await getOwnAgentSessions("acme", "Ada", SINCE);
    const { where } = findMany.mock.calls[0]![0];
    expect(where).toEqual({ orgId: "org-1", userKey: { in: ["Ada", "ada"] }, startedAt: { gte: SINCE } });
  });

  it("never widens the key: no contains, no startsWith, no insensitive mode", async () => {
    // `_` and `%` are wildcards to ILIKE. An email-shaped login must not match a look-alike key.
    await getOwnAgentSessions("acme", "a_b@acme.io", SINCE);
    const text = JSON.stringify(findMany.mock.calls[0]![0].where);
    expect(text).not.toMatch(/contains|startsWith|endsWith|insensitive|mode/);
  });

  it("selects the key and the start time only: no session id, repo, cost or tokens", async () => {
    await getOwnAgentSessions("acme", "ada", SINCE);
    expect(findMany.mock.calls[0]![0].select).toEqual({ userKey: true, startedAt: true });
  });

  it("issues no query for a blank login", async () => {
    expect(await getOwnAgentSessions("acme", "   ", SINCE)).toEqual([]);
    expect(getOrgBySlug).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("issues no query for an unknown org", async () => {
    getOrgBySlug.mockResolvedValue(null);
    expect(await getOwnAgentSessions("nope", "ada", SINCE)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
