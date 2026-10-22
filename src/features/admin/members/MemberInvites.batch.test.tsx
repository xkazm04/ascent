// @vitest-environment jsdom
//
// Batch invite (members-1): a paste of several targets is previewed against the roster and the
// pending list the page already holds (no fetch), then committed in ONE request. A single target
// keeps today's body and today's no-preview path.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { MemberInvites } from "./MemberInvites";
import { useMemberInvites } from "./useMemberInvites";
import type { InviteRow, Member } from "./MembersTypes";

const members: Member[] = [{ login: "bob", name: null, role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }];
const pending: InviteRow[] = [
  { id: "inv_carol", email: null, githubLogin: "carol", role: "member", expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sentBody = (i: number) => JSON.parse(String((fetchMock.mock.calls[i]![1] as RequestInit).body));

describe("useMemberInvites: the preview is local", () => {
  it("text that parses to more than one target enters 'preview' with counts and makes no fetch", () => {
    const { result } = renderHook(() => useMemberInvites("acme", pending, members));
    act(() => result.current.setInviteTarget("alice, bob\n@carol dave"));
    expect(result.current.mode).toBe("preview");
    expect(result.current.preview!.counts).toMatchObject({ invite: 2, already_member: 1, already_pending: 1, invalid: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirm makes exactly one fetch with action 'batch' and the targets", async () => {
    const { result } = renderHook(() => useMemberInvites("acme", pending, members));
    act(() => result.current.setInviteTarget("alice dave"));
    await act(async () => {
      await result.current.submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0)).toEqual({ org: "acme", action: "batch", role: "member", targets: ["alice", "dave"] });
  });

  it("a single target posts today's exact body with no preview step (guard)", async () => {
    const { result } = renderHook(() => useMemberInvites("acme", [], []));
    act(() => result.current.setInviteTarget("alice"));
    expect(result.current.mode).toBe("single");
    await act(async () => {
      await result.current.submit();
    });
    expect(sentBody(0)).toEqual({ org: "acme", role: "member", githubLogin: "alice" });
  });
});

describe("MemberInvites: after the batch response", () => {
  it("prepends created rows with their links, clears the preview, and offers resend on a pending row", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        results: [
          {
            target: "alice",
            outcome: "created",
            emailed: null,
            invite: { id: "inv_alice", email: null, githubLogin: "alice", role: "member", token: "tok_a", expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString() },
          },
          { target: "bob", outcome: "already_member", role: "admin" },
          { target: "carol", outcome: "already_pending", inviteId: "inv_carol" },
        ],
      }),
    );
    render(<MemberInvites slug="acme" initialInvites={pending} members={members} />);
    fireEvent.change(screen.getByPlaceholderText(/GitHub login or email/i), { target: { value: "alice bob carol" } });

    const preview = screen.getByTestId("invite-batch-preview");
    expect(preview.textContent).toContain("1 new");
    expect(preview.textContent).not.toContain(String.fromCharCode(0x2014));

    await act(async () => {
      screen.getByRole("button", { name: /invite 1/i }).click();
    });

    expect(screen.queryByTestId("invite-batch-preview")).toBeNull();
    // The created row joined the pending list carrying its token, so its link can be copied.
    const copyRow = screen.getByRole("button", { name: /copy link/i }).closest("li") as HTMLElement;
    expect(within(copyRow).getByText("@alice")).toBeTruthy();

    const results = screen.getByTestId("invite-batch-results");
    expect(results.textContent).not.toContain(String.fromCharCode(0x2014));
    expect(results.textContent).toMatch(/already a member.*admin/i);
    const carolResult = within(results).getByText(/@carol/).closest("li") as HTMLElement;
    fetchMock.mockResolvedValueOnce(json({ invite: { ...pending[0], token: "tok_c" }, emailed: null }));
    await act(async () => {
      within(carolResult).getByRole("button", { name: /resend/i }).click();
    });
    expect(sentBody(1)).toEqual({ org: "acme", id: "inv_carol", action: "resend" });
  });
});
