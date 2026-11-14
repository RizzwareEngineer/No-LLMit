import type { NextConfig } from "next";

// A production deploy must name the engine: unset, the site would point every viewer at http://localhost:8080 (lib/api.ts).
if (process.env.VERCEL_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set: add it in Vercel (Settings > Environment Variables, Production) as the engine\'s https:// address, for example https://engine.example.com');
}

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
