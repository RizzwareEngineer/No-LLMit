import type { NextConfig } from "next";

// A production deploy must name the engine: unset, the site would point every viewer at http://localhost:8080 (lib/api.ts).
if (process.env.VERCEL_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set: add it in Vercel (Settings > Environment Variables, Production) as the engine\'s https:// address, for example https://engine.example.com');
}

const nextConfig: NextConfig = {
  // scripts/verify.sh builds into its own folder, so a build never touches the dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // No other site may frame the pages (to overlay the waitlist or sponsor button). A full CSP waits: the inline scripts need
  // hashes; until then the policy only bars framing, plugins, a <base> elsewhere and forms posting off the site.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
      ],
    }];
  },
  // The stats pages became sections and a drawer on the home page.
  async redirects() {
    return [
      { source: '/stats', destination: '/#stats', permanent: true },
      { source: '/stats/:model', destination: '/#model=:model', permanent: true },
    ];
  },
};

export default nextConfig;
