import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project lives inside a larger monorepo-style workspace. Pin the Turbopack
  // root to this directory so Next doesn't infer the parent dir from sibling lockfiles.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
