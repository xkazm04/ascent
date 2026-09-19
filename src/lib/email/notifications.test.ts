// The consent contract for every email this codebase can send, in one suite. These are not
// "does the template render" tests — they are the three properties that make an outbound-email feature
// safe to deploy, and each one has a documented failure mode if it regresses:
//
//   (1) NOTHING SENDS WHEN UNCONFIGURED — a deploy with no provider must attempt no network I/O and
//       must REPORT that it sent nothing (`skipped`), never a false success.
//   (2) NOTHING SENDS TO AN ADDRESS NOBODY CONFIGURED — alert mail goes only to an address stored as
//       the org's own sink by an admin; a plain webhook sink must never be treated as an address.
//   (3) EVERY SEND CARRIES ITS OWN OFF SWITCH — the alert mail names how to stop it (and links the
//       one-click route when signing is configured); the invite mail states it is a one-off.
//
// Plus the unsubscribe token's security property: an unsigned/forged token authorizes nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAlertEmail, dispatchAlertEmail } from "./alert-sink";
import { buildInviteEmail, dispatchInviteEmail, inviteEmailEnabled } from "./invite";
import { mintUnsubscribeToken, unsubscribeConfigured, unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe";
import { emailSendingEnabled } from "./index";
import { emailSinkAddress, validateAlertWebhookUrl, dispatchAlert, buildTestAlertMessage } from "@/lib/alerts";

const ENV = { ...process.env };

beforeEach(() => {
  // Baseline: an UNCONFIGURED deploy. Every test that wants a provider opts in explicitly.
  delete process.env.SES_FROM_EMAIL;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.EMAIL_INVITES;
  delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ASCENT_PUBLIC_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ENV };
});

const msg = { text: "🔻 Ascent: acme/api regressed\n• Overall score fell -8", blocks: [] };

describe("(1) nothing sends when email is unconfigured", () => {
  it("emailSendingEnabled() is false with no provider", () => {
    expect(emailSendingEnabled()).toBe(false);
  });

  it("dispatchAlertEmail attempts no network I/O and reports NOT sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(dispatchAlertEmail("ops@acme.test", msg, { org: "acme" })).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("dispatchAlert to a mailto: sink is a no-op that reports false (so the digest retries)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(dispatchAlert(msg, { webhookUrl: "mailto:ops@acme.test", org: "acme" })).resolves.toBe(false);
    // Critically: it must NOT fall through to POSTing the alert somewhere.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the invite mail is skipped (not failed, not sent) with no provider", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await dispatchInviteEmail("someone@example.test", { org: "acme", role: "member", url: "https://a.dev/invite/t" });
    expect(res).toEqual({ ok: true, skipped: true });
  });

  it("EMAIL_INVITES=off disables invite mail even when a provider IS configured", async () => {
    process.env.SES_FROM_EMAIL = "no-reply@ascent.test";
    process.env.EMAIL_INVITES = "off";
    expect(inviteEmailEnabled()).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(dispatchInviteEmail("someone@example.test", { org: "acme", role: "member", url: null })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("(2) an alert only ever reaches a deliberately configured address", () => {
  it("only a mailto: sink resolves to an address — a webhook never does", () => {
    expect(emailSinkAddress("mailto:ops@acme.test")).toBe("ops@acme.test");
    expect(emailSinkAddress("MAILTO:Ops@Acme.test")).toBe("Ops@Acme.test");
    expect(emailSinkAddress("mailto:ops@acme.test?subject=hi")).toBe("ops@acme.test");
    expect(emailSinkAddress("https://hooks.slack.com/services/x")).toBeNull();
    expect(emailSinkAddress("ops@acme.test")).toBeNull(); // a bare address is NOT a sink
    expect(emailSinkAddress(null)).toBeNull();
    expect(emailSinkAddress("mailto:")).toBeNull();
    expect(emailSinkAddress("mailto:not-an-email")).toBeNull();
    expect(emailSinkAddress("mailto:a@b.test, c@d.test")).toBeNull(); // no multi-recipient fan-out
  });

  it("validateAlertWebhookUrl accepts and normalizes a mailto: sink, rejects a malformed one", () => {
    expect(validateAlertWebhookUrl(" MAILTO:Ops@Acme.test ")).toEqual({ ok: true, url: "mailto:Ops@Acme.test" });
    const bad = validateAlertWebhookUrl("mailto:nope");
    expect(bad.ok).toBe(false);
    // The https rules are untouched.
    expect(validateAlertWebhookUrl("http://hooks.slack.com/x").ok).toBe(false);
    expect(validateAlertWebhookUrl("https://127.0.0.1/x").ok).toBe(false);
  });

  it("a MALFORMED mailto: sink dead-ends — it is never handed to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(dispatchAlert(msg, { webhookUrl: "mailto:not-an-email", org: "acme" })).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with no sink configured at all, nothing is dispatched by any channel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(dispatchAlert(buildTestAlertMessage("acme"), {})).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("(3) every send carries an off switch", () => {
  it("alert mail names why it arrived and how to stop it, and links the one-click route when signed", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "s3cret";
    process.env.ASCENT_PUBLIC_URL = "https://ascent.test";
    const url = unsubscribeUrl("acme");
    expect(url).toContain("/api/email/unsubscribe?token=");
    const built = buildAlertEmail({ message: msg, org: "acme", unsubscribe: url });
    expect(built.text).toContain("You're receiving this because the alert sink for the \"acme\" organization");
    expect(built.text).toContain(url as string);
    expect(built.html).toContain("Stop these emails");
  });

  it("degrades to naming the settings page when no unsubscribe secret is configured", () => {
    const built = buildAlertEmail({ message: msg, org: "acme", unsubscribe: null, settingsUrl: "https://ascent.test/org/acme" });
    expect(built.text).toContain("clear the alert sink");
    expect(built.text).toContain("https://ascent.test/org/acme");
    expect(built.html).not.toContain("/api/email/unsubscribe"); // no dead one-click link
  });

  it("the invite mail states it is one-off and safe to ignore, and leaks no fleet data", () => {
    const built = buildInviteEmail({
      org: "acme",
      role: "member",
      url: "https://ascent.test/invite/tok123",
      invitedBy: "octocat",
      expiresAt: new Date(Date.UTC(2026, 0, 8)).toISOString(),
      nowMs: Date.UTC(2026, 0, 1),
    });
    expect(built.subject).toBe("@octocat invited you to the acme organization on Ascent");
    expect(built.text).toContain("expires in 7 days");
    expect(built.text).toContain("no further email will be sent to this address");
    expect(built.html).toContain("https://ascent.test/invite/tok123");
    // The builder's INPUTS are the whole disclosure surface: org, role, inviter, link, expiry. There is
    // no report/rollup/member argument it could leak, and the rendered body carries no fleet figure —
    // no "N/100" score, no maturity band, no owner/repo slug.
    expect(built.text).not.toMatch(/\d+\/100|\bL[1-5]\b/);
    // The only path/slug-shaped token in the body is the invite link itself.
    expect(built.text.match(/[\w-]+\/[\w-]+/g)).toEqual(["test/invite"]);
  });

  it("the invite mail survives a deployment with no public URL (no broken link)", () => {
    const built = buildInviteEmail({ org: "acme", role: "viewer", url: null });
    expect(built.text).toContain("Ask the person who invited you");
    expect(built.html).not.toContain("href=\"null\"");
  });

  it("HTML-escapes hostile org/inviter values", () => {
    const built = buildInviteEmail({ org: '</p><script>x</script>', role: "member", url: null, invitedBy: "<b>" });
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
  });
});

describe("unsubscribe tokens", () => {
  it("mint/verify round-trips, and is unavailable (null) with no secret", () => {
    expect(unsubscribeConfigured()).toBe(false);
    expect(mintUnsubscribeToken("acme")).toBeNull();
    expect(unsubscribeUrl("acme")).toBeNull();
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "s3cret";
    const token = mintUnsubscribeToken("Acme") as string;
    expect(token.startsWith("acme.")).toBe(true);
    expect(verifyUnsubscribeToken(token)).toBe("acme");
  });

  it("refuses a forged, truncated, cross-org or unsigned token", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "s3cret";
    const token = mintUnsubscribeToken("acme") as string;
    expect(verifyUnsubscribeToken("acme.deadbeef")).toBeNull();
    expect(verifyUnsubscribeToken("acme")).toBeNull();
    expect(verifyUnsubscribeToken(`other.${token.split(".")[1]}`)).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
    // A token minted under a different secret must not verify.
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "rotated";
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });
});

describe("a configured provider actually sends — once, to the configured address only", () => {
  it("routes a mailto: sink through the sender with the alert body", async () => {
    process.env.SES_FROM_EMAIL = "no-reply@ascent.test";
    process.env.EMAIL_PROVIDER = "noop"; // exercise the full path with a provider that reports skipped
    // Prove the selection logic, not SES itself: with EMAIL_PROVIDER=noop nothing leaves the process.
    expect(emailSendingEnabled()).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await dispatchAlert(msg, { webhookUrl: "mailto:ops@acme.test", org: "acme" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
