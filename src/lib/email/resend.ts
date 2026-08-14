import type { EmailMessage, EmailResult, EmailSender, SendOptions } from "./types";

// Resend (resend.com) sender. Talks the HTTP API with plain `fetch` rather than pulling the `resend`
// npm package: the whole surface we use is one POST, and the SES sender's lazy-import dance exists only
// because the AWS SDK is a heavy dependency worth deferring. No dependency at all beats deferring one.
//
// SENDER IDENTITY. Resend refuses any `from` on a domain the account hasn't verified. `onboarding@resend.dev`
// is the shared sandbox identity every account may send from, so it's the default here — which also means
// the default configuration can only deliver to the Resend account owner's own address. That is exactly the
// shape of the Custom-plan enquiry (one operator inbox), and any other use needs a verified domain in
// RESEND_FROM_EMAIL. Documented in .env.example so this isn't discovered from a 403.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend's shared sandbox sender — usable with no domain verification, but only delivers to the
 *  account owner's address. Overridden by RESEND_FROM_EMAIL once a domain is verified. */
export const RESEND_DEFAULT_FROM = "Ascent <onboarding@resend.dev>";

/** The From identity for Resend sends: RESEND_FROM_EMAIL, else the shared sandbox sender. */
export function resendFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || RESEND_DEFAULT_FROM;
}

export class ResendEmailSender implements EmailSender {
  readonly name = "resend" as const;

  async send(msg: EmailMessage, opts: SendOptions = {}): Promise<EmailResult> {
    const key = process.env.RESEND_API_KEY?.trim();
    // Same contract as SesEmailSender: selecting a provider whose credential is missing is a BROKEN
    // deploy (ok:false, logged), not the `skipped` no-op that means "no provider is wired here".
    if (!key) {
      console.error("[email] resend selected but RESEND_API_KEY is not set");
      return { ok: false };
    }
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: resendFrom(),
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        }),
        signal: opts.signal,
      });
      if (!res.ok) {
        // Resend answers a rejected send with a JSON body naming the reason (unverified domain, a
        // sandbox `to` that isn't the account owner, a revoked key). Log it — those are the failures an
        // operator can actually fix, and a bare status code sends them hunting.
        const detail = await res.text().catch(() => "");
        console.error("[email] resend send failed", { status: res.status, detail: detail.slice(0, 500) });
        return { ok: false };
      }
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return { ok: true, id: body?.id };
    } catch (err) {
      console.error("[email] resend send error", err instanceof Error ? err.message : err);
      return { ok: false };
    }
  }
}
