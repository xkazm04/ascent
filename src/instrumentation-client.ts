// Next.js client instrumentation (the `instrumentation-client.ts` file convention) — runs once in
// the browser before the app hydrates. Boots Sentry error capture, mirroring the server init in
// src/instrumentation.ts: runtime capture only (no build plugin / source-map upload), and a strict
// NO-OP unless NEXT_PUBLIC_SENTRY_DSN is set — local dev and CI stay Sentry-free.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Errors only — no performance tracing (keeps the runtime overhead + quota spend at zero).
    tracesSampleRate: 0,
  });
}

// Next calls this on every App Router navigation. Sentry's handler records the transition as
// breadcrumb/span context; it no-ops when init() never ran (no DSN), so exporting it
// unconditionally is safe.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
