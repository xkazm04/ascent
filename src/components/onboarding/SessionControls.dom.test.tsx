// @vitest-environment jsdom
//
// Session controls per auth stack (oauth-1). Under the live Supabase wall the "Sign out everywhere
// else" form works (POST /api/auth/revoke-sessions signs out the viewer's OTHER sessions), but the
// re-sync buttons go to /api/auth/login, which only completes on the dormant custom stack. So the
// supabase stack renders the revoke form and no re-sync; the dormant stack keeps both.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/GitHubSignInButton", () => ({
  GitHubSignInButton: ({ label }: { label?: string }) => <button type="button">{label}</button>,
}));

import { SessionControls } from "./SessionControls";

const revokeForm = (root: HTMLElement) => root.querySelector('form[action="/api/auth/revoke-sessions"][method="post"]');

describe("SessionControls", () => {
  it("supabase: renders the revoke form and NO re-sync control", () => {
    const { container } = render(<SessionControls stack="supabase" pendingInstall="acme" />);
    expect(revokeForm(container)).not.toBeNull();
    expect(container.textContent).toContain("Sign out everywhere else");
    expect(container.textContent).not.toMatch(/re-sync/i);
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("dormant: renders both the re-sync control and the revoke form (unchanged)", () => {
    const { container } = render(<SessionControls stack="dormant" />);
    expect(revokeForm(container)).not.toBeNull();
    expect(container.textContent).toContain("Re-sync access");
  });
});
