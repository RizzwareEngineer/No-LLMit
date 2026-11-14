import { API_URL } from '@/lib/api';

// The open dataset's waitlist on the engine: GET → {count}; POST {email} as JSON → 201 {count} (an address already listed too) |
// 400 | 429 (too many tries) | 403 from a page that is not the site (the engine's SITE_URL) or localhost. A sign-up that was stored but could not be counted answers without count.
const URL_ = `${API_URL}/api/waitlist`;

export async function waitlistCount(): Promise<number> {
  const r = await fetch(URL_);
  if (!r.ok) throw new Error(`waitlist ${r.status}`);
  return (await r.json()).count;
}

export type Joined = { count?: number } | 'invalid';

export async function joinWaitlist(email: string): Promise<Joined> {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (r.status === 400) return 'invalid';
  if (!r.ok) throw new Error(`waitlist ${r.status}`);
  return r.json();
}
