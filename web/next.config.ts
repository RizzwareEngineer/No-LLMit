import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // scripts/verify.sh builds into its own folder, so a build never touches the dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The stats pages became sections and a drawer on the home page.
  async redirects() {
    return [
      { source: '/stats', destination: '/#stats', permanent: true },
      { source: '/stats/:model', destination: '/#model=:model', permanent: true },
    ];
  },
};

export default nextConfig;
