// Pins that the Members page resolves `selfLogin` across BOTH auth stacks (members-access-control
// 07-16 #1). It used to read the DORMANT custom-OAuth getSession() directly: under the ACTIVE
// Supabase wall that is always null in prod, so MembersPanel's "you" badge and the self-demotion
// confirm gate keyed on selfLogin were silently dead — an owner could demote themselves with one
// unconfirmed select change. The page must use the shared resolveViewerLogin() precedence instead.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockResolveViewerLogin } = vi.hoisted(() => ({ mockResolveViewerLogin: vi.fn() }));

vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: vi.fn(async () => true) }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  listOrgMembers: vi.fn(async () => [
    { login: "alice", name: "Alice", role: "owner", createdAt: new Date("2026-01-01") },
  ]),
  listPendingInvites: vi.fn(async () => []),
}));

import OrgMembers from "./page";
import { MembersPanel } from "@/components/org/members/MembersPanel";

beforeEach(() => {
  mockResolveViewerLogin.mockReset();
});

async function renderPage() {
  return (await OrgMembers({ params: Promise.resolve({ slug: "acme" }) })) as React.ReactElement<{
    selfLogin: string | null;
  }>;
}

describe("OrgMembers page — selfLogin resolution", () => {
  it("passes the ACTIVE-stack viewer login as selfLogin (Supabase wall, no custom session)", async () => {
    // resolveViewerLogin covers both stacks; under the prod Supabase wall it returns the viewer's
    // login even though the dormant getSession() would be null.
    mockResolveViewerLogin.mockResolvedValue("alice");

    const el = await renderPage();

    expect(el.type).toBe(MembersPanel);
    expect(el.props.selfLogin).toBe("alice"); // old code: null → self-demotion guard dead
    expect(mockResolveViewerLogin).toHaveBeenCalledTimes(1);
  });

  it("passes null for an anonymous viewer (both stacks signed out)", async () => {
    mockResolveViewerLogin.mockResolvedValue(null);

    const el = await renderPage();

    expect(el.type).toBe(MembersPanel);
    expect(el.props.selfLogin).toBeNull();
  });
});
