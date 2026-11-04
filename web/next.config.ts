import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a dev server use its own build folder so it doesn't clash with `next build`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The game iframe is sandboxed (opaque origin), so fonts and other files it
  // loads from /games need CORS headers.
  async headers() {
    return [{ source: "/games/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};

export default nextConfig;
