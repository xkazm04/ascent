import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project lives inside a larger monorepo-style workspace. Pin the Turbopack
  // root to this directory so Next doesn't infer the parent dir from sibling lockfiles.
  turbopack: {
    root: import.meta.dirname,
  },
  // @react-pdf/renderer ships its own font/binary handling that doesn't survive bundling — keep it
  // external so the PDF export route (src/app/api/report/pdf) loads it as a native server module.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
