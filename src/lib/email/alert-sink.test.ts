// @vitest-environment node
//
// The mail half of an AlertMessage (backlog develop-2026-09-17 row 16). A builder that has a better
// mail rendering than its Slack text (the weekly digest) attaches `mail` to the message the delivery
// door carries; `buildAlertEmail` renders it inside the shared shell, which still owns the why/stop
// footer. A message without `mail` renders exactly as before (the text fallback in a pre block), and a
// Slack webhook never receives the mail part.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAlertEmail } from "./alert-sink";
import { dispatchAlert, type AlertMessage } from "@/lib/alerts";

const ENV = { ...process.env };
beforeEach(() => {
  delete process.env.ALERT_WEBHOOK_URL;
  vi.restoreAllMocks();
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const digestText = "📊 Ascent weekly digest: acme\nFleet maturity 62/100 · L3\n\nTop gainers:\n• api +9";

describe("buildAlertEmail with a mail part", () => {
  it("renders the builder's pre-escaped body and subject instead of the <pre> text dump", () => {
    const message: AlertMessage = {
      text: digestText,
      blocks: [],
      mail: { subject: "Weekly digest: acme · 2026-08-26 → 2026-09-01", bodyHtml: '<p data-digest="1">standing</p>' },
    };
    const built = buildAlertEmail({ message, org: "acme", unsubscribe: "https://ascent.test/u?t=x" });
    expect(built.subject).toBe("Weekly digest: acme · 2026-08-26 → 2026-09-01");
    expect(built.html).toContain('<p data-digest="1">standing</p>');
    expect(built.html).not.toContain("<pre");
    // The envelope is unchanged: why it arrived, and the off switch.
    expect(built.html).toContain("Stop these emails");
    expect(built.text).toContain(digestText);
    expect(built.text).toContain("To stop these emails, open: https://ascent.test/u?t=x");
  });

  it("a subject override keeps the WHOLE text in the body (the first line is no longer the subject)", () => {
    // The resend shape: stored plain text behind an admin prefix, with the original title as subject.
    const text = `Resent by an admin. First raised 2026-09-20.\n\n${digestText}\n• <script>alert(1)</script> -3`;
    const built = buildAlertEmail({ message: { text, blocks: [], mail: { subject: "Resent: Weekly fleet digest" } }, org: "acme" });
    expect(built.subject).toBe("Resent: Weekly fleet digest");
    expect(built.html).toContain("Resent by an admin. First raised 2026-09-20.");
    expect(built.html).toContain("📊 Ascent weekly digest: acme");
    expect(built.html).not.toMatch(/<script/i);
    expect(built.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("guard: a message without a mail part renders exactly as before", () => {
    const built = buildAlertEmail({ message: { text: digestText, blocks: [] }, org: "acme" });
    expect(built.subject).toBe("📊 Ascent weekly digest: acme");
    expect(built.html).toContain("<pre");
    expect(built.html).toContain("Fleet maturity 62/100");
  });

  it("guard: a Slack webhook receives text and blocks only, never the mail part", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await dispatchAlert(
      { text: digestText, blocks: [{ type: "section" }], mail: { subject: "s", bodyHtml: "<p>mail only</p>" } },
      { webhookUrl: "https://hooks.slack.com/services/T/B/acme", org: "acme" },
    );
    expect(ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: digestText, blocks: [{ type: "section" }] });
  });
});
