// @vitest-environment jsdom
//
// The read-only roster a non-owner sees (backlog develop-2026-09-17 row 4): the same people, roles
// and joined dates an owner sees, but no role editor, no remove affordance and no invite form. The
// server refuses every one of those writes to a non-owner anyway; showing the controls would only
// hand the viewer a guaranteed 403.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MembersPanel } from "@/features/admin/members/MembersPanel";

afterEach(cleanup);

const members = [
  { login: "alice", name: "Alice", role: "owner" as const, createdAt: "2026-01-01T00:00:00.000Z" },
  { login: "carol", name: null, role: "member" as const, createdAt: "2026-02-01T00:00:00.000Z" },
];

function renderPanel(canManage: boolean) {
  render(<MembersPanel slug="acme" initial={members} initialInvites={[]} selfLogin="carol" canManage={canManage} />);
}

describe("MembersPanel: read-only roster for a non-owner", () => {
  it("lists every member with their role as text, not as an editor", () => {
    renderPanel(false);
    expect(screen.getByText("@alice")).toBeTruthy();
    expect(screen.getByText("@carol")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("owner").getAttribute("title")).toMatch(/Full control/);
  });

  it("offers no remove and no invite form", () => {
    renderPanel(false);
    expect(screen.queryByText("remove")).toBeNull();
    expect(screen.queryByText("Invite a teammate")).toBeNull();
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("says who can change the roster", () => {
    renderPanel(false);
    expect(screen.getAllByText(/Only an owner can change/).length).toBeGreaterThan(0);
  });

  it("guard: an owner keeps the role editors, remove and the invite form", () => {
    renderPanel(true);
    expect(screen.getByLabelText("Role for alice")).toBeTruthy();
    expect(screen.getAllByText("remove")).toHaveLength(2);
    expect(screen.getByText("Invite a teammate")).toBeTruthy();
  });
});
