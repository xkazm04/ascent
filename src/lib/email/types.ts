// Pluggable outbound-email contract. One small interface so the scan-completion notification can be
// sent through any provider (AWS SES today) — or a no-op when none is configured — without the callers
// knowing which. Mirrors the LLMProvider abstraction in src/lib/llm.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  /** Provider message id, when the message was actually accepted for delivery. */
  id?: string;
  /** True when a no-op sender intentionally skipped delivery (no provider configured). */
  skipped?: boolean;
}

export interface SendOptions {
  /** Abort the send (wired to a per-dispatch timeout) so a slow provider can't delay the scan response. */
  signal?: AbortSignal;
}

export interface EmailSender {
  readonly name: string;
  send(msg: EmailMessage, opts?: SendOptions): Promise<EmailResult>;
}
