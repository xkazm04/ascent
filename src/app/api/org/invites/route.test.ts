// POST /api/org/invites — the create path, now that it also DELIVERS the invite (G7-02). The invite
// mail is the one message in this product sent to an address nobody has verified: an org owner types
// it in. So what's pinned here is who can trigger a send, when it is suppressed, and that a failed or
// unconfigured send never costs the owner the invite they just created.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  createInvite: vi.fn(async () => ({
    id: "inv_1",
    email: "invitee@example.test",
    githubLogin: null,
    role: "member",
    token: "tok_abc",
    invitedBy: "octocat",
    createdAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-07-08T00:00:00.000Z",
  })),
  listPendingInvites: vi.fn(async () => []),
  recordOrgAudit: vi.fn(async () => {}),
  revokeInvite: vi.fn(async () => true),
}));

vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/email/invite", () => ({ dispatchInviteEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { POST } from "./route";
import { createInvite, recordOrgAudit } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { dispatchInviteEmail } from "@/lib/email/invite";

const mockCreate = vi.mocked(createInvite);
const mockAudit = vi.mocked(recordOrgAudit);
const mockRole = vi.mocked(requireOrgRole);
const mockSend = vi.mocked(dispatchInviteEmail);

function post(body: unknown) {
  return new Request("http://localhost/api/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const bodyOf = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ASCENT_PUBLIC_URL = "https://ascent.test";
  mockRole.mockResolvedValue(null as never);
  mockSend.mockResolvedValue({ ok: true, skipped: false });
  // clearAllMocks clears CALLS, not implementations — restate the default invite each test.
  mockCreate.mockResolvedValue({
    id: "inv_1",
    email: "invitee@example.test",
    githubLogin: null,
    role: "member",
    token: "tok_abc",
    invitedBy: "octocat",
    createdAt: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-07-08T00:00:00.000Z",
  } as never);
});

describe("who gets mailed, and when", () => {
  it("mails the invitee at the address the owner supplied, with the absolute accept link", async () => {
    const res = await POST(post({ org: "acme", role: "member", email: "invitee@example.test" }));
    expect(await bodyOf(res)).toMatchObject({ emailed: "sent" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, input] = mockSend.mock.calls[0]!;
    expect(to).toBe("invitee@example.test");
    expect(input).toMatchObject({ org: "acme", role: "member", url: "https://ascent.test/invite/tok_abc", invitedBy: "octocat" });
  });

  it("sends NOTHING for a login-pinned invite (there is no address to send to)", async () => {
    mockCreate.mockResolvedValue({
      id: "inv_2", email: null, githubLogin: "someone", role: "member", token: "t", invitedBy: "octocat",
      createdAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-07-08T00:00:00.000Z",
    } as never);
    const res = await POST(post({ org: "acme", role: "member", githubLogin: "someone" }));
    expect(await bodyOf(res)).toMatchObject({ emailed: null });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("`notify: false` is the per-request opt-out — the invite is still created", async () => {
    const res = await POST(post({ org: "acme", role: "member", email: "invitee@example.test", notify: false }));
    const body = await bodyOf(res);
    expect(body.invite.token).toBe("tok_abc");
    expect(body.emailed).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a non-owner can't trigger a send — the role gate runs first", async () => {
    mockRole.mockResolvedValue(new Response("nope", { status: 403 }) as never);
    await POST(post({ org: "acme", role: "member", email: "invitee@example.test" }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a malformed email is rejected before anything is created or sent", async () => {
    const res = await POST(post({ org: "acme", role: "member", email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("delivery never costs the owner the invite", () => {
  it("reports 'skipped' (not a false success) on a deploy with no email provider", async () => {
    mockSend.mockResolvedValue({ ok: true, skipped: true });
    const body = await bodyOf(await POST(post({ org: "acme", role: "member", email: "invitee@example.test" })));
    expect(body.emailed).toBe("skipped");
    expect(body.invite.token).toBe("tok_abc"); // the manual copy/paste path is untouched
  });

  it("reports 'failed' and still returns the invite when the provider errors", async () => {
    mockSend.mockResolvedValue({ ok: false, skipped: false });
    const body = await bodyOf(await POST(post({ org: "acme", role: "member", email: "invitee@example.test" })));
    expect(body.emailed).toBe("failed");
    expect(body.invite.id).toBe("inv_1");
  });

  it("records the delivery outcome in the org audit trail", async () => {
    await POST(post({ org: "acme", role: "member", email: "invitee@example.test" }));
    expect(mockAudit).toHaveBeenCalledWith(
      "org.member.invited",
      "acme",
      expect.objectContaining({ emailed: "sent", target: "invitee@example.test" }),
      "octocat",
    );
  });

  it("omits the link (rather than emitting a broken one) when no public URL is configured", async () => {
    delete process.env.ASCENT_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    await POST(post({ org: "acme", role: "member", email: "invitee@example.test" }));
    expect(mockSend.mock.calls[0]![1]).toMatchObject({ url: null });
  });
});
