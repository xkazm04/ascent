import type { NextConfig } from "next";
import path from "path";

// Content-Security-Policy — REPORT-ONLY starter, derived from what the app actually loads today
// (not an aspirational lockdown). Sources, verified against the code:
//   - script-src 'unsafe-inline': Next's own inline bootstrap/hydration scripts (no nonce
//     infrastructure yet) + the static JSON-LD <script> in src/app/layout.tsx.
//   - style-src 'unsafe-inline': inline style attributes (e.g. src/app/global-error.tsx, chart
//     components) + next/font's injected @font-face styles.
//   - img-src https: + data:: GitHub avatars (src/components/Brand.tsx), org-configured branding
//     logo URLs (src/app/share/briefing — arbitrary https by design), and data: badge logos.
//   - font-src 'self': next/font self-hosts Geist — no fonts.gstatic.com at runtime.
//   - connect-src *.supabase.co: the browser Supabase auth client (src/lib/supabase/client.ts).
// Promote to enforcing Content-Security-Policy only after report noise is triaged.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Site-wide security headers. Notes:
//   - HSTS: 2 years + preload; Vercel serves HTTPS-only so this is safe to assert.
//   - X-Frame-Options DENY applies globally, INCLUDING the badge/scorecard SVG routes: README
//     badges are embedded via <img> (see BadgeGenerator's markdown snippet), and X-Frame-Options
//     only governs <frame>/<iframe> embedding, never image loads — so no route exemption is needed.
//   - Permissions-Policy: the app uses no camera/mic/geolocation anywhere.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  // Empty-tenant dev mode (`npm run dev:empty`, scripts/dev-empty.mjs): a second dev server runs
  // beside the normal one, so its build cache must not collide with the normal server's .next.
  // Scoped strictly to ASCENT_EMPTY=1 — normal dev and production builds are unaffected.
  ...(process.env.ASCENT_EMPTY === "1" ? { distDir: ".next-empty" } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // This project lives inside a larger monorepo-style workspace. Pin the Turbopack
  // root to this directory so Next doesn't infer the parent dir from sibling lockfiles.
  turbopack: {
    root: import.meta.dirname,
  },
  // Keep native/optional server-only packages out of the bundle:
  //  - @react-pdf/renderer ships its own font/binary handling that doesn't survive bundling (PDF route).
  //  - @aws-sdk/dsql-signer is an OPTIONAL, try/catch-guarded dynamic import in src/lib/db/client.ts
  //    (only used in Aurora DSQL mode). Externalizing it stops Turbopack from statically resolving the
  //    indirect import and emitting "module not found" warnings when it isn't installed (local dev).
  //  - @electric-sql/pglite* power the embedded local-dev Postgres (scripts/pglite-server.mjs); they're
  //    Node/WASM server packages that should never be bundled into the app graph.
  serverExternalPackages: [
    "@react-pdf/renderer",
    "@aws-sdk/dsql-signer",
    "@electric-sql/pglite",
    "pglite-prisma-adapter",
  ],
};

// DevInspector — dev-only source-location stamping (press `;` then `i`, then
// right-click a component to copy its `src/.../File.tsx:LINE`). Opt-in: the
// Turbopack loader is only registered when launched via `npm run dev:inspect`
// (which sets DEV_INSPECT=1), so a normal `npm run dev` and every production
// build are completely unaffected. See scripts/dev-inspector/.
if (process.env.DEV_INSPECT === "1") {
  const loader = path.join(process.cwd(), "scripts", "dev-inspector", "source-loc-loader.cjs");
  nextConfig.turbopack = {
    ...nextConfig.turbopack,
    rules: {
      ...nextConfig.turbopack?.rules,
      "*.tsx": { loaders: [{ loader, options: { rootDir: process.cwd() } }] },
      "*.jsx": { loaders: [{ loader, options: { rootDir: process.cwd() } }] },
    },
  };
}

export default nextConfig;
