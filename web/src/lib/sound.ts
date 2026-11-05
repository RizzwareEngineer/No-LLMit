// Table sounds, synthesized with the Web Audio API. Off by default; the choice is kept
// in localStorage. The AudioContext is only created inside a user gesture, so nothing
// plays before the viewer has clicked or pressed a key on the page.

export type SoundKind = 'deal' | 'chip' | 'showdown';

const STORAGE_KEY = 'nollmit:sound';
let ctx: AudioContext | null = null;
let enabled: boolean | null = null; // null until read from storage
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

// Called only from gesture handlers.
function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

function unlockOnFirstGesture() {
  const once = () => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    if (enabled) unlock();
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

export function isSoundOn(): boolean {
  if (enabled === null) {
    enabled = readStored();
    if (enabled) unlockOnFirstGesture();
  }
  return enabled;
}

export function subscribeSound(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Toggle from a click handler: that click is the gesture that unlocks audio.
export function setSoundOn(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {}
  if (on) unlock();
  listeners.forEach(l => l());
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
  if (kind === 'deal') {
    // A short band-passed noise burst: a card sliding on felt.
    const length = 0.08;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 3000;
    gain.gain.value = 0.25;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(now);
  } else if (kind === 'chip') {
    // Two quick clicks: chips landing on each other.
    tone(c, 2400, now, 0.05, 'triangle', 0.12);
    tone(c, 3100, now + 0.045, 0.05, 'triangle', 0.09);
  } else {
    // A rising major arpeggio for the pot going to the winner.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, now + i * 0.08, 0.3, 'triangle', 0.12));
  }
}
