// First direct tests for the SES sender: the SES SDK is stubbed (the real client would need creds and
// a network), so what's pinned here is exactly what this module owns — the region precedence, the
// request SHAPE handed to SendEmailCommand (Source/To/Subject/Html/Text + the abort signal), and the
// failure contract. Before this, ses.ts had no test at all: a broken request shape or a swallowed
// region would only have surfaced as mail that never arrived on a live deploy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clients: [] as { region?: string }[],
  sends: [] as { input: Record<string, unknown>; opts: { abortSignal?: AbortSignal } }[],
  fail: null as Error | null,
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    constructor(cfg: { region?: string }) {
      h.clients.push(cfg);
    }
    async send(cmd: { input: Record<string, unknown> }, opts: { abortSignal?: AbortSignal }) {
      h.sends.push({ input: cmd.input, opts });
      if (h.fail) throw h.fail;
      return { MessageId: "msg-1" };
    }
  },
  SendEmailCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

import { resolveSesRegion, SesEmailSender } from "./ses";

const msg = { to: "dev@nuda.dev", subject: "Your Ascent scan is ready", html: "<p>hi</p>", text: "hi" };
const saved = { ...process.env };

beforeEach(() => {
  h.clients.length = 0;
  h.sends.length = 0;
  h.fail = null;
  for (const k of ["SES_REGION", "AWS_REGION", "AWS_DEFAULT_REGION", "SES_FROM_EMAIL"]) delete process.env[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("resolveSesRegion", () => {
  it("prefers SES_REGION, then AWS_REGION, then AWS_DEFAULT_REGION, then us-east-1", () => {
    expect(resolveSesRegion()).toBe("us-east-1");
    process.env.AWS_DEFAULT_REGION = "eu-central-1";
    expect(resolveSesRegion()).toBe("eu-central-1");
    process.env.AWS_REGION = "us-west-2";
    expect(resolveSesRegion()).toBe("us-west-2");
    process.env.SES_REGION = "eu-west-1";
    expect(resolveSesRegion()).toBe("eu-west-1");
  });
});

describe("SesEmailSender.send", () => {
  it("sends the verified Source to the single recipient with UTF-8 subject + html/text bodies", async () => {
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    process.env.SES_REGION = "eu-west-1";
    const signal = AbortSignal.timeout(1000);
    const res = await new SesEmailSender().send(msg, { signal });

    expect(res).toEqual({ ok: true, id: "msg-1" });
    expect(h.clients[0]).toEqual({ region: "eu-west-1" });
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]!.input).toEqual({
      Source: "Ascent <no-reply@nuda.dev>",
      Destination: { ToAddresses: ["dev@nuda.dev"] },
      Message: {
        Subject: { Data: msg.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: msg.html, Charset: "UTF-8" },
          Text: { Data: msg.text, Charset: "UTF-8" },
        },
      },
    });
    // The per-dispatch timeout must reach the SDK, or a hung send outlives the scan invocation.
    expect(h.sends[0]!.opts.abortSignal).toBe(signal);
  });

  it("returns ok:false (never throws) when the SDK send rejects", async () => {
    process.env.SES_FROM_EMAIL = "no-reply@nuda.dev";
    h.fail = new Error("Throttling: Maximum sending rate exceeded");
    await expect(new SesEmailSender().send(msg)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false — NOT a skip — when SES is selected without SES_FROM_EMAIL", async () => {
    const res = await new SesEmailSender().send(msg);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBeUndefined(); // a broken deploy is a failure, not "no provider wired"
    expect(h.sends).toHaveLength(0);
  });
});
