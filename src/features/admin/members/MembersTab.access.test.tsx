// Who the Members tab shows the roster to (backlog develop-2026-09-17 row 4, operator decision
// 2026-09-24). Members, admins and owners see who they share the org with; only an owner gets the
// management surface (role editors, remove, invites). A viewer keeps the honest refusal. A non-owner
// is never handed the pending invites: they carry invitee emails, and the roster is login, display
// name, role and joined date only.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrgRole } from "@/lib/db/members";

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const h = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "carol") }));
vi.mock("@/lib/authz", () => ({
  hasOrgRole: vi.fn(async (_slug: string, min: OrgRole) => RANK[h.role as OrgRole] >= RANK[min]),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  listOrgMembers: vi.fn(async () => [
    { login: "alice", name: "Alice", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" },
    { login: "carol", name: null, role: "member", createdAt: "2026-02-01T00:00:00.000Z" },
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
import { listOrgMembers, listPendingInvites } from "@/lib/db";

type PanelProps = {
  canManage: boolean;
  initial: { login: string }[];
  initialInvites: { id: string }[];
  selfLogin: string | null;
};

async function renderAs(role: OrgRole) {
  h.role = role;
  return (await MembersTab({ slug: "acme" })) as React.ReactElement<PanelProps & { children?: unknown }>;
}

beforeEach(() => {
  vi.mocked(listOrgMembers).mockClear();
  vi.mocked(listPendingInvites).mockClear();
});

describe("MembersTab: the roster is readable from member up", () => {
  it("a viewer gets the refusal, and neither the roster nor the invites are read", async () => {
    const el = await renderAs("viewer");
    expect(el.type).not.toBe(MembersPanel);
    expect(listOrgMembers).not.toHaveBeenCalled();
    expect(listPendingInvites).not.toHaveBeenCalled();
  });

  it.each(["member", "admin"] as const)("a %s gets a read-only roster with no invites", async (role) => {
    const el = await renderAs(role);
    expect(el.type).toBe(MembersPanel);
    expect(el.props.canManage).toBe(false);
    expect(el.props.initial.map((m) => m.login)).toEqual(["alice", "carol"]);
    expect(el.props.initialInvites).toEqual([]);
    expect(listPendingInvites).not.toHaveBeenCalled();
    expect(el.props.selfLogin).toBe("carol");
  });

  it("an owner gets the management surface with the pending invites", async () => {
    const el = await renderAs("owner");
    expect(el.type).toBe(MembersPanel);
    expect(el.props.canManage).toBe(true);
    expect(el.props.initialInvites.map((i) => i.id)).toEqual(["inv_1"]);
  });
});
