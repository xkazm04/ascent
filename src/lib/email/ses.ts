import type { EmailMessage, EmailResult, EmailSender, SendOptions } from "./types";

/** SES region precedence: SES_REGION → AWS_REGION → AWS_DEFAULT_REGION → us-east-1. Mirrors the
 *  resolveBedrockRegion precedence so the AWS story is consistent across providers. Exported so the
 *  precedence is pinned by a unit test rather than only exercised through a live SES client. */
export function resolveSesRegion(): string {
  return (
    process.env.SES_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

/**
 * AWS SES sender. Lazy-imports the SDK (like BedrockProvider in src/lib/llm/bedrock.ts) so the
 * dependency only loads when an email is actually sent, and authenticates via the default AWS
 * credential chain (env vars / IAM role). Selected only when SES_FROM_EMAIL is set (see emailConfigured).
 */
export class SesEmailSender implements EmailSender {
  readonly name = "ses" as const;

  async send(msg: EmailMessage, opts: SendOptions = {}): Promise<EmailResult> {
    const from = process.env.SES_FROM_EMAIL;
    // A misconfigured provider is a FAILURE, not a skip: `skipped` means "no provider is wired on this
    // deploy, nothing was attempted" (the honest no-op state the notify path now reports). Selecting SES
    // with no verified sender is a broken deploy, and reporting it as ok:false lets the caller log it.
    if (!from) {
      console.error("[email] ses selected but SES_FROM_EMAIL is not set");
      return { ok: false };
    }
    try {
      const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
      const client = new SESClient({ region: resolveSesRegion() });
      const res = await client.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [msg.to] },
          Message: {
            Subject: { Data: msg.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: msg.html, Charset: "UTF-8" },
              Text: { Data: msg.text, Charset: "UTF-8" },
            },
          },
        }),
        { abortSignal: opts.signal },
      );
      return { ok: true, id: res.MessageId };
    } catch (err) {
      // Report the failure through the RESULT rather than a throw: the sender contract is
      // `EmailResult`, and an ok:false here is distinguishable from a `skipped` no-op — a throw
      // collapsed both into the dispatcher's generic catch and lost that distinction.
      console.error("[email] ses send failed", err instanceof Error ? err.message : err);
      return { ok: false };
    }
  }
}
