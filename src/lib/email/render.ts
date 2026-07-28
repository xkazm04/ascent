// Shared HTML shell for outbound mail. PURE (no env, no Date, no I/O) so every message builder stays
// unit-testable, and so the branded chrome (dark card, Ascent eyebrow, CTA button, footer) is written
// once instead of re-pasted per feature. The scan-completion mail predates this and keeps its own
// literal; every mail added after it (invites, alert-sink pushes) renders through here.
//
// The FOOTER is not decoration: it is where the "why am I receiving this / how do I stop it" line
// lives, and `emailShell` requires one. A message with no honest answer to that question should not
// be sent at all.

/** HTML-escape an untrusted string for interpolation into the templates below. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface EmailShellInput {
  /** The `<h1>` of the card. */
  heading: string;
  /** Pre-escaped HTML paragraphs for the body. */
  bodyHtml: string;
  /** Optional primary action. */
  cta?: { href: string; label: string } | null;
  /**
   * Why this address is receiving the message and how to stop — REQUIRED. Plain text; escaped here.
   * Rendered as the last line of the card in muted type.
   */
  footer: string;
  /** Optional absolute URL rendered under the CTA as a copy-paste fallback. */
  showRawUrl?: boolean;
}

/** Render the shared dark card. Pure. */
export function emailShell(input: EmailShellInput): string {
  const { heading, bodyHtml, cta, footer, showRawUrl } = input;
  return `<!doctype html><html><body style="margin:0;background:#0f172a;font-family:ui-sans-serif,system-ui,sans-serif;color:#e2e8f0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8">Ascent</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#fff">${escapeHtml(heading)}</h1>
    ${bodyHtml}
    ${cta ? `<a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#22d3ee;color:#06283d;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:15px">${escapeHtml(cta.label)}</a>` : ``}
    ${cta && showRawUrl ? `<p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(cta.href)}</p>` : ``}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #334155;font-size:12px;color:#64748b;line-height:1.5">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
}

/** A muted body paragraph. Escapes its argument. Pure. */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#cbd5e1;line-height:1.5">${escapeHtml(text)}</p>`;
}

/** A monospace-ish preformatted block (used to carry an alert's plain-text body verbatim). Pure. */
export function preBlock(text: string): string {
  return `<pre style="margin:0 0 16px;padding:14px;background:#0f172a;border:1px solid #334155;border-radius:10px;font-size:13px;color:#cbd5e1;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(text)}</pre>`;
}
