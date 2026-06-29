import type { EmailMessage, EmailResult, EmailSender } from "./types";

/**
 * Stand-in sender used when no email provider is configured — local dev, or production before SES is
 * wired ("plug in later"). It LOGS the would-be send and never throws, so the whole notify path
 * (gate → checkbox → recipient resolution → dispatch) is fully exercisable without any provider/creds.
 */
export class NoopEmailSender implements EmailSender {
  readonly name = "noop" as const;

  async send(msg: EmailMessage): Promise<EmailResult> {
    console.log("[email] (noop) would send", { to: msg.to, subject: msg.subject });
    return { ok: true, skipped: true };
  }
}
