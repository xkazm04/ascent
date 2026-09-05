// The stop switch. Two properties matter: a GET must never mutate (mail clients and security gateways
// prefetch links — a prefetch that muted a tenant's alerting would be indistinguishable from a click),
// and only a SIGNED token may act, because acting clears the org's alert sink.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  setOrgAlertWebhook: vi.fn(async () => null),
}));

import { GET, POST } from "./route";
import { setOrgAlertWebhook } from "@/lib/db";
import { mintUnsubscribeToken } from "@/lib/email/unsubscribe";

const mockClear = vi.mocked(setOrgAlertWebhook);
const ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "s3cret";
  mockClear.mockResolvedValue(null);
});
afterEach(() => {
  process.env = { ...ENV };
});

const postForm = (token: string) =>
  new Request("http://localhost/api/email/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

describe("GET never mutates", () => {
  it("renders a confirm form for a valid token and clears nothing", async () => {
    const token = mintUnsubscribeToken("acme") as string;
    const res = await GET(new Request(`http://localhost/api/email/unsubscribe?token=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Stop Ascent alerts for acme?");
    expect(html).toContain('<form method="post"');
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("refuses a forged token", async () => {
    const res = await GET(new Request("http://localhost/api/email/unsubscribe?token=acme.forged"));
    expect(res.status).toBe(400);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("503s with an honest explanation when no signing secret is configured", async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const res = await GET(new Request("http://localhost/api/email/unsubscribe?token=x"));
    expect(res.status).toBe(503);
  });
});

describe("POST performs the unsubscribe", () => {
  it("clears the sink for the org the token authorizes — and only that org", async () => {
    const token = mintUnsubscribeToken("acme") as string;
    const res = await POST(postForm(token));
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledWith("acme", null);
    expect(await res.text()).toContain("Unsubscribed");
  });

  it("accepts a JSON one-click body", async () => {
    const token = mintUnsubscribeToken("acme") as string;
    const res = await POST(
      new Request("http://localhost/api/email/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledWith("acme", null);
  });

  it("a token signed for another org cannot clear this one", async () => {
    const other = mintUnsubscribeToken("acme") as string;
    const forged = `victim.${other.split(".")[1]}`;
    const res = await POST(postForm(forged));
    expect(res.status).toBe(400);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it("404s when the org no longer exists", async () => {
    mockClear.mockResolvedValue(undefined);
    const res = await POST(postForm(mintUnsubscribeToken("acme") as string));
    expect(res.status).toBe(404);
  });
});
