"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Fetch-and-download replacement for the plain `<a href>` export anchors (Export PDF / Onboarding
 * skill / org security PDF). A bare anchor had two failure modes (pdf-llm-export #1): the PDF render
 * is CPU-bound (route sets maxDuration=60) but a click gave zero pending feedback, inviting re-clicks
 * that re-render the whole document; and every error branch (404/503/500) returns JSON with no
 * Content-Disposition, so the browser NAVIGATED OFF the report onto a raw `{"error":…}` page.
 *
 * This keeps the element an `<a href>` (middle-click / copy-link / open-in-tab keep native anchor
 * semantics) but intercepts plain left-clicks: fetch → blob → object-URL download, with a visible
 * busy state while the render runs and an inline role="alert" (reusing the route's own `error`
 * message) on failure — the user never leaves the page.
 */
export function DownloadButton({
  href,
  className,
  title,
  children,
  upgradeHref,
}: {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
  /** When the route 403s a paid-tier gate (e.g. PDF export below the entitled plan), render the
   *  error as a link to this path instead of dead-end text — a paid action must offer a way to
   *  actually pay/upgrade, not just fail silently in place (G1-36). Omit for exports with no plan
   *  gate, where a 403 is just a generic access error like any other. */
  upgradeHref?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Guard the async completion against an unmounted row (navigating away mid-download).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Modified clicks (new tab, download-link-as) keep native anchor behavior.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (busy) return; // re-click while the render is running must not start a second one
    setBusy(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        // The export routes ship user-facing copy as `{ error }` JSON — surface it inline instead of
        // letting the browser display it as the whole document.
        let message = `Download failed (${res.status}). Try again in a moment.`;
        try {
          const body = (await res.json()) as { error?: string } | null;
          if (body && typeof body.error === "string" && body.error) message = body.error;
        } catch {
          // Non-JSON error body — keep the generic message.
        }
        if (mounted.current) {
          setError(message);
          setForbidden(res.status === 403);
        }
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const name =
        /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? (href.split("?")[0] ?? "").split("/").pop() ?? "download";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after the download has had a chance to start; immediate revocation races the click.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      if (mounted.current) setError("Download failed. Check your connection and retry.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <a href={href} onClick={onClick} aria-busy={busy} aria-disabled={busy || undefined} title={title} className={className}>
        {busy ? (
          <>
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent motion-reduce:animate-none"
            />
            Preparing…
          </>
        ) : (
          children
        )}
      </a>
      {error &&
        (forbidden && upgradeHref ? (
          <Link
            href={upgradeHref}
            role="alert"
            className="text-sm text-amber-300 underline decoration-amber-300/40 underline-offset-2 transition hover:text-amber-200"
          >
            <span aria-hidden>⚠</span> {error} Upgrade →
          </Link>
        ) : (
          <span role="alert" className="text-sm text-red-300">
            <span aria-hidden>⚠</span> {error}
          </span>
        ))}
    </span>
  );
}
