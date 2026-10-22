// The shared public org has no owner, but hasOrgRole("public", "owner") resolves true for any signed-in
// viewer (the funnel has no owner to check). The Members tab must still render the non-owner view for
// it: a read-only roster, no management controls, no pending invites (security scan 2026-10-07, O14).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "stranger") }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  listOrgMembers: vi.fn(async () => [{ login: "alice", name: "Alice", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }]),
  listPendingInvites: vi.fn(async () => [{ id: "inv_1", email: "dana@example.test", githubLogin: null, role: "member", invitedBy: "alice", expiresAt: "2026-09-08T00:00:00.000Z" }]),
}));

import { MembersTab } from "./MembersTab";
import { MembersPanel } from "./MembersPanel";
import { listPendingInvites } from "@/lib/db";

type PanelProps = { canManage: boolean; initialInvites: { id: string }[] };

beforeEach(() => vi.mocked(listPendingInvites).mockClear());

describe("MembersTab on the shared public org", () => {
  it.each(["public", "Public", " public "])("renders the non-owner view for %j even though hasOrgRole is true", async (slug) => {
    const el = (await MembersTab({ slug })) as React.ReactElement<PanelProps>;
    expect(el.type).toBe(MembersPanel);
    expect(el.props.canManage).toBe(false);
    expect(el.props.initialInvites).toEqual([]);
    expect(listPendingInvites).not.toHaveBeenCalled();
  });

  it("control: a real org's owner still gets the management surface", async () => {
    const el = (await MembersTab({ slug: "acme" })) as React.ReactElement<PanelProps>;
    expect(el.props.canManage).toBe(true);
    expect(el.props.initialInvites).toHaveLength(1);
  });
});
