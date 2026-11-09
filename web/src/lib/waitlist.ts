import { API_URL } from '@/lib/api';

// The open dataset's waitlist on the engine: GET → {count}; POST {email} → 201 {count} | 200 {count, already: true} | 400.
const URL_ = `${API_URL}/api/waitlist`;

export async function waitlistCount(): Promise<number> {
  const r = await fetch(URL_);
  if (!r.ok) throw new Error(`waitlist ${r.status}`);
  return (await r.json()).count;
}

export type Joined = { count: number; already?: boolean } | 'invalid';

export async function joinWaitlist(email: string): Promise<Joined> {
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (r.status === 400) return 'invalid';
  if (!r.ok) throw new Error(`waitlist ${r.status}`);
  return r.json();
}
