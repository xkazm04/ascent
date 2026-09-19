"use client";

// Root-segment error boundary: the application-wide fallback for any throw NOT caught by a nearer
// error.tsx. Most importantly it catches a throw in a NESTED LAYOUT (e.g. org/[slug]/layout.tsx) —
// which that segment's own error.tsx cannot catch, because the boundary renders inside the very
// layout that failed — and which would otherwise fall through to the bare, chrome-less global-error
// document (a full-page replacement). The nearer org/[slug]/error.tsx still handles ordinary org
// sub-page failures in-shell; this only catches what escapes those boundaries.
//
// The shared RouteError card is a self-contained client component (no @/components/Brand → no server-only
// @/lib/auth in the client bundle). fullScreen fills the viewport since this is the app-wide fallback.

import { RouteError } from "@/components/ui/RouteError";

export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <RouteError
      {...props}
      fullScreen
      title="Something went wrong"
      description="An unexpected error occurred while loading this page. This is usually a transient hiccup. Retrying often resolves it."
      logLabel="[ascent] app-route-error"
    />
  );
}
