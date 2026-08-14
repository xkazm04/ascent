// Outbound email: env-gated factory + a PURE message builder + a never-throws dispatcher.
// Mirrors the LLM provider factory (src/lib/llm/index.ts) and the dispatchAlert ethic in
// src/lib/alerts.ts — a flaky/unconfigured provider must NEVER fail the scan that triggered it.

import type { ScanReport } from "@/lib/types";
import type { EmailSender } from "./types";
import { NoopEmailSender } from "./noop";
import { ResendEmailSender } from "./resend";
import { SesEmailSender } from "./ses";

export type { EmailMessage, EmailResult, EmailSender } from "./types";

/** A real provider is wired iff SES has a verified sender address (AWS region/creds come from the
 *  default chain like Bedrock) or a Resend API key is present. Neither → the factory returns the no-op. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SES_FROM_EMAIL || process.env.RESEND_API_KEY);
}

/**
 * Select the sender from EMAIL_PROVIDER (auto|ses|resend|noop). `auto` (default) prefers SES when a
 * verified sender is configured, then Resend, else the logging no-op — so dev and an un-provisioned prod
 * both run the full path harmlessly.
 *
 * SES-before-Resend under `auto` is deliberate: a deploy that already had SES_FROM_EMAIL set keeps sending
 * through SES byte-for-byte after Resend was added. An operator who wants the other order says so with
 * EMAIL_PROVIDER=resend rather than relying on which env var the factory happens to read first.
 */
export function getEmailSender(): EmailSender {
  const choice = (process.env.EMAIL_PROVIDER ?? "auto").toLowerCase();
  if (choice === "noop") return new NoopEmailSender();
  if (choice === "ses") return new SesEmailSender();
  if (choice === "resend") return new ResendEmailSender();
  if (choice === "auto") {
    if (process.env.SES_FROM_EMAIL) return new SesEmailSender();
    if (process.env.RESEND_API_KEY) return new ResendEmailSender();
  }
  return new NoopEmailSender();
}

/**
 * Will a send on THIS deploy actually attempt delivery? Derived from the same selection
 * getEmailSender/dispatchScanCompletionEmail use (not a second env read), so it can't disagree with
 * what a send would do — the no-op sender is the one that reports `skipped`. Callers use it to tell a
 * user, BEFORE promising anything, that email isn't configured here (see the notify pre-flight frame
 * in /api/scan/stream): `emailConfigured()` alone is wrong, since EMAIL_PROVIDER=noop overrides it.
 */
export function emailSendingEnabled(): boolean {
  return getEmailSender().name !== "noop";
}

/** Conservative email-shape check — enough to reject a typo'd custom address before we try to send to
 *  it. Trims first; rejects whitespace/multiple @. Not an RFC validator (delivery is the real test). */
export function isValidEmail(value: string | undefined | null): value is string {
  if (!value) return false;
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

/** PURE (no env, no Date, no I/O) so it's unit-testable — same discipline as the alert message
 *  builders. `url` is the absolute report link, resolved by the caller (publicBaseUrl + reportPermalink). */
export function buildScanCompletionEmail(opts: {
  repoFullName: string;
  url: string;
  report: ScanReport;
}): { subject: string; html: string; text: string } {
  const { repoFullName, url, report } = opts;
  const level = `${report.level.id} ${report.level.name}`;
  const score = report.overallScore;
  const subject = `Your Ascent scan is ready — ${repoFullName} (${level})`;

  const text = [
    `Your AI-native maturity scan of ${repoFullName} is ready.`,
    ``,
    `Level: ${level} · Score: ${score}/100`,
    report.headline ? `\n${report.headline}` : ``,
    ``,
    `View the full report:`,
    url,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:ui-sans-serif,system-ui,sans-serif;color:#e2e8f0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8">Ascent</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#fff">Your scan is ready</h1>
    <p style="margin:0 0 8px;font-size:15px"><span style="color:#94a3b8">Repository:</span> <strong>${esc(repoFullName)}</strong></p>
    <p style="margin:0 0 16px;font-size:15px"><span style="color:#94a3b8">Result:</span> <strong>${esc(level)}</strong> · ${score}/100</p>
    ${report.headline ? `<p style="margin:0 0 20px;font-size:14px;color:#cbd5e1;line-height:1.5">${esc(report.headline)}</p>` : ``}
    <a href="${esc(url)}" style="display:inline-block;background:#22d3ee;color:#06283d;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:15px">View the full report →</a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all">${esc(url)}</p>
  </div>
</body></html>`;

  return { subject, html, text };
}

/** Default per-send budget so a slow/hung provider can't delay the SSE `result` frame or eat the
 *  serverless function's duration. Overridable for slower providers. */
const EMAIL_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS) || 10_000;

/**
 * The outcome of a completion-email dispatch. `skipped` is the honest third state the old boolean
 * return ERASED: the no-op sender reports `{ ok: true, skipped: true }` (nothing was sent — no provider
 * is wired on this deploy), and collapsing that to `true` made the notify path report success on every
 * deploy where email is unconfigured. Callers must distinguish "sent" from "nothing was sent".
 */
export interface EmailDispatchResult {
  /** True when the send succeeded OR was intentionally skipped — i.e. nothing went wrong. */
  ok: boolean;
  /** True when no provider is configured, so no message was attempted. Never true together with a send. */
  skipped: boolean;
}

/**
 * Send an ALREADY-BUILT message under the shared per-send timeout. The one place any feature's mail
 * actually leaves the process: resolves the env-selected sender (no provider → the no-op, which reports
 * `skipped` and sends nothing), bounds the attempt, and NEVER throws — so a flaky/unconfigured provider
 * can't fail the request that triggered it (same contract as dispatchAlert).
 *
 * Every new mail-sending feature (invites, alert email sinks) MUST go through here rather than
 * constructing a second transport: one selection point means "email is off on this deploy" is a single,
 * unambiguous fact (see emailSendingEnabled).
 */
export async function dispatchBuiltEmail(
  to: string,
  built: { subject: string; html: string; text: string },
  opts: { replyTo?: string } = {},
): Promise<EmailDispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("email send timed out")), EMAIL_TIMEOUT_MS);
  try {
    const sender = getEmailSender();
    const res = await sender.send(
      { to, subject: built.subject, html: built.html, text: built.text, replyTo: opts.replyTo },
      { signal: controller.signal },
    );
    if (!res.ok) console.error("[email] send failed", { sender: sender.name, to });
    else if (res.skipped) console.warn("[email] no provider configured — nothing was sent", { sender: sender.name });
    return { ok: res.ok, skipped: res.ok && res.skipped === true };
  } catch (err) {
    console.error("[email] send error", err instanceof Error ? err.message : err);
    return { ok: false, skipped: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort send of the scan-completion email. Resolves the sender, builds the message, and sends it
 * under a hard timeout. Returns `{ ok, skipped }` — NEVER throws, so the scan that produced the report
 * is unaffected (same contract as dispatchAlert). A no-provider deploy comes back
 * `{ ok: true, skipped: true }` so the caller can say so instead of implying a send.
 */
export async function dispatchScanCompletionEmail(args: {
  to: string;
  repoFullName: string;
  url: string;
  report: ScanReport;
}): Promise<EmailDispatchResult> {
  return dispatchBuiltEmail(args.to, buildScanCompletionEmail(args));
}
