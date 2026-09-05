import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanReport } from "@/lib/types";
import {
  buildScanCompletionEmail,
  dispatchScanCompletionEmail,
  emailConfigured,
  emailSendingEnabled,
  getEmailSender,
  isValidEmail,
} from "./index";

const report = {
  repo: { owner: "facebook", name: "react" },
  overallScore: 72,
  level: { id: "L4", name: "Integrated" },
  headline: "Strong guardrails & <agentic> review in the loop.",
} as unknown as ScanReport;

describe("buildScanCompletionEmail", () => {
  it("puts repo, level, score and the absolute link in subject + bodies", () => {
    const url = "https://ascent.dev/report/facebook/react@abc1234";
    const { subject, html, text } = buildScanCompletionEmail({ repoFullName: "facebook/react", url, report });
    expect(subject).toBe("Your Ascent scan is ready: facebook/react (L4 Integrated)");
    expect(text).toContain("L4 Integrated");
    expect(text).toContain("72/100");
    expect(text).toContain(url);
    expect(html).toContain(url);
    expect(html).toContain("facebook/react");
  });

  it("HTML-escapes the headline (no raw angle brackets injected)", () => {
    const { html } = buildScanCompletionEmail({ repoFullName: "a/b", url: "https://x.dev/report/a/b", report });
    expect(html).not.toContain("<agentic>");
    expect(html).toContain("&lt;agentic&gt;");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isValidEmail("dev@nuda.dev")).toBe(true);
    expect(isValidEmail(" dev@nuda.dev ")).toBe(true);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b@c.dev")).toBe(false);
    expect(isValidEmail("nospace dev@x.dev")).toBe(false);
  });
});

describe("getEmailSender / emailConfigured", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SES_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to the no-op sender when nothing is configured", () => {
    expect(emailConfigured()).toBe(false);
    expect(getEmailSender().name).toBe("noop");
  });

  it("uses SES when SES_FROM_EMAIL is present (auto)", () => {
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    expect(emailConfigured()).toBe(true);
    expect(getEmailSender().name).toBe("ses");
  });

  it("uses Resend when only RESEND_API_KEY is present (auto)", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(emailConfigured()).toBe(true);
    expect(getEmailSender().name).toBe("resend");
  });

  // Adding a second provider must not silently re-route a deployment that already had one. SES wins
  // under `auto` so an existing SES deploy keeps sending through SES after Resend was introduced.
  it("prefers SES over Resend under auto when BOTH are configured", () => {
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    process.env.RESEND_API_KEY = "re_test";
    expect(getEmailSender().name).toBe("ses");
  });

  it("honors an explicit provider choice over what env happens to be set", () => {
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_PROVIDER = "resend";
    expect(getEmailSender().name).toBe("resend");
    process.env.EMAIL_PROVIDER = "ses";
    expect(getEmailSender().name).toBe("ses");
  });

  it("honors an explicit EMAIL_PROVIDER=noop even when SES is configured", () => {
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    process.env.EMAIL_PROVIDER = "noop";
    expect(getEmailSender().name).toBe("noop");
  });

  // emailConfigured() alone would say "yes" here — the notify pre-flight must key on the SELECTION.
  it("emailSendingEnabled tracks the resolved sender, not just SES_FROM_EMAIL", () => {
    expect(emailSendingEnabled()).toBe(false);
    process.env.SES_FROM_EMAIL = "Ascent <no-reply@nuda.dev>";
    expect(emailSendingEnabled()).toBe(true);
    process.env.EMAIL_PROVIDER = "noop";
    expect(emailConfigured()).toBe(true);
    expect(emailSendingEnabled()).toBe(false);
  });
});

describe("dispatchScanCompletionEmail", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SES_FROM_EMAIL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  // The regression this direction closes: an unconfigured deploy used to return a bare `true`, and the
  // notify path read that as "sent". It must now be distinguishable from a real delivery.
  it("reports skipped (not a plain success) when no provider is configured", async () => {
    const res = await dispatchScanCompletionEmail({
      to: "dev@nuda.dev",
      repoFullName: "facebook/react",
      url: "https://ascent.dev/report/facebook/react",
      report,
    });
    expect(res).toEqual({ ok: true, skipped: true });
    expect(console.warn).toHaveBeenCalled(); // operator-visible: nothing was sent
  });
});
