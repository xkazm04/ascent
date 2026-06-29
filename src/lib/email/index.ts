// Outbound email: env-gated factory + a PURE message builder + a never-throws dispatcher.
// Mirrors the LLM provider factory (src/lib/llm/index.ts) and the dispatchAlert ethic in
// src/lib/alerts.ts — a flaky/unconfigured provider must NEVER fail the scan that triggered it.

import type { ScanReport } from "@/lib/types";
import type { EmailSender } from "./types";
import { NoopEmailSender } from "./noop";
import { SesEmailSender } from "./ses";

export type { EmailMessage, EmailResult, EmailSender } from "./types";

/** A real provider is wired iff a verified SES sender address is present. (AWS region/creds come from
 *  the default chain like Bedrock.) Absent → the factory returns the no-op sender. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SES_FROM_EMAIL);
}

/** Select the sender from EMAIL_PROVIDER (auto|ses|noop). `auto` (default) uses SES when configured,
 *  else the logging no-op — so dev and an un-provisioned prod both run the full path harmlessly. */
export function getEmailSender(): EmailSender {
  const choice = (process.env.EMAIL_PROVIDER ?? "auto").toLowerCase();
  if (choice === "noop") return new NoopEmailSender();
  if (choice === "ses" || (choice === "auto" && emailConfigured())) return new SesEmailSender();
  return new NoopEmailSender();
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
 * Best-effort send of the scan-completion email. Resolves the sender, builds the message, and sends it
 * under a hard timeout. Returns true on success/skip (no provider), false on any failure — NEVER throws,
 * so the scan that produced the report is unaffected (same contract as dispatchAlert).
 */
export async function dispatchScanCompletionEmail(args: {
  to: string;
  repoFullName: string;
  url: string;
  report: ScanReport;
}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("email send timed out")), EMAIL_TIMEOUT_MS);
  try {
    const sender = getEmailSender();
    const { subject, html, text } = buildScanCompletionEmail(args);
    const res = await sender.send({ to: args.to, subject, html, text }, { signal: controller.signal });
    if (!res.ok) console.error("[email] send failed", { sender: sender.name, to: args.to });
    return res.ok;
  } catch (err) {
    console.error("[email] send error", err instanceof Error ? err.message : err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
