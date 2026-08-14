// The Custom-plan enquiry mail is the one OPERATOR-INBOUND message in this module, and the two things
// that make it work are easy to lose in a refactor: the prospect's address must ride in `replyTo` (an
// operator answers by hitting Reply, not by re-typing an address out of the body), and every fact the
// form collected must actually appear in the text part. Both are pinned here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPlanEnquiryEmail, salesEmail, DEFAULT_SALES_EMAIL, dispatchPlanEnquiryEmail } from "./plan-enquiry";

const enquiry = {
  name: "Dana Reyes",
  email: "dana@acme.dev",
  company: "Acme",
  fleetSize: "51-200",
  areas: ["hosting", "sso"] as const,
  message: "Inference has to stay in our VPC, and we need SAML for 40 engineers.",
};

const full = { ...enquiry, areas: [...enquiry.areas] };

describe("buildPlanEnquiryEmail", () => {
  it("leads the subject with the company so an inbox sorts by who is asking", () => {
    expect(buildPlanEnquiryEmail(full).subject).toBe("Custom plan enquiry — Acme");
  });

  it("falls back to the person's name when no company was given", () => {
    expect(buildPlanEnquiryEmail({ ...full, company: "" }).subject).toBe("Custom plan enquiry — Dana Reyes");
  });

  it("carries every collected fact in the text part", () => {
    const { text } = buildPlanEnquiryEmail({ ...full, viewerLogin: "dreyes", orgSlug: "acme" });
    expect(text).toContain("dana@acme.dev");
    expect(text).toContain("Acme");
    expect(text).toContain("51–200 repositories"); // the LABEL, not the stored id
    expect(text).toContain("Hosting");
    expect(text).toContain("SSO & directory");
    expect(text).toContain("@dreyes");
    expect(text).toContain(enquiry.message);
  });

  it("omits rows the prospect didn't fill rather than printing empty labels", () => {
    const { text } = buildPlanEnquiryEmail({ ...full, company: "", fleetSize: "", areas: [] });
    expect(text).not.toContain("Company:");
    expect(text).not.toContain("Fleet:");
    expect(text).not.toContain("Wants scoped:");
  });

  it("escapes the prospect's own text into the HTML part", () => {
    const { html } = buildPlanEnquiryEmail({ ...full, company: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("still answers 'why am I receiving this' — the shell requires a footer", () => {
    expect(buildPlanEnquiryEmail(full).html).toContain("Custom plan form on /pricing");
  });
});

describe("salesEmail", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults to the operator inbox so the form works with no env at all", () => {
    delete process.env.ASCENT_SALES_EMAIL;
    expect(salesEmail()).toBe(DEFAULT_SALES_EMAIL);
  });

  it("is overridable per deployment", () => {
    process.env.ASCENT_SALES_EMAIL = "sales@acme.dev";
    expect(salesEmail()).toBe("sales@acme.dev");
  });
});

describe("dispatchPlanEnquiryEmail", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SES_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("sends to the operator inbox with the PROSPECT as reply-to", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.ASCENT_SALES_EMAIL = "sales@acme.dev";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const res = await dispatchPlanEnquiryEmail(full);
    expect(res).toEqual({ ok: true, skipped: false });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(["sales@acme.dev"]);
    expect(body.reply_to).toBe("dana@acme.dev");
  });

  it("reports `skipped` (never a throw) on a deploy with no provider — the row is still the lead", async () => {
    await expect(dispatchPlanEnquiryEmail(full)).resolves.toEqual({ ok: true, skipped: true });
  });
});
