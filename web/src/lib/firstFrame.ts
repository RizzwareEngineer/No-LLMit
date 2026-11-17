// The server-rendered first frame (the ?ssr=1 draft, app/ssr/page.tsx): the engine's opening frames, read on the server
// at request time from the same stream a viewer opens (engine/api/stream.go sends every new stream its snapshot, then
// the all-time stats body), so the HTML holds the table and the stats as the engine has them. Server only.
import { API_URL, type ServerMessage } from './api';

// One read serves every request for this long: a burst of loads costs the engine one stream, not one each.
const TTL_MS = 1000;
// The read gives up after this long (an engine that is slow or down): the page then renders as the default one does,
// blank until the stream fills it, rather than wait on the engine.
const BUDGET_MS = 500;

// The frames as read, in order (the snapshot first, then the stats body and any table event that came with them), and
// when (the server's Date.now()).
export interface FirstFrame { frames: ServerMessage[]; at: number }

let held: FirstFrame | null = null;
let reading: Promise<FirstFrame | null> | null = null;

// Opens the engine's stream and reads it until the snapshot and the stats body are in (or the stream sends nothing
// more for a moment, when the engine has no stats yet), then closes it.
async function read(): Promise<FirstFrame | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BUDGET_MS);
  const frames: ServerMessage[] = [];
  try {
    const res = await fetch(`${API_URL}/stream`, { signal: ac.signal, cache: 'no-store', headers: { Accept: 'text/event-stream' } });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      // Once the snapshot is in, wait at most 100 ms for the rest of its write (the stats follow in the same flush).
      const next = frames.length ? Promise.race([reader.read(), new Promise<null>(r => setTimeout(() => r(null), 100))]) : reader.read();
      const chunk = await next;
      if (!chunk || chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
        if (!data) continue; // a heartbeat
        const m = JSON.parse(data) as ServerMessage;
        if (!frames.length && m.type !== 'snapshot') continue; // only from a snapshot on
        frames.push(m);
      }
      if (frames.some(m => m.type === 'stats')) break;
    }
    ac.abort();
    return frames.length ? { frames, at: Date.now() } : null;
  } catch {
    return null; // unreachable, too slow, or a frame that did not parse: render without it
  } finally {
    clearTimeout(timer);
  }
}

// The engine's latest opening frames, at most TTL_MS old, or null when they could not be read in time. Never an older
// copy: a held read past its TTL is dropped, not served while a new one is read, so the HTML never shows figures more
// than TTL_MS (plus the read's own time) behind the engine.
// With them, their age now (the page's render follows at once).
export async function firstFrame(): Promise<{ frames: ServerMessage[]; ageMs: number } | null> {
  if (!held || Date.now() - held.at >= TTL_MS) {
    held = null;
    reading ??= read().then(f => { held = f; return f; }).finally(() => { reading = null; });
    await reading;
  }
  return held && { frames: held.frames, ageMs: Math.max(0, Date.now() - held.at) };
}
