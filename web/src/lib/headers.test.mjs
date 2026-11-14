// Every page is sent with the security headers in next.config.ts.
// Run from web/: node --experimental-strip-types --test src/lib/headers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('every page is sent nosniff, no framing, a referrer policy, a CSP and a permissions policy', async () => {
  const { default: config } = await import('../../next.config.ts');
  const rules = await config.headers?.() ?? [];
  const all = rules.find(r => r.source === '/:path*');
  const got = Object.fromEntries((all?.headers ?? []).map(h => [h.key, h.value]));
  assert.deepEqual(got, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  });
  assert.equal(config.poweredByHeader, false);
});
