import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
