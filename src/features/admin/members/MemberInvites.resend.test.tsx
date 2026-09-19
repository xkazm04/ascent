// @vitest-environment jsdom
//
// One-click resend on the pending-invite roster. Sibling theme file of MemberInvites.test.tsx
// (AGENTS.md: a test file over the 200-LOC cap splits into <name>.<theme>.test.tsx).

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, act, cleanup } from "@testing-library/react";
import { MemberInvites, type InviteRow } from "@/features/admin/members/MemberInvites";

interface Deferred {
  url: string;
  method: string;
  body: string | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}
let calls: Deferred[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          calls.push({
            url: String(url),
            method: init?.method ?? "GET",
            body: typeof init?.body === "string" ? init.body : undefined,
            resolve,
            reject,
          });
        }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const invite = (over: Partial<InviteRow> & { id: string }): InviteRow => ({
  email: null,
  githubLogin: over.id,
  role: "member",
  expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  ...over,
});

describe("InviteList — one-click resend", () => {
  const rowFor = (login: string) => screen.getByText(`@${login}`).closest("li") as HTMLElement;

  it("a single click POSTs action=resend for that row and does not mint a second row", async () => {
    render(<MemberInvites slug="acme" initialInvites={[invite({ id: "alpha" })]} />);
    expect(within(rowFor("alpha")).queryByRole("button", { name: /confirm/i })).toBeNull();

    await act(async () => {
      within(rowFor("alpha")).getByRole("button", { name: /^resend$/i }).click();
    });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body ?? "{}")).toEqual({ org: "acme", id: "alpha", action: "resend" });

    await act(async () => {
      posts[0]!.resolve(
        new Response(
          JSON.stringify({
            invite: {
              id: "alpha",
              email: null,
              githubLogin: "alpha",
              role: "member",
              token: "tok_new",
              expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            },
            emailed: null,
          }),
          { status: 200 },
        ),
      );
      await Promise.resolve();
    });

    expect(screen.getAllByText("@alpha")).toHaveLength(1);
    expect(within(rowFor("alpha")).getByRole("button", { name: /copy link/i })).toBeTruthy();
  });

  it("re-mails an email-pinned invite and discloses delivery without duplicating the row", async () => {
    render(
      <MemberInvites
        slug="acme"
        initialInvites={[invite({ id: "inv_mail", githubLogin: null, email: "dana@example.com" })]}
      />,
    );
    await act(async () => {
      screen.getByRole("button", { name: /^resend$/i }).click();
    });
    await act(async () => {
      calls.find((c) => c.method === "POST")!.resolve(
        new Response(
          JSON.stringify({
            invite: {
              id: "inv_mail",
              email: "dana@example.com",
              githubLogin: null,
              role: "member",
              token: "tok_mail",
              expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            },
            emailed: "sent",
          }),
          { status: 200 },
        ),
      );
      await Promise.resolve();
    });
    expect(screen.getByTestId("invite-delivery").textContent).toMatch(/emailed.*dana@example\.com/i);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
