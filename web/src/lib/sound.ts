// Table sounds, synthesized with the Web Audio API. Off by default; the choice is kept
// in localStorage. The AudioContext is only created inside a user gesture, so nothing
// plays before the viewer has clicked or pressed a key on the page.

// 'overtake' and 'lead': Trends' replay, one line passing another and a new #1.
export type SoundKind = 'deal' | 'chip' | 'showdown' | 'shuffle' | 'overtake' | 'lead';

// The riffle between hands, in seconds, shared by its picture (TableMotion's Deck) and its sound: the deck splits,
// `cards` cards fall together `gap` apart from `start`, it is squared at `square`, and it is done at `length`.
export const RIFFLE = { start: 0.22, gap: 0.04, cards: 12, square: 0.8, length: 0.9 };

const STORAGE_KEY = 'nollmit:sound';
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let whooshNoise: AudioBuffer | null = null;
let enabled: boolean | null = null; // null until read from storage
let raceUntil = 0; // when the race sound now playing ends, in AudioContext time: they never overlap
const listeners = new Set<() => void>();

// Called only from gesture handlers. Throws where Web Audio is missing.
function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

// The stored choice. Pure, so it can be a useSyncExternalStore snapshot.
export function isSoundOn(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

// With sound stored as on, audio can only start at the viewer's first click or key press.
export function unlockOnFirstGesture() {
  const once = () => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    try {
      if (isSoundOn()) unlock();
    } catch {}
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
  return once;
}

export function subscribeSound(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Toggle from a click handler: that click is the gesture that unlocks audio.
export function setSoundOn(on: boolean) {
  try {
    if (on) unlock();
    enabled = on;
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // No Web Audio here (unlock threw before `enabled` changed) or no storage: keep going.
  } finally {
    listeners.forEach(l => l());
  }
}

// 80 ms of fading noise: a card on felt (deal), a card edge (shuffle).
function getNoise(c: AudioContext) {
  if (!noise) {
    noise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.08), c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  return noise;
}

// A band-passed burst of that noise, `length` s long, fading out.
function flick(c: AudioContext, at: number, length: number, freq: number, peak: number) {
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  src.buffer = getNoise(c);
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(at, 0, length);
}

function tone(c: AudioContext, freq: number, start: number, length: number, type: OscillatorType, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

export function playSound(kind: SoundKind) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const c = ctx;
  const now = c.currentTime;
  if (kind === 'overtake' || kind === 'lead') {
    // One at a time: a whoosh while another race sound plays is dropped; a lead chime waits for it to end.
    if (kind === 'overtake' && now < raceUntil) return;
    const at = Math.max(now, raceUntil);
    if (kind === 'overtake') {
      // A soft whoosh: 120 ms of noise, swept up through a band-pass, swelling in and out.
      if (!whooshNoise) {
        whooshNoise = c.createBuffer(1, Math.ceil(c.sampleRate * 0.12), c.sampleRate);
        const data = whooshNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      const filter = c.createBiquadFilter();
      const gain = c.createGain();
      src.buffer = whooshNoise;
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(700, at);
      filter.frequency.exponentialRampToValueAtTime(2600, at + 0.12);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      src.connect(filter).connect(gain).connect(c.destination);
      src.start(at);
      raceUntil = at + 0.12;
    } else {
      // A brighter two-note chime (E6 then B6) for a new leader.
      tone(c, 1318.5, at, 0.22, 'sine', 0.09);
      tone(c, 1975.5, at + 0.07, 0.3, 'sine', 0.07);
      raceUntil = at + 0.39;
    }
    return;
  }
  if (kind === 'deal') {
    // A short band-passed noise burst: a card sliding on felt.
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = getNoise(c);
    filter.type = 'bandpass';
    filter.frequency.value = 3000;
    gain.gain.value = 0.25;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(now);
  } else if (kind === 'shuffle') {
    // The riffle: card edges flicking past each other, three to each card drawn falling and a little uneven, then a
    // soft, lower tap as the deck is squared.
    const n = RIFFLE.cards * 3;
    for (let i = 0; i < n; i++) {
      flick(c, now + RIFFLE.start + (i / n) * RIFFLE.cards * RIFFLE.gap + Math.random() * 0.004, 0.01, 2800 + Math.random() * 2400, 0.06 + Math.random() * 0.08);
    }
    flick(c, now + RIFFLE.square, 0.05, 900, 0.2);
  } else if (kind === 'chip') {
    // Two quick clicks: chips landing on each other.
    tone(c, 2400, now, 0.05, 'triangle', 0.12);
    tone(c, 3100, now + 0.045, 0.05, 'triangle', 0.09);
  } else {
    // A rising major arpeggio for the pot going to the winner.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, now + i * 0.08, 0.3, 'triangle', 0.12));
  }
}
