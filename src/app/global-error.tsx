"use client";

// Last-resort boundary: catches errors thrown by the root layout itself, where no app CSS or
// shared chrome can be assumed to have loaded. It REPLACES the document, so it must render its own
// <html>/<body> and stays fully self-contained with inline styles (no Tailwind, no imports that
// could be the thing that failed). Ordinary page/segment errors are handled by nearer error.tsx
// boundaries with the full branded UI.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Bounded telemetry for the highest-severity boundary (a root-layout failure). A structured,
    // greppable console.error is the one reporter that works here — the router/app shell may be dead —
    // and the production log drain (Vercel captures console.error) can alert on it instead of the team
    // learning about a shell outage from users.
    console.error("[ascent] global-shell-error", {
      digest: error.digest,
      message: error.message,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080d1a",
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: 460, padding: 24, textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#3b9eff",
            }}
          >
            500
          </p>
          <h1 style={{ margin: "16px 0 0", fontSize: 26, color: "#fff" }}>
            Ascent hit an unexpected error
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 16, lineHeight: 1.5, color: "#94a3b8" }}>
            Something failed while loading the application shell. This is usually transient — try
            again, and if it persists, reload the page.
          </p>
          {error.digest && (
            <p
              style={{
                margin: "12px 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: 13,
                color: "#64748b",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <div
            style={{ marginTop: 28, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}
          >
            <button
              onClick={() => reset()}
              style={{
                cursor: "pointer",
                border: 0,
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 15,
                fontWeight: 600,
                background: "#3b9eff",
                color: "#04070e",
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- global-error replaces the
                document and runs without the Next router; a hard <a> (full reload) is the correct recovery. */}
            <a
              href="/"
              style={{
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 15,
                textDecoration: "none",
                border: "1px solid #334155",
                color: "#e2e8f0",
              }}
            >
              Back to home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
