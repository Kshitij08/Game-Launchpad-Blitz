import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a dev server use its own build folder so it doesn't clash with `next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
