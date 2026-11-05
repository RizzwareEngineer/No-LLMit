import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The stats pages became sections and a drawer on the home page.
  async redirects() {
    return [
      { source: '/stats', destination: '/#stats', permanent: true },
      { source: '/stats/:model', destination: '/#model=:model', permanent: true },
    ];
  },
};

export default nextConfig;
