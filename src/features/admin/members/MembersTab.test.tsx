// Pins that the Members tab resolves `selfLogin` across BOTH auth stacks (members-access-control
// 07-16 #1). It used to read the DORMANT custom-OAuth getSession() directly: under the ACTIVE
// Supabase wall that is always null in prod, so MembersPanel's "you" badge and the self-demotion
// confirm gate keyed on selfLogin were silently dead — an owner could demote themselves with one
// unconfirmed select change. The tab must use the shared resolveViewerLogin() precedence instead.
//
// Moved from src/app/org/[slug]/members/page.test.tsx alongside the Members tab's migration into the
// org dashboard's `?tab=` shell (docs/ORG-TABS-REFACTOR.md) — the route is now a redirect().

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveViewerLogin } = vi.hoisted(() => ({ mockResolveViewerLogin: vi.fn() }));

vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  listOrgMembers: vi.fn(async () => [
    { login: "alice", name: "Alice", role: "owner", createdAt: new Date("2026-01-01") },
  ]),
  listPendingInvites: vi.fn(async () => [
    {
      id: "inv_1",
      email: "dana@example.test",
      githubLogin: null,
      role: "member",
      invitedBy: "alice",
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
    },
  ]),
}));

import { MembersTab } from "./MembersTab";
import { MembersPanel } from "./MembersPanel";

beforeEach(() => {
  mockResolveViewerLogin.mockReset();
});

async function renderTab() {
  return (await MembersTab({ slug: "acme" })) as React.ReactElement<{
    selfLogin: string | null;
    initialInvites: { id: string; invitedBy: string | null }[];
  }>;
}

describe("MembersTab — selfLogin resolution", () => {
  it("passes the ACTIVE-stack viewer login as selfLogin (Supabase wall, no custom session)", async () => {
    // resolveViewerLogin covers both stacks; under the prod Supabase wall it returns the viewer's
    // login even though the dormant getSession() would be null.
    mockResolveViewerLogin.mockResolvedValue("alice");

    const el = await renderTab();

    expect(el.type).toBe(MembersPanel);
    expect(el.props.selfLogin).toBe("alice"); // old code: null → self-demotion guard dead
    expect(mockResolveViewerLogin).toHaveBeenCalledTimes(1);
  });

  it("passes null for an anonymous viewer (both stacks signed out)", async () => {
    mockResolveViewerLogin.mockResolvedValue(null);

    const el = await renderTab();

    expect(el.type).toBe(MembersPanel);
    expect(el.props.selfLogin).toBeNull();
  });
});

// `invitedBy` is written by createInvite on every invite and carried through PendingInviteSummary,
// and the tab dropped it on the way to the panel — so the owner's pending list could not answer "who
// sent this?" in an org with more than one owner, which is the only kind of org where the question
// arises. Present-but-unwired (docs/BACKLOG.md MC-M1).
describe("MembersTab — the pending list carries its provenance", () => {
  it("passes invitedBy through to the panel", async () => {
    mockResolveViewerLogin.mockResolvedValue("alice");
    const el = await renderTab();
    expect(el.props.initialInvites[0]).toMatchObject({ id: "inv_1", invitedBy: "alice" });
  });
});
