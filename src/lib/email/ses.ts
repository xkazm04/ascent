import type { EmailMessage, EmailResult, EmailSender, SendOptions } from "./types";

/** SES region precedence: SES_REGION → AWS_REGION → AWS_DEFAULT_REGION → us-east-1. Mirrors the
 *  resolveBedrockRegion precedence so the AWS story is consistent across providers. */
function resolveSesRegion(): string {
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
    if (!from) throw new Error("SES_FROM_EMAIL is not set.");
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
  }
}
